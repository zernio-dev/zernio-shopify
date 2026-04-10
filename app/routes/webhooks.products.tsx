import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { decrypt } from "../lib/encryption.server";
import { ZernioClient } from "../lib/zernio-client";

/**
 * Handles Shopify product lifecycle webhooks:
 * - products/create: Auto-post new products if autoPostNewProducts is enabled
 * - products/update: Auto-post on price drops if autoPostPriceDrop is enabled
 * - products/delete: Clean up PostLog entries for the deleted product
 *
 * The payload shape follows the Shopify Admin REST product resource.
 * See: https://shopify.dev/docs/api/webhooks/topics#products-create
 */

// ---------------------------------------------------------------------------
// Types for the Shopify product webhook payload
// ---------------------------------------------------------------------------

interface ShopifyVariantPayload {
  id: number;
  price: string;
  compare_at_price: string | null;
  title: string;
}

interface ShopifyImagePayload {
  id: number;
  src: string;
  alt: string | null;
  position: number;
}

interface ShopifyProductPayload {
  id: number;
  title: string;
  body_html: string | null;
  handle: string;
  status: string;
  variants: ShopifyVariantPayload[];
  images: ShopifyImagePayload[];
  image: ShopifyImagePayload | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the Shopify storefront URL for a product.
 * The shop domain from the webhook is the myshopify.com domain.
 */
function buildProductUrl(shop: string, handle: string): string {
  return `https://${shop}/products/${handle}`;
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

/**
 * Strip HTML tags from a string for plain-text post content.
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/**
 * Get the lowest price from a product's variants.
 */
function getLowestPrice(variants: ShopifyVariantPayload[]): string {
  if (variants.length === 0) return "0.00";
  const prices = variants.map((v) => parseFloat(v.price));
  return Math.min(...prices).toFixed(2);
}

/**
 * Create a Zernio post for a product using the shop's config and templates.
 * Falls back to a default template if no matching PostTemplate is found.
 */
async function createAutoPost(
  config: {
    id: string;
    shop: string;
    zernioApiKeyEncrypted: string;
    defaultProfileId: string | null;
    defaultTimezone: string;
  },
  product: ShopifyProductPayload,
  triggerType: string,
  shop: string,
): Promise<void> {
  // Skip draft products, only post active ones
  if (product.status !== "active") return;

  const apiKey = decrypt(config.zernioApiKeyEncrypted);
  const client = new ZernioClient(apiKey);

  // Look for an active PostTemplate matching this trigger type
  const template = await db.postTemplate.findFirst({
    where: {
      shopConfigId: config.id,
      triggerType,
      isActive: true,
    },
  });

  const productUrl = buildProductUrl(shop, product.handle);
  const price = getLowestPrice(product.variants);
  const description = product.body_html ? stripHtml(product.body_html) : "";

  // Build post content from template or use a sensible default
  let content: string;
  if (template) {
    content = renderTemplate(template.contentTemplate, {
      title: product.title,
      price,
      url: productUrl,
      description: description.slice(0, 200),
    });
  } else {
    // Default template when no PostTemplate exists
    const descSnippet = description
      ? `\n\n${description.slice(0, 200)}${description.length > 200 ? "..." : ""}`
      : "";
    content = `${product.title}${descSnippet}\n\n${productUrl}`;
  }

  // Determine which accounts to post to
  let accountIds: string[] = template?.accountIds || [];
  let platformNames: string[] = template?.platforms || [];

  // If no template-defined accounts, get all accounts from the default profile
  if (accountIds.length === 0) {
    const accounts = await client.getAccounts(config.defaultProfileId || undefined);
    accountIds = accounts
      .filter((a) => a.isActive)
      .map((a) => a._id);
    platformNames = accounts
      .filter((a) => a.isActive)
      .map((a) => a.platform);
  }

  // Nothing to post to if no accounts are available
  if (accountIds.length === 0) return;

  // Build platforms array for Zernio API
  const accounts = await client.getAccounts(config.defaultProfileId || undefined);
  const platforms = accountIds
    .map((id) => {
      const acc = accounts.find((a) => a._id === id);
      if (!acc) return null;
      return { platform: acc.platform, accountId: acc._id };
    })
    .filter((p): p is { platform: string; accountId: string } => p !== null);

  if (platforms.length === 0) return;

  // Attach the featured image if available
  const mediaItems = product.image
    ? [{ type: "image" as const, url: product.image.src }]
    : [];

  // Create the post via Zernio API (publish immediately)
  const shopifyGid = `gid://shopify/Product/${product.id}`;
  const post = await client.createPost({
    content,
    mediaItems: mediaItems.length > 0 ? mediaItems : undefined,
    platforms,
    publishNow: true,
    timezone: config.defaultTimezone,
    metadata: {
      source: "shopify",
      productId: shopifyGid,
      shopDomain: shop,
      autoPost: true,
      triggerType,
    },
  });

  // Log locally for status tracking
  await db.postLog.create({
    data: {
      shopConfigId: config.id,
      shopifyProductId: shopifyGid,
      shopifyProductTitle: product.title,
      zernioPostId: post._id,
      status: "publishing",
      triggerType,
      platforms: platforms.map((p) => p.platform),
    },
  });
}

// ---------------------------------------------------------------------------
// Webhook action handler
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  const product = payload as unknown as ShopifyProductPayload;

  // Load the shop's config to check auto-post settings
  const config = await db.shopConfig.findUnique({ where: { shop } });

  switch (topic) {
    // ----- New product created -----
    case "PRODUCTS_CREATE": {
      if (!config?.autoPostNewProducts) break;

      try {
        await createAutoPost(config, product, "new_product", shop);
      } catch (err) {
        // Log but don't fail the webhook (Shopify would retry)
        console.error(`Auto-post failed for new product ${product.id}:`, err);
      }
      break;
    }

    // ----- Product updated (check for price drop) -----
    case "PRODUCTS_UPDATE": {
      if (!config?.autoPostPriceDrop) break;

      // Detect a price drop by comparing the current price to the compare_at_price.
      // Shopify sets compare_at_price when a product is on sale (original > current).
      const hasPriceDrop = product.variants.some((v) => {
        if (!v.compare_at_price) return false;
        return parseFloat(v.price) < parseFloat(v.compare_at_price);
      });

      if (!hasPriceDrop) break;

      // Avoid duplicate auto-posts: check if we already posted for this product
      // in the last hour with the same trigger type.
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentPost = await db.postLog.findFirst({
        where: {
          shopConfigId: config.id,
          shopifyProductId: `gid://shopify/Product/${product.id}`,
          triggerType: "price_drop",
          createdAt: { gte: oneHourAgo },
        },
      });
      if (recentPost) break;

      try {
        await createAutoPost(config, product, "price_drop", shop);
      } catch (err) {
        console.error(`Auto-post failed for price drop on product ${product.id}:`, err);
      }
      break;
    }

    // ----- Product deleted -----
    case "PRODUCTS_DELETE": {
      if (!config) break;

      // Clean up PostLog entries for the deleted product
      const shopifyGid = `gid://shopify/Product/${product.id}`;
      await db.postLog.updateMany({
        where: {
          shopConfigId: config.id,
          shopifyProductId: shopifyGid,
          status: { in: ["pending", "scheduled"] },
        },
        data: {
          status: "failed",
          errorMessage: "Product was deleted from Shopify",
        },
      });
      break;
    }

    default:
      console.warn(`Unhandled product webhook topic: ${topic}`);
  }

  return new Response(null, { status: 200 });
};
