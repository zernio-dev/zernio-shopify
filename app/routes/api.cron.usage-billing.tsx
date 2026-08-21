import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { postUsageForShop } from "../lib/usage-billing.server";

/**
 * Daily Vercel cron (see vercel.json): posts usage records for every
 * shopify-billed shop with an active subscription. Vercel sends
 * `Authorization: Bearer ${CRON_SECRET}` automatically for cron invocations.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configs = await db.shopConfig.findMany({
    where: { keySource: "shopify", subscriptionStatus: "ACTIVE" },
  });

  const results: Array<{ shop: string; posted: number; skipped: number; capBlocked: boolean; error?: string }> = [];
  for (const config of configs) {
    try {
      const result = await postUsageForShop({ config });
      results.push({ shop: config.shop, ...result });
      console.log(
        `[usage-billing] shop=${config.shop} posted=${result.posted} skipped=${result.skipped} capBlocked=${result.capBlocked}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ shop: config.shop, posted: 0, skipped: 0, capBlocked: false, error: message });
      console.error(`[usage-billing] shop=${config.shop} failed:`, err);
    }
  }

  return Response.json({ shops: results.length, results });
};
