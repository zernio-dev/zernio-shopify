import type { ActionFunctionArgs } from "react-router";
import { createHmac, timingSafeEqual } from "crypto";
import db from "../db.server";

/**
 * Receives Zernio post status webhooks to update local PostLog records.
 *
 * Zernio sends webhooks when a post's status changes (e.g. scheduled ->
 * published, scheduled -> failed). This lets the Shopify app show up-to-date
 * post statuses without polling the Zernio API.
 *
 * Authentication: HMAC-SHA256 signature in the X-Zernio-Signature header,
 * verified against the per-shop zernioWebhookSecret stored in ShopConfig.
 *
 * Expected payload shape (JSON body):
 * {
 *   event: "post.published" | "post.failed" | "post.partial",
 *   postId: string,
 *   status: string,
 *   publishedAt?: string,
 *   errorMessage?: string,
 *   metadata?: { shopDomain?: string, ... }
 * }
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ZernioWebhookPayload {
  event: string;
  postId: string;
  status: string;
  publishedAt?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// HMAC verification
// ---------------------------------------------------------------------------

/**
 * Verify the X-Zernio-Signature header against the raw request body.
 * The signature is computed as HMAC-SHA256(secret, rawBody) and sent as hex.
 */
function verifySignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  // Use timing-safe comparison to prevent timing attacks
  try {
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    // Buffers have different lengths (invalid signature format)
    return false;
  }
}

// ---------------------------------------------------------------------------
// Action handler
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  // Only accept POST requests
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("X-Zernio-Signature") || "";

  if (!signature) {
    return Response.json({ error: "Missing signature" }, { status: 401 });
  }

  // Parse the payload to find which shop this webhook belongs to
  let payload: ZernioWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ZernioWebhookPayload;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload.postId) {
    return Response.json({ error: "Missing postId" }, { status: 400 });
  }

  // Find the PostLog entry for this Zernio post ID to identify the shop
  const postLog = await db.postLog.findFirst({
    where: { zernioPostId: payload.postId },
    include: { shopConfig: true },
  });

  if (!postLog) {
    // No matching post log, could be a webhook for a post created outside Shopify.
    // Return 200 to prevent Zernio from retrying.
    return Response.json({ ok: true, skipped: true });
  }

  const { shopConfig } = postLog;

  // Verify the HMAC signature using the shop's webhook secret
  if (!shopConfig.zernioWebhookSecret) {
    // Secret not set yet (shouldn't happen if onboarding registered the webhook).
    // Accept the webhook but log a warning.
    console.warn(`No webhook secret configured for shop ${shopConfig.shop}`);
  } else if (!verifySignature(rawBody, signature, shopConfig.zernioWebhookSecret)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Map Zernio webhook events to PostLog statuses
  let newStatus: string;
  switch (payload.event) {
    case "post.published":
      newStatus = "published";
      break;
    case "post.failed":
      newStatus = "failed";
      break;
    case "post.partial":
      // Some platforms succeeded, some failed
      newStatus = "partial";
      break;
    default:
      // Unknown event type, acknowledge but don't update
      return Response.json({ ok: true, skipped: true });
  }

  // Update the PostLog with the new status
  await db.postLog.update({
    where: { id: postLog.id },
    data: {
      status: newStatus,
      publishedAt: payload.publishedAt ? new Date(payload.publishedAt) : undefined,
      errorMessage: payload.errorMessage || undefined,
    },
  });

  return Response.json({ ok: true });
};
