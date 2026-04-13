/**
 * Shared auto-publish logic.
 *
 * Both the products and inventory webhooks call this to turn a product
 * event into a Zernio post. The function is parameterized over a
 * normalized `NormalizedProduct` shape so each webhook can map its own
 * payload (REST products vs. GraphQL inventory→variant→product) into the
 * common form.
 *
 * Responsibilities:
 *   - Pick the matching active PostTemplate (or fall back to a sensible default)
 *   - Render mustache variables ({{title}}, {{price}}, {{url}}, {{description}})
 *   - Resolve target accounts (template override OR every active account in default profile)
 *   - Inject UTM params if enabled on the shop
 *   - Compute scheduledFor from template.autoPublishDelay/autoPublishTime
 *   - POST to Zernio
 *   - Log the result in PostLog
 */

import db from "../db.server";
import { decrypt } from "./encryption.server";
import { ZernioClient, type CreatePostParams } from "./zernio-client";
import { injectUtm } from "./utm.server";

/** Normalized product shape that callers must build from their own payload. */
export interface NormalizedProduct {
  /** Numeric Shopify product id (used to build the gid). */
  id: number;
  title: string;
  /** Plain text or HTML — we'll strip tags. */
  description: string;
  handle: string;
  /** Lowest variant price as a string ("19.99"). */
  price: string;
  /** Featured image URL, if any. */
  imageUrl?: string;
  /** Currently active in Shopify? Drafts are skipped. */
  isActive: boolean;
}

export type TriggerType =
  | "manual"
  | "new_product"
  | "back_in_stock"
  | "price_drop";

/** ShopConfig fields we read in this module. */
export interface AutoPostShopConfig {
  id: string;
  shop: string;
  zernioApiKeyEncrypted: string;
  defaultProfileId: string | null;
  defaultTimezone: string;
  utmEnabled: boolean;
}

/**
 * Render a PostTemplate's contentTemplate by substituting mustache-style
 * variables: {{title}}, {{price}}, {{url}}, {{description}}.
 */
function renderTemplate(
  template: string,
  vars: { title: string; price: string; url: string; description: string },
): string {
  return template
    .replace(/\{\{title\}\}/g, vars.title)
    .replace(/\{\{price\}\}/g, vars.price)
    .replace(/\{\{url\}\}/g, vars.url)
    .replace(/\{\{description\}\}/g, vars.description);
}

/** Strip HTML tags from a string for plain-text post content. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/** Build the storefront URL for a product. */
function buildProductUrl(shop: string, handle: string): string {
  return `https://${shop}/products/${handle}`;
}

/**
 * Compute scheduledFor from template settings. Returns:
 *   - undefined → publish immediately
 *   - ISO string → schedule for that moment in UTC
 *
 * autoPublishDelay (minutes) shifts forward from now.
 * autoPublishTime ("HH:mm") schedules for the next occurrence of that
 * wall-clock time in the shop's timezone.
 */
