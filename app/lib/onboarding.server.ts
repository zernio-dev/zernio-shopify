import { randomBytes } from "crypto";
import db from "../db.server";
import { ZernioClient } from "./zernio-client";
import { encrypt, apiKeyPreview } from "./encryption.server";

/**
 * Persist a verified Zernio API key for a shop and register the Zernio
 * status webhook. Shared by the BYO key path (api.verify-key) and the
 * Shopify-billed subscribe path (app.billing.confirm).
 *
 * Webhook registration is best-effort: on failure the app still works,
 * it just misses real-time post status updates.
 */
export async function completeOnboarding({
  shop,
  apiKey,
  keySource,
  provisionedUserId,
}: {
  shop: string;
  apiKey: string;
  keySource: "byo" | "shopify";
  provisionedUserId?: string;
}): Promise<void> {
  const client = new ZernioClient(apiKey);
  const profiles = await client.getProfiles();
  const webhookSecret = randomBytes(32).toString("hex");

  const fields = {
    zernioApiKeyEncrypted: encrypt(apiKey),
    zernioApiKeyPreview: apiKeyPreview(apiKey),
    defaultProfileId: profiles[0]?._id || null,
    onboardingComplete: true,
    zernioWebhookSecret: webhookSecret,
    keySource,
    provisionedUserId: provisionedUserId ?? null,
  };
  await db.shopConfig.upsert({
    where: { shop },
    create: { shop, ...fields },
    update: fields,
  });

  const appUrl = process.env.SHOPIFY_APP_URL || "https://store.zernio.com";
  try {
    const webhook = await client.createWebhook({
      name: `Shopify - ${shop}`,
      url: `${appUrl}/api/zernio-webhook`,
      secret: webhookSecret,
      events: ["post.published", "post.failed", "post.partial"],
    });
    await db.shopConfig.update({
      where: { shop },
      data: { zernioWebhookId: webhook._id },
    });
  } catch {
    // Non-fatal: see docblock.
  }
}
