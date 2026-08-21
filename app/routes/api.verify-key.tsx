import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ZernioClient } from "../lib/zernio-client";
import { completeOnboarding } from "../lib/onboarding.server";

/**
 * Verify a Zernio API key (the BYO path of split billing) and complete
 * onboarding. Only keys belonging to a PAID Zernio subscription are
 * accepted; free-tier users must subscribe through Shopify instead
 * (App Store requirement 1.2.1).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const apiKey = formData.get("apiKey") as string;

  if (!apiKey?.startsWith("sk_")) {
    return Response.json({ error: "API key must start with sk_" });
  }

  try {
    const client = new ZernioClient(apiKey);
    const billing = await client.getBilling();
    if (!billing.plan.isPaid) {
      return Response.json({
        error:
          "This API key belongs to a free Zernio account. Subscribe through Shopify (Home tab) to use the app.",
      });
    }

    await completeOnboarding({ shop, apiKey, keySource: "byo" });
    return Response.json({ success: true, plan: billing.plan.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    return Response.json({ error: message });
  }
};
