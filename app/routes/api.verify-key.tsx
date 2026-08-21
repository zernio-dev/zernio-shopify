import type { ActionFunctionArgs } from "react-router";
import { randomBytes } from "crypto";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { ZernioClient } from "../lib/zernio-client";
import { encrypt, apiKeyPreview } from "../lib/encryption.server";

/**
 * API endpoint for verifying a Zernio API key.
 *
 * After saving the config, this also registers a Zernio webhook so the
 * app receives post status updates (published, failed, etc.).
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
    const user = await client.getUser();
    const profiles = await client.getProfiles();

    // Generate a random secret for verifying incoming Zernio webhooks
    const webhookSecret = randomBytes(32).toString("hex");

    await db.shopConfig.upsert({
      where: { shop },
      create: {
        shop,
        zernioApiKeyEncrypted: encrypt(apiKey),
        zernioApiKeyPreview: apiKeyPreview(apiKey),
        defaultProfileId: profiles[0]?._id || null,
        onboardingComplete: true,
        zernioWebhookSecret: webhookSecret,
      },
      update: {
        zernioApiKeyEncrypted: encrypt(apiKey),
        zernioApiKeyPreview: apiKeyPreview(apiKey),
        defaultProfileId: profiles[0]?._id || null,
        onboardingComplete: true,
        zernioWebhookSecret: webhookSecret,
      },
    });

    // Register a webhook with the Zernio API to receive post status updates.
    // The webhook URL points to our /api/zernio-webhook endpoint.
    // This is best-effort; if it fails the app still works (just won't get
    // real-time status updates).
    const appUrl = process.env.SHOPIFY_APP_URL || "https://store.zernio.com";
    try {
      const webhook = await client.createWebhook({
        name: `Shopify - ${shop}`,
        url: `${appUrl}/api/zernio-webhook`,
        secret: webhookSecret,
        events: ["post.published", "post.failed", "post.partial"],
      });

      // Store the webhook ID so we can manage it later
      await db.shopConfig.update({
        where: { shop },
        data: { zernioWebhookId: webhook._id },
      });
    } catch {
      // Non-fatal: webhook registration failed but onboarding succeeded.
      // The user can still create posts manually; they just won't get
      // real-time status updates in the Posts page.
    }

    return Response.json({ success: true, plan: user.planName });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    return Response.json({ error: message });
  }
};
