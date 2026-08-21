import type { ShopConfig } from "@prisma/client";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { buildUsageIdempotencyKey, derivePeriodStart } from "./billing.server";
import { fetchBillableUnits } from "./zernio-internal.server";

const ACTIVE_SUBSCRIPTION_QUERY = `
  {
    currentAppInstallation {
      activeSubscriptions {
        id
        status
        currentPeriodEnd
        lineItems { id plan { pricingDetails { __typename } } }
      }
    }
  }
`;

const USAGE_RECORD_MUTATION = `
  mutation appUsageRecordCreate($description: String!, $price: MoneyInput!, $subscriptionLineItemId: ID!, $idempotencyKey: String!) {
    appUsageRecordCreate(description: $description, price: $price, subscriptionLineItemId: $subscriptionLineItemId, idempotencyKey: $idempotencyKey) {
      appUsageRecord { id }
      userErrors { field message }
    }
  }
`;

export interface UsagePostResult {
  posted: number;
  skipped: number;
  capBlocked: boolean;
}

/**
 * Post one usage record per billable unit for the current cycle. Re-posting
 * the same (shop, unit, period) is a Shopify-side no-op via idempotencyKey,
 * which is what makes the daily sweep retry-safe. A cap-exceeded rejection
 * stops the sweep for this shop (remaining units retry tomorrow) and flags
 * capBlocked; any successful post clears it.
 */
export async function postUsageForShop({ config }: { config: ShopConfig }): Promise<UsagePostResult> {
  const shop = config.shop;
  const { admin } = await unauthenticated.admin(shop);

  const subResp = await admin.graphql(ACTIVE_SUBSCRIPTION_QUERY);
  const subJson = (await subResp.json()) as {
    data?: {
      currentAppInstallation?: {
        activeSubscriptions?: Array<{
          id: string;
          status: string;
          currentPeriodEnd: string | null;
          lineItems: Array<{ id: string; plan: { pricingDetails: { __typename: string } } }>;
        }>;
      };
    };
  };
  const subscription = subJson.data?.currentAppInstallation?.activeSubscriptions?.[0];
  const lineItemId =
    subscription?.lineItems.find(
      (item) => item.plan.pricingDetails.__typename === "AppUsagePricing",
    )?.id ?? config.subscriptionLineItemId;

  if (!subscription || subscription.status !== "ACTIVE" || !lineItemId || !subscription.currentPeriodEnd) {
    return { posted: 0, skipped: 0, capBlocked: config.capBlocked };
  }

  const periodStart = derivePeriodStart(subscription.currentPeriodEnd);
  const units = await fetchBillableUnits({ shop });

  let posted = 0;
  let skipped = 0;
  let capBlocked = false;

  for (const unit of units) {
    const resp = await admin.graphql(USAGE_RECORD_MUTATION, {
      variables: {
        description: unit.description,
        price: { amount: unit.amountUsd, currencyCode: "USD" },
        subscriptionLineItemId: lineItemId,
        idempotencyKey: buildUsageIdempotencyKey({ shop, unitId: unit.unitId, periodStart }),
      },
    });
    const json = (await resp.json()) as {
      data?: {
        appUsageRecordCreate?: {
          appUsageRecord?: { id: string } | null;
          userErrors: Array<{ message: string }>;
        };
      };
    };
    const result = json.data?.appUsageRecordCreate;
    const errors = result?.userErrors ?? [];

    if (errors.some((e) => /exceeds balance remaining/i.test(e.message))) {
      capBlocked = true;
      break;
    }
    if (errors.length > 0) {
      console.error(`[usage-billing] ${shop} unit=${unit.unitId} errors:`, errors);
      skipped++;
      continue;
    }
    posted++;
  }

  await db.shopConfig.update({
    where: { shop },
    data: {
      capBlocked,
      currentPeriodEnd: new Date(subscription.currentPeriodEnd),
      ...(posted > 0 && !capBlocked ? { approachingCappedAmount: false } : {}),
    },
  });

  return { posted, skipped, capBlocked };
}
