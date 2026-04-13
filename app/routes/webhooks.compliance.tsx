import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Handles all three mandatory GDPR compliance webhooks:
 * - customers/data_request: Customer requests their stored data
 * - customers/redact: Store owner requests customer data deletion
 * - shop/redact: Sent 48h after app uninstall; delete all shop data
 *
 * This app stores no customer PII. The only per-shop data is the ShopConfig
 * (Zernio API key, preferences) and PostLog entries. On shop/redact we delete
 * everything. For customer topics we return 200 (nothing to do).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);

  console.log(`[compliance] topic=${JSON.stringify(topic)} shop=${JSON.stringify(shop)}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // We store no customer PII - nothing to return.
      break;

    case "CUSTOMERS_REDACT":
      // We store no customer data - nothing to delete.
      break;

    case "SHOP_REDACT": {
      // Delete all data for this shop. Cascading deletes handle PostLog,
      // PostTemplate and InventorySnapshot via the ShopConfig relation,
      // but we also delete them explicitly for visibility in audit logs.
      const config = await db.shopConfig.findUnique({ where: { shop } });
      console.log(`[compliance/SHOP_REDACT] config found: ${!!config}`);
      if (config) {
        const r1 = await db.postLog.deleteMany({ where: { shopConfigId: config.id } });
        const r2 = await db.postTemplate.deleteMany({ where: { shopConfigId: config.id } });
        const r3 = await db.inventorySnapshot.deleteMany({
          where: { shopConfigId: config.id },
        });
        await db.shopConfig.delete({ where: { shop } });
        console.log(
          `[compliance/SHOP_REDACT] deleted ${r1.count} logs, ${r2.count} templates, ${r3.count} snapshots, 1 config`,
        );
      }
      const r4 = await db.session.deleteMany({ where: { shop } });
      console.log(`[compliance/SHOP_REDACT] deleted ${r4.count} sessions`);
      break;
    }

    default:
      console.warn(`Unhandled compliance topic: ${topic}`);
  }

  return new Response(null, { status: 200 });
};
