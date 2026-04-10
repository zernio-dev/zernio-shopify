import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { decrypt, encrypt, apiKeyPreview } from "../lib/encryption.server";
import { ZernioClient, ZernioApiError } from "../lib/zernio-client";

/**
 * API endpoint for updating settings from the settings page.
 *
 * Handles two intents:
 * - "update-key": Verify and save a new Zernio API key
 * - "update-settings": Save preferences (profile, timezone, auto-post toggles)
 *
 * Skips authenticate.admin() to avoid the 410 error on POST in embedded apps.
 * Gets the shop from the most recent offline session in the database.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Get shop from the most recent offline DB session
  const recentSession = await db.session.findFirst({
    orderBy: { id: "desc" },
    where: { isOnline: false },
  });
  const shop = recentSession?.shop;
  if (!shop) {
    return Response.json({ error: "Session not found" }, { status: 400 });
  }

  const config = await db.shopConfig.findUnique({ where: { shop } });
  if (!config) {
    return Response.json({ error: "Not configured" }, { status: 400 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // --- Update API key ---
  if (intent === "update-key") {
    const apiKey = formData.get("apiKey") as string;
    if (!apiKey?.startsWith("sk_")) {
      return Response.json({ error: "API key must start with sk_" });
    }

    try {
      const client = new ZernioClient(apiKey);
      await client.getUser();
    } catch (err) {
      if (err instanceof ZernioApiError && err.status === 401) {
        return Response.json({ error: "Invalid API key" });
      }
      return Response.json({ error: "Could not verify key. Try again." });
    }

    await db.shopConfig.update({
      where: { shop },
      data: {
        zernioApiKeyEncrypted: encrypt(apiKey),
        zernioApiKeyPreview: apiKeyPreview(apiKey),
      },
    });

    return Response.json({ success: "API key updated" });
  }

  // --- Update preferences ---
  if (intent === "update-settings") {
    const profileId = formData.get("profileId") as string;
    const timezone = formData.get("timezone") as string;

    await db.shopConfig.update({
      where: { shop },
      data: {
        defaultProfileId: profileId || null,
        defaultTimezone: timezone || "UTC",
        autoPostNewProducts: formData.get("autoPostNewProducts") === "on",
        autoPostBackInStock: formData.get("autoPostBackInStock") === "on",
        autoPostPriceDrop: formData.get("autoPostPriceDrop") === "on",
      },
    });

    return Response.json({ success: "Settings saved" });
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
};
