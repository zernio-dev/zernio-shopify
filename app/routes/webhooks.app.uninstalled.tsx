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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  // SAFETY: Prisma drops `undefined` keys from `where` clauses, which
  // would turn this into "delete every session everywhere". Validate.
  if (!isValidShop(shop)) {
    console.warn(
      `[uninstalled] refusing webhook with invalid shop=${JSON.stringify(shop)} topic=${JSON.stringify(topic)}`,
    );
    return new Response(null, { status: 200 });
  }

  console.log(`[uninstalled] ${topic} for ${shop}`);

  // Clean up session data. The webhook can fire multiple times and after
  // the app has already been uninstalled, so the session may already have
  // been removed.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response(null, { status: 200 });
};
