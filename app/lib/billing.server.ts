export const USAGE_PLAN = "Zernio Usage";
export const DEFAULT_CAPPED_AMOUNT_USD = 120;
// Shown verbatim on Shopify's subscription approval screen. Must match the
// rates the Zernio billable-units endpoint actually posts (the public
// graduated rate card: $6/account for the first 10, $3 to 100, $1 beyond).
export const USAGE_TERMS =
  "Up to $6 USD per connected social account per 30 days. Volume discounts apply automatically at higher account counts. You only pay for accounts connected during the billing period.";

export function buildUsageIdempotencyKey(args: {
  shop: string;
  unitId: string;
  periodStart: string;
}): string {
  return `${args.shop}:${args.unitId}:${args.periodStart}`;
}

/**
 * Whether billing calls for this shop must use Shopify test charges.
 * True for partner development stores (the only stores where test charges
 * work, and real ones don't). SHOPIFY_BILLING_TEST=true forces it globally.
 * The GraphQL answer is cached on ShopConfig.isTestShop when a row exists.
 */
export async function resolveIsTest({
  admin,
  shopConfig,
}: {
  admin: { graphql: (query: string) => Promise<Response> };
  shopConfig: { shop: string; isTestShop: boolean | null } | null;
}): Promise<boolean> {
  if (process.env.SHOPIFY_BILLING_TEST === "true") return true;
  if (shopConfig?.isTestShop != null) return shopConfig.isTestShop;

  const resp = await admin.graphql(`{ shop { plan { partnerDevelopment } } }`);
  const json = (await resp.json()) as {
    data?: { shop?: { plan?: { partnerDevelopment?: boolean } } };
  };
  const isTest = json.data?.shop?.plan?.partnerDevelopment === true;

  if (shopConfig) {
    const db = (await import("../db.server")).default;
    await db.shopConfig.update({
      where: { shop: shopConfig.shop },
      data: { isTestShop: isTest },
    });
  }
  return isTest;
}