function computeScheduledFor(
  delay: number | null | undefined,
  time: string | null | undefined,
  shopTimezone: string,
): string | undefined {
  if (!delay && !time) return undefined;

  const now = new Date();

  if (delay && delay > 0) {
    return new Date(now.getTime() + delay * 60_000).toISOString();
  }

  if (time && /^\d{2}:\d{2}$/.test(time)) {
    const [hh, mm] = time.split(":").map(Number);
    // Build the target wall-clock time in the shop's timezone, then convert
    // to UTC. We do this by formatting "now" in the shop tz, swapping in
    // the target hour/minute, advancing a day if it's already passed.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: shopTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    const dateStr = `${get("year")}-${get("month")}-${get("day")}`;
    const targetISO = `${dateStr}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
    let target = zonedToUtc(targetISO, shopTimezone);
    if (target.getTime() <= now.getTime()) {
      target = new Date(target.getTime() + 24 * 60 * 60_000);
    }
    return target.toISOString();
  }

  return undefined;
}

/**
 * Platforms that REQUIRE media on every post. If we don't have any
 * `mediaItems` we can't send to them — Zernio rejects the whole batch
 * (not just that platform) when even one entry fails pre-validation.
 *
 * Source: per-platform validators in zernio's libs/platforms/*.ts
 */
const MEDIA_REQUIRED_PLATFORMS = new Set([
  "instagram",
  "pinterest",
  "tiktok",
  "youtube",
  "snapchat",
]);

/**
 * Convert a wall-clock string ("YYYY-MM-DDTHH:mm:ss") in the given IANA
 * timezone to a UTC Date. Uses Intl to find the offset for that instant.
 */
function zonedToUtc(wallClock: string, timeZone: string): Date {
  // Treat the string as UTC initially, then correct for the tz offset.
  const asUtc = new Date(wallClock + "Z");
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(asUtc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const tzHour = get("hour");
  const tzMinute = get("minute");
  const utcHour = asUtc.getUTCHours();
  const utcMinute = asUtc.getUTCMinutes();
  const offsetMin = tzHour * 60 + tzMinute - (utcHour * 60 + utcMinute);
  return new Date(asUtc.getTime() - offsetMin * 60_000);
}

/**
 * Run the auto-publish flow for a single product event. Idempotent at the
 * call site — caller is responsible for dedupe (e.g. checking PostLog).
 */
export async function createAutoPost(
  config: AutoPostShopConfig,
  product: NormalizedProduct,
  triggerType: TriggerType,
): Promise<void> {
  if (!product.isActive) return;

  const apiKey = decrypt(config.zernioApiKeyEncrypted);
  const client = new ZernioClient(apiKey);

  // Pick the active PostTemplate matching this trigger, if any
  const template = await db.postTemplate.findFirst({
    where: {
      shopConfigId: config.id,
      triggerType,
      isActive: true,
    },
  });

  const productUrl = buildProductUrl(config.shop, product.handle);
  const description = product.description ? stripHtml(product.description) : "";
  const descSnippet = description.slice(0, 200);

  // Build content
  let content: string;
  if (template) {
    content = renderTemplate(template.contentTemplate, {
      title: product.title,
      price: product.price,
      url: productUrl,
      description: descSnippet,
    });
  } else {
    const tail = descSnippet
      ? `\n\n${descSnippet}${description.length > 200 ? "..." : ""}`
      : "";
    content = `${product.title}${tail}\n\n${productUrl}`;
  }

  if (config.utmEnabled) {
    content = injectUtm(content, {
      shop: config.shop,
      platform: undefined, // platform is set per-platform below
    });
  }

  // Resolve target accounts
  let accountIds = template?.accountIds ?? [];
  if (accountIds.length === 0) {
    const accounts = await client.getAccounts(
      config.defaultProfileId || undefined,
    );
    accountIds = accounts.filter((a) => a.isActive).map((a) => a._id);
  }
  if (accountIds.length === 0) return;

  // Featured image only — the inventory/products webhook payloads only
  // give us the featured image. Multi-image is a manual-compose feature.
  const mediaItems = product.imageUrl
    ? [{ type: "image" as const, url: product.imageUrl }]
    : undefined;

  // Build the platforms array (need fresh accounts to map id → platform).
  // When the post has no media we MUST skip platforms that require it —
  // otherwise Zernio rejects the entire batch (not just the bad entry).
  const accounts = await client.getAccounts(
    config.defaultProfileId || undefined,
  );
  const hasMedia = !!mediaItems && mediaItems.length > 0;
  const platforms = accountIds
    .map((id) => {
      const acc = accounts.find((a) => a._id === id);
      if (!acc) return null;
      // Skip media-only platforms when there's no media to attach
      if (!hasMedia && MEDIA_REQUIRED_PLATFORMS.has(acc.platform.toLowerCase())) {
        return null;
      }
      return { platform: acc.platform, accountId: acc._id };
    })
    .filter((p): p is { platform: string; accountId: string } => p !== null);

  if (platforms.length === 0) return;

  // Scheduling
  const scheduledFor = computeScheduledFor(
    template?.autoPublishDelay,
    template?.autoPublishTime,
    config.defaultTimezone,
  );

  const params: CreatePostParams = {
    content,
    mediaItems,
    platforms,
    timezone: config.defaultTimezone,
    metadata: {
      source: "shopify",
      productId: `gid://shopify/Product/${product.id}`,
      shopDomain: config.shop,
      autoPost: true,
      triggerType,
    },
    ...(scheduledFor ? { scheduledFor } : { publishNow: true }),
  };

  const post = await client.createPost(params);

  // Log the attempt locally so the merchant can see status updates
  await db.postLog.create({
    data: {
      shopConfigId: config.id,
      shopifyProductId: `gid://shopify/Product/${product.id}`,
      shopifyProductTitle: product.title,
      zernioPostId: post._id,
      status: scheduledFor ? "scheduled" : "publishing",
      triggerType,
      platforms: platforms.map((p) => p.platform),
      ...(scheduledFor ? { scheduledFor: new Date(scheduledFor) } : {}),
    },
  });
}
