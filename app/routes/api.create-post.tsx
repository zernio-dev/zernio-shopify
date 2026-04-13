import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { decrypt } from "../lib/encryption.server";
import {
  ZernioClient,
  type CreatePostParams,
  type MediaItem,
} from "../lib/zernio-client";
import { injectUtm } from "../lib/utm.server";

/**
 * Create a Zernio post from the compose page.
 *
 * Skips authenticate.admin() (POST in embedded apps throws 410). Shop
 * comes from the most recent offline session.
 *
 * Form fields:
 *   content       — shared caption (used as fallback for any platform
 *                   without an override)
 *   accounts      — comma-separated "platform:accountId" pairs
 *   media         — comma-separated shared media URLs
 *   scheduledFor  — ISO string, ignored when publishNow=true
 *   publishNow    — "true" to skip scheduling
 *   timezone      — IANA tz; falls back to ShopConfig.defaultTimezone
 *   productId     — Shopify gid
 *   productTitle  — human-readable title for PostLog display
 *   overrides     — optional JSON string:
 *                     { [accountKey]: { content?: string; media?: string[] } }
 *                   accountKey is the same "platform:accountId" used in `accounts`.
 *                   Only non-empty overrides are forwarded to Zernio.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const recentSession = await db.session.findFirst({
    orderBy: { id: "desc" },
    where: { isOnline: false },
  });
  const shop = recentSession?.shop;
  if (!shop) return Response.json({ error: "Session not found" }, { status: 400 });

  const config = await db.shopConfig.findUnique({ where: { shop } });
  if (!config) return Response.json({ error: "Not configured" }, { status: 400 });

  const apiKey = decrypt(config.zernioApiKeyEncrypted);
  const client = new ZernioClient(apiKey);

  const formData = await request.formData();
  const content = (formData.get("content") as string) || "";
  const productId = formData.get("productId") as string;
  const productTitle = formData.get("productTitle") as string;
  const accountsRaw = (formData.get("accounts") as string) || "";
  const mediaRaw = (formData.get("media") as string) || "";
  const scheduledFor = formData.get("scheduledFor") as string;
  const publishNow = formData.get("publishNow") === "true";
  const timezone = (formData.get("timezone") as string) || config.defaultTimezone;
  const overridesRaw = (formData.get("overrides") as string) || "";

  if (!content.trim()) {
    return Response.json({ error: "Post content is required" });
  }

  const selectedAccounts = accountsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (selectedAccounts.length === 0) {
    return Response.json({ error: "Select at least one social account" });
  }

  const sharedMedia: MediaItem[] = mediaRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((url) => ({ type: "image", url }));

  let overrides: Record<
    string,
    { content?: string; media?: string[] }
  > = {};
  if (overridesRaw) {
    try {
      overrides = JSON.parse(overridesRaw);
    } catch {
      // Bad JSON → ignore overrides, treat as if none provided
    }
  }

  // Apply UTM injection to the shared content first; per-platform overrides
  // get injected with their platform name as utm_campaign for attribution.
  const sharedContent = config.utmEnabled
    ? injectUtm(content, { shop })
    : content;

  // Build the platforms array. Each entry may carry per-platform content
  // and media overrides; Zernio falls back to the top-level content +
  // mediaItems when these are absent.
  const platforms = selectedAccounts.map((acc) => {
    const [platform, accountId] = acc.split(":");
    const ov = overrides[acc];

    // Per-platform caption (may be empty) — only forward when non-empty,
    // and apply UTM with this platform as utm_campaign
    let customContent: string | undefined;
    if (ov?.content?.trim()) {
      customContent = config.utmEnabled
        ? injectUtm(ov.content, { shop, platform })
        : ov.content;
    }

    // Per-platform media — only forward when the array is non-empty
    let customMedia: MediaItem[] | undefined;
    if (ov?.media && ov.media.length > 0) {
      customMedia = ov.media
        .filter(Boolean)
        .map((url) => ({ type: "image" as const, url }));
    }

    return {
      platform,
      accountId,
      ...(scheduledFor && !publishNow ? { scheduledFor } : {}),
      ...(customContent ? { customContent } : {}),
      ...(customMedia && customMedia.length > 0 ? { customMedia } : {}),
    };
  });

  const params: CreatePostParams = {
    content: sharedContent,
    mediaItems: sharedMedia.length > 0 ? sharedMedia : undefined,
    platforms,
    timezone,
    metadata: { source: "shopify", productId, shopDomain: shop },
    ...(publishNow ? { publishNow: true } : {}),
    ...(scheduledFor && !publishNow ? { scheduledFor } : {}),
  };

  try {
    const post = await client.createPost(params);

    await db.postLog.create({
      data: {
        shopConfigId: config.id,
        shopifyProductId: productId,
        shopifyProductTitle: productTitle,
        zernioPostId: post._id,
        status: publishNow ? "publishing" : "scheduled",
        triggerType: "manual",
        platforms: platforms.map((p) => p.platform),
        scheduledFor: scheduledFor && !publishNow ? new Date(scheduledFor) : null,
      },
    });

    return Response.json({ success: true, postId: post._id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create post";
    return Response.json({ error: message });
  }
};
