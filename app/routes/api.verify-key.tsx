import type { ActionFunctionArgs } from "react-router";
import { randomBytes } from "crypto";
import db from "../db.server";
import { ZernioClient } from "../lib/zernio-client";
import { encrypt, apiKeyPreview } from "../lib/encryption.server";

/**
 * API endpoint for verifying a Zernio API key.
 *
 * IMPORTANT: We intentionally skip authenticate.admin() here because
 * it throws a redirect on POST requests in embedded apps before our
 * action code runs. Instead, we get the shop from the existing session
 * in the database (which was created during the initial page load).
 *
 * After saving the config, this also registers a Zernio webhook so the
 * app receives post status updates (published, failed, etc.).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Get shop from the URL params or find the most recent session
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");

  let shop: string | null = shopParam;

  if (!shop) {
    // Find shop from the most recent offline session in the database
    const recentSession = await db.session.findFirst({
      orderBy: { id: "desc" },
      where: { isOnline: false },
    });
    shop = recentSession?.shop || null;
  }

  if (!shop) {
    return Response.json({ error: "Session not found. Reload the page." }, { status: 400 });
  }

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
    const appUrl = process.env.SHOPIFY_APP_URL || "https://shopify.zernio.com";
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
