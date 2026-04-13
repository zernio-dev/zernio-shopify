import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Handles all three mandatory GDPR compliance webhooks.
 *
 *   customers/data_request — return what we store about a customer
 *   customers/redact       — delete what we store about a customer
 *   shop/redact            — sent ~48h after app uninstall; nuke shop data
 *
 * This app stores no customer PII, so the customer topics are no-ops. The
 * only per-shop state is ShopConfig (and its cascade children PostLog,
 * PostTemplate, InventorySnapshot) plus offline Sessions.
 *
 * SAFETY: every delete in here MUST validate the shop string before it
 * runs. A bare `deleteMany({ where: { shop: undefined } })` matches every
 * row (Prisma drops `undefined` filter keys), which would delete every
 * shop's data. We learned this the hard way during testing.
 */

/** Shopify shop domains end in `.myshopify.com` and contain only safe chars. */
function isValidShop(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(value)
  );
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);

  // Refuse to do ANY destructive work without a syntactically-valid shop
  if (!isValidShop(shop)) {
    console.warn(
      `[compliance] refusing webhook with invalid shop=${JSON.stringify(shop)} topic=${JSON.stringify(topic)}`,
    );
    return new Response(null, { status: 200 });
  }

  console.log(`[compliance] topic=${topic} shop=${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // We store no customer PII — nothing to return.
      break;

    case "CUSTOMERS_REDACT":
      // We store no customer data — nothing to delete.
      break;

    case "SHOP_REDACT": {
      // Scope every delete by the validated shop. We do the lookup first so
      // we can target child rows by shopConfigId — that way even if a future
      // bug introduced a wider where-clause, it would still be bounded by
      // a single config row.
      const config = await db.shopConfig.findUnique({ where: { shop } });
      if (config) {
        const r1 = await db.postLog.deleteMany({
          where: { shopConfigId: config.id },
        });
        const r2 = await db.postTemplate.deleteMany({
          where: { shopConfigId: config.id },
        });
        const r3 = await db.inventorySnapshot.deleteMany({
          where: { shopConfigId: config.id },
        });
        await db.shopConfig.delete({ where: { shop } });
        console.log(
          `[compliance/SHOP_REDACT] ${shop}: deleted ${r1.count} logs, ${r2.count} templates, ${r3.count} snapshots, 1 config`,
        );
      } else {
        console.log(`[compliance/SHOP_REDACT] ${shop}: no config to delete`);
      }

      // Sessions are scoped by `shop` directly. The isValidShop guard above
      // ensures `shop` is a real string, so this can never widen to
      // "delete all sessions everywhere".
      const r4 = await db.session.deleteMany({ where: { shop } });
      console.log(`[compliance/SHOP_REDACT] ${shop}: deleted ${r4.count} sessions`);
      break;
    }

    default:
      console.warn(`[compliance] unhandled topic: ${topic}`);
  }

  return new Response(null, { status: 200 });
};
