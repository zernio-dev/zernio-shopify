import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";
import { createAutoPost, type NormalizedProduct } from "../lib/auto-post.server";

/**
 * inventory_levels/update webhook handler — drives the back-in-stock
 * auto-publish trigger.
 *
 * Shopify fires this whenever a variant's available count changes at any
 * location. The payload only includes the inventory_item_id + available
 * count, so we:
 *   1. Compare to our InventorySnapshot to detect a 0 → >0 transition
 *   2. If the merchant has autoPostBackInStock enabled, resolve the
 *      inventory_item back to its product via GraphQL Admin API
 *   3. Call the shared createAutoPost flow
 *   4. Dedupe via PostLog (24h per product, no spamming if stock yo-yos)
 *   5. Always upsert the snapshot so the next webhook has fresh state
 *
 * https://shopify.dev/docs/api/webhooks/topics#inventory_levels-update
 */

interface InventoryLevelsUpdatePayload {
  inventory_item_id: number;
  location_id: number;
  available: number;
  // newer Shopify webhooks include `quantities` instead of `available`
  quantities?: Array<{ name: string; quantity: number }>;
  updated_at: string;
}

/**
 * Sum of "available"-style quantities for a given payload. Newer Shopify
 * payloads use the `quantities` array; older ones expose a flat
 * `available`. We treat both as "in-stock count" for trigger purposes.
 */
function readAvailable(p: InventoryLevelsUpdatePayload): number {
  if (p.quantities && p.quantities.length > 0) {
    const available = p.quantities.find((q) => q.name === "available");
    if (available) return available.quantity;
  }
  return typeof p.available === "number" ? p.available : 0;
}

/**
 * Resolve an inventory_item gid to its parent product. Uses the offline
 * session's admin client because webhooks don't carry a request session.
 */
async function resolveProduct(
  shop: string,
  inventoryItemId: number,
): Promise<NormalizedProduct | null> {
  const { admin } = await unauthenticated.admin(shop);

  const gid = `gid://shopify/InventoryItem/${inventoryItemId}`;
  const resp = await admin.graphql(
    `#graphql
      query InventoryItemProduct($id: ID!) {
        inventoryItem(id: $id) {
          variant {
            id
            price
            product {
              id
              title
              handle
              status
              descriptionHtml
              featuredImage { url }
              variants(first: 50) { nodes { price } }
            }
          }
        }
      }
    `,
    { variables: { id: gid } },
  );

  type GqlResp = {
    data?: {
      inventoryItem?: {
        variant?: {
          product?: {
            id: string;
            title: string;
            handle: string;
            status: string;
            descriptionHtml: string;
            featuredImage?: { url: string };
            variants: { nodes: Array<{ price: string }> };
          };
        };
      };
    };
  };

  const json = (await resp.json()) as GqlResp;
  const product = json.data?.inventoryItem?.variant?.product;
  if (!product) return null;

  // Convert "gid://shopify/Product/12345" → 12345 for the lib's id field
  const numericId = Number(product.id.split("/").pop());
  if (Number.isNaN(numericId)) return null;

  const prices = product.variants.nodes
    .map((v) => parseFloat(v.price))
    .filter((n) => Number.isFinite(n));
  const lowestPrice = prices.length > 0 ? Math.min(...prices).toFixed(2) : "0.00";

  return {
    id: numericId,
    title: product.title,
    description: product.descriptionHtml ?? "",
    handle: product.handle,
    price: lowestPrice,
    imageUrl: product.featuredImage?.url,
    // Shopify GraphQL returns status as ACTIVE/DRAFT/ARCHIVED (uppercase)
    isActive: product.status === "ACTIVE",
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const event = payload as unknown as InventoryLevelsUpdatePayload;

  const config = await db.shopConfig.findUnique({ where: { shop } });
  if (!config) return new Response(null, { status: 200 });

  const inventoryItemId = String(event.inventory_item_id);
  const current = readAvailable(event);

  // Read the previous snapshot before we update it
  const last = await db.inventorySnapshot.findUnique({
    where: {
      shopConfigId_inventoryItemId: {
        shopConfigId: config.id,
        inventoryItemId,
      },
    },
  });

  const wasOutOfStock = !last || last.available <= 0;
  const isNowInStock = current > 0;
  const triggered = wasOutOfStock && isNowInStock;

  // Always upsert the snapshot so the next webhook has fresh state, even
  // if we don't fire the trigger
  await db.inventorySnapshot.upsert({
    where: {
      shopConfigId_inventoryItemId: {
        shopConfigId: config.id,
        inventoryItemId,
      },
    },
    create: {
      shopConfigId: config.id,
      inventoryItemId,
      available: current,
    },
    update: { available: current },
  });

  if (!triggered || !config.autoPostBackInStock) {
    return new Response(null, { status: 200 });
  }

  try {
    const product = await resolveProduct(shop, event.inventory_item_id);
    if (!product) return new Response(null, { status: 200 });

    // Dedupe: don't post back-in-stock for the same product more than
    // once per 24h (some products yo-yo across 0 multiple times a day)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60_000);
    const recent = await db.postLog.findFirst({
      where: {
        shopConfigId: config.id,
        shopifyProductId: `gid://shopify/Product/${product.id}`,
        triggerType: "back_in_stock",
        createdAt: { gte: oneDayAgo },
      },
    });
    if (recent) return new Response(null, { status: 200 });

    await createAutoPost(config, product, "back_in_stock");
  } catch (err) {
    console.error(
      `Back-in-stock auto-post failed for inventory_item ${event.inventory_item_id}:`,
      err,
    );
  }

  return new Response(null, { status: 200 });
};
