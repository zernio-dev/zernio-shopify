import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { createAutoPost, type NormalizedProduct } from "../lib/auto-post.server";

/**
 * Shopify product lifecycle webhooks.
 *
 *   products/create  → auto-publish if autoPostNewProducts is on
 *   products/update  → auto-publish on price drop if autoPostPriceDrop is on
 *   products/delete  → mark in-flight PostLog entries as failed
 *
 * Per-trigger logic delegates to the shared `createAutoPost` so the
 * inventory webhook (back-in-stock) can run the same path.
 *
 * Payload shape: Shopify Admin REST product resource.
 * https://shopify.dev/docs/api/webhooks/topics#products-create
 */

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

/** Lowest variant price as "19.99". Falls back to "0.00" for empty variants. */
function lowestPrice(variants: ShopifyVariantPayload[]): string {
  if (variants.length === 0) return "0.00";
  const prices = variants.map((v) => parseFloat(v.price));
  return Math.min(...prices).toFixed(2);
}

/** Map the REST webhook payload to the lib's NormalizedProduct shape. */
function normalize(p: ShopifyProductPayload): NormalizedProduct {
  return {
    id: p.id,
    title: p.title,
    description: p.body_html ?? "",
    handle: p.handle,
    price: lowestPrice(p.variants),
    imageUrl: p.image?.src,
    isActive: p.status === "active",
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const product = payload as unknown as ShopifyProductPayload;

  const config = await db.shopConfig.findUnique({ where: { shop } });
  if (!config) return new Response(null, { status: 200 });

  switch (topic) {
    case "PRODUCTS_CREATE": {
      if (!config.autoPostNewProducts) break;
      try {
        await createAutoPost(config, normalize(product), "new_product");
      } catch (err) {
        console.error(`Auto-post failed for new product ${product.id}:`, err);
      }
      break;
    }

    case "PRODUCTS_UPDATE": {
      if (!config.autoPostPriceDrop) break;

      // A price drop is when current price < compare_at_price on any variant
      const hasPriceDrop = product.variants.some((v) => {
        if (!v.compare_at_price) return false;
        return parseFloat(v.price) < parseFloat(v.compare_at_price);
      });
      if (!hasPriceDrop) break;

      // Dedupe: avoid spamming if a merchant edits the same product repeatedly
      const oneHourAgo = new Date(Date.now() - 60 * 60_000);
      const recent = await db.postLog.findFirst({
        where: {
          shopConfigId: config.id,
          shopifyProductId: `gid://shopify/Product/${product.id}`,
          triggerType: "price_drop",
          createdAt: { gte: oneHourAgo },
        },
      });
      if (recent) break;

      try {
        await createAutoPost(config, normalize(product), "price_drop");
      } catch (err) {
        console.error(
          `Auto-post failed for price drop on product ${product.id}:`,
          err,
        );
      }
      break;
    }

    case "PRODUCTS_DELETE": {
      const gid = `gid://shopify/Product/${product.id}`;
      await db.postLog.updateMany({
        where: {
          shopConfigId: config.id,
          shopifyProductId: gid,
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
