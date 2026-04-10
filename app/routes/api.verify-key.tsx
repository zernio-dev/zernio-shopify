import type { ActionFunctionArgs } from "react-router";
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
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("[zernio] verify-key action called");

  // Get shop from the URL referer or find the most recent session
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");

  let shop: string | null = shopParam;

  if (!shop) {
    // Find shop from the most recent session in the database
    const recentSession = await db.session.findFirst({
      orderBy: { id: "desc" },
      where: { isOnline: false },
    });
    shop = recentSession?.shop || null;
  }

  if (!shop) {
    console.log("[zernio] No shop found");
    return Response.json({ error: "Session not found. Reload the page." }, { status: 400 });
  }

  console.log("[zernio] shop:", shop);

  const formData = await request.formData();
  const apiKey = formData.get("apiKey") as string;

  console.log("[zernio] apiKey:", apiKey ? apiKey.slice(0, 8) + "..." : "EMPTY");

  if (!apiKey?.startsWith("sk_")) {
    return Response.json({ error: "API key must start with sk_" });
  }

  try {
    const client = new ZernioClient(apiKey);
    console.log("[zernio] calling getUser...");
    const user = await client.getUser();
    console.log("[zernio] plan:", user.planName);

    const profiles = await client.getProfiles();
    console.log("[zernio] profiles:", profiles.length);

    await db.shopConfig.upsert({
      where: { shop },
      create: {
        shop,
        zernioApiKeyEncrypted: encrypt(apiKey),
        zernioApiKeyPreview: apiKeyPreview(apiKey),
        defaultProfileId: profiles[0]?._id || null,
        onboardingComplete: true,
      },
      update: {
        zernioApiKeyEncrypted: encrypt(apiKey),
        zernioApiKeyPreview: apiKeyPreview(apiKey),
        defaultProfileId: profiles[0]?._id || null,
        onboardingComplete: true,
      },
    });

    console.log("[zernio] success! onboarding complete");
    return Response.json({ success: true, plan: user.planName });
  } catch (err) {
    console.error("[zernio] error:", err);
    const message = err instanceof Error ? err.message : "Connection failed";
    return Response.json({ error: message });
  }
};
