import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { decrypt } from "../lib/encryption.server";
import { ZernioClient } from "../lib/zernio-client";

/**
 * API endpoint for creating a Zernio post from the compose page.
 * Skips authenticate.admin() (same pattern as api.verify-key).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("[zernio] create-post action called");

  // Get shop from DB session
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

  const apiKey = decrypt(config.zernioApiKeyEncrypted);
  const client = new ZernioClient(apiKey);

  const formData = await request.formData();
  const content = formData.get("content") as string;
  const productId = formData.get("productId") as string;
  const productTitle = formData.get("productTitle") as string;
  // accounts and media come as comma-separated strings from fetcher.submit
  const accountsRaw = formData.get("accounts") as string || "";
  const mediaRaw = formData.get("media") as string || "";
  const selectedAccounts = accountsRaw ? accountsRaw.split(",") : [];
  const mediaUrls = mediaRaw ? mediaRaw.split(",").filter(Boolean) : [];
  const scheduledFor = formData.get("scheduledFor") as string;
  const publishNow = formData.get("publishNow") === "true";
  const timezone = formData.get("timezone") as string;

  console.log("[zernio] content:", content?.substring(0, 50));
  console.log("[zernio] accounts:", selectedAccounts.length);
  console.log("[zernio] publishNow:", publishNow);

  if (!content?.trim()) {
    return Response.json({ error: "Post content is required" });
  }

  if (selectedAccounts.length === 0) {
    return Response.json({ error: "Select at least one social account" });
  }

  // Build platforms array
  const platforms = selectedAccounts.map((acc) => {
    const [platform, accountId] = acc.split(":");
    return {
      platform,
      accountId,
      ...(scheduledFor && !publishNow ? { scheduledFor } : {}),
    };
  });

  const mediaItems = mediaUrls
    .filter(Boolean)
    .map((url) => ({ type: "image" as const, url }));

  try {
    const post = await client.createPost({
      content,
      mediaItems: mediaItems.length > 0 ? mediaItems : undefined,
      platforms,
      ...(publishNow ? { publishNow: true } : {}),
      ...(scheduledFor && !publishNow ? { scheduledFor } : {}),
      timezone: timezone || config.defaultTimezone,
      metadata: {
        source: "shopify",
        productId,
        shopDomain: shop,
      },
    });

    console.log("[zernio] post created:", post._id);

    // Log locally
    await db.postLog.create({
      data: {
        shopConfigId: config.id,
        shopifyProductId: productId,
        shopifyProductTitle: productTitle,
        zernioPostId: post._id,
        status: publishNow ? "publishing" : "scheduled",
        triggerType: "manual",
        platforms: platforms.map((p) => p.platform),
        scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      },
    });

    return Response.json({ success: true, postId: post._id });
  } catch (err) {
    console.error("[zernio] create-post error:", err);
    const message = err instanceof Error ? err.message : "Failed to create post";
    return Response.json({ error: message });
  }
};
