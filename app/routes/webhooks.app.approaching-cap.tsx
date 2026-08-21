import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/** Same shop validator used by webhooks.compliance — mirrored here on
 *  purpose so this file stays self-contained for review. */
function isValidShop(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(value)
  );
}

/** Fires when usage crosses 90% of the approved capped amount. Sets the
 *  flag the Accounts page banner keys on. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  if (!isValidShop(shop)) {
    console.warn(
      `[approaching-cap] refusing webhook with invalid shop=${JSON.stringify(shop)} topic=${JSON.stringify(topic)}`,
    );
    return new Response(null, { status: 200 });
  }

  await db.shopConfig.updateMany({
    where: { shop },
    data: { approachingCappedAmount: true },
  });

  console.log(`[approaching-cap] ${shop}`);
  return new Response(null, { status: 200 });
};
