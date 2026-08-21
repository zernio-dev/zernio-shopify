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

/**
 * app_subscriptions/update fires on approval, cancellation, expiry, and
 * capped-amount changes. Payload carries status/capped_amount but NOT
 * current_period_end (that stays cron-queried via GraphQL).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  if (!isValidShop(shop)) {
    console.warn(
      `[subscriptions-update] refusing webhook with invalid shop=${JSON.stringify(shop)} topic=${JSON.stringify(topic)}`,
    );
    return new Response(null, { status: 200 });
  }

  const sub = (payload as { app_subscription?: Record<string, unknown> })
    ?.app_subscription;
  if (!sub) return new Response(null, { status: 200 });

  const config = await db.shopConfig.findUnique({ where: { shop } });
  if (!config) return new Response(null, { status: 200 });

  const status = typeof sub.status === "string" ? sub.status : null;
  const cappedAmountRaw = sub.capped_amount;
  const cappedAmountUsd =
    typeof cappedAmountRaw === "string" || typeof cappedAmountRaw === "number"
      ? Number(cappedAmountRaw)
      : null;
  const capRaised =
    cappedAmountUsd != null &&
    config.cappedAmountUsd != null &&
    cappedAmountUsd > config.cappedAmountUsd;

  await db.shopConfig.update({
    where: { shop },
    data: {
      ...(status ? { subscriptionStatus: status } : {}),
      ...(cappedAmountUsd != null && Number.isFinite(cappedAmountUsd)
        ? { cappedAmountUsd }
        : {}),
      ...(capRaised ? { approachingCappedAmount: false, capBlocked: false } : {}),
    },
  });

  if (
    config.keySource === "shopify" &&
    (status === "CANCELLED" || status === "EXPIRED")
  ) {
    try {
      const { suspendMerchant } = await import("../lib/zernio-internal.server");
      await suspendMerchant({ shop });
    } catch (err) {
      // The webhook must still 200; the uninstall handler and the next
      // billing.require gate are the safety nets.
      console.error(`[subscriptions-update] suspend failed for ${shop}:`, err);
    }
  }

  console.log(`[subscriptions-update] ${shop} status=${status} cap=${cappedAmountUsd}`);
  return new Response(null, { status: 200 });
};
