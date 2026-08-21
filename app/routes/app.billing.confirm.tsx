import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { USAGE_PLAN, resolveIsTest } from "../lib/billing.server";
import { provisionMerchant } from "../lib/zernio-internal.server";
import { completeOnboarding } from "../lib/onboarding.server";
import db from "../db.server";

const ACTIVE_SUBSCRIPTIONS_QUERY = `
  {
    currentAppInstallation {
      activeSubscriptions {
        id
        status
        currentPeriodEnd
        lineItems {
          id
          plan {
            pricingDetails {
              __typename
              ... on AppUsagePricing {
                cappedAmount { amount }
              }
            }
          }
        }
      }
    }
    shop { email }
  }
`;

/**
 * Shopify redirects here after the merchant approves the usage subscription.
 * Provisions (or reactivates) the Zernio account, stores the subscription
 * ids, and completes onboarding. Safe to re-enter: provisioning is
 * idempotent on shop, and an already-onboarded shop just refreshes its
 * subscription columns.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const shopConfig = await db.shopConfig.findUnique({
    where: { shop },
    select: { shop: true, isTestShop: true, zernioApiKeyEncrypted: true, keySource: true },
  });
  const isTest = await resolveIsTest({ admin, shopConfig });
  const check = await billing.check({ plans: [USAGE_PLAN], isTest });
  if (!check.hasActivePayment) {
    return redirect("/app");
  }

  const resp = await admin.graphql(ACTIVE_SUBSCRIPTIONS_QUERY);
  const json = (await resp.json()) as {
    data?: {
      currentAppInstallation?: {
        activeSubscriptions?: Array<{
          id: string;
          status: string;
          currentPeriodEnd: string | null;
          lineItems: Array<{
            id: string;
            plan: {
              pricingDetails: { __typename: string; cappedAmount?: { amount: string } };
            };
          }>;
        }>;
      };
      shop?: { email?: string | null };
    };
  };

  const subscription = json.data?.currentAppInstallation?.activeSubscriptions?.[0];
  const usageLineItem = subscription?.lineItems.find(
    (item) => item.plan.pricingDetails.__typename === "AppUsagePricing",
  );
  if (!subscription || !usageLineItem) {
    return redirect("/app");
  }

  const result = await provisionMerchant({
    shop,
    email: json.data?.shop?.email ?? null,
  });

  // A reinstall returns no apiKey when the stored key is still active; the
  // encrypted copy in ShopConfig keeps working. A missing key on a shop with
  // no stored config means provisioning is out of sync — surface it.
  if (result.apiKey) {
    await completeOnboarding({
      shop,
      apiKey: result.apiKey,
      keySource: "shopify",
      provisionedUserId: result.userId,
    });
  } else if (!shopConfig?.zernioApiKeyEncrypted) {
    throw new Error(
      `Provisioning returned no API key for ${shop} and no stored key exists`,
    );
  }

  await db.shopConfig.update({
    where: { shop },
    data: {
      keySource: "shopify",
      provisionedUserId: result.userId,
      subscriptionId: subscription.id,
      subscriptionLineItemId: usageLineItem.id,
      subscriptionStatus: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd)
        : null,
      cappedAmountUsd: usageLineItem.plan.pricingDetails.cappedAmount
        ? Number(usageLineItem.plan.pricingDetails.cappedAmount.amount)
        : null,
      approachingCappedAmount: false,
      capBlocked: false,
    },
  });

  return redirect("/app");
};
