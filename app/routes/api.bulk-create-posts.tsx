import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { decrypt } from "../lib/encryption.server";
import { unauthenticated } from "../shopify.server";
import {
  ZernioClient,
  type CreatePostParams,
  type MediaItem,
} from "../lib/zernio-client";
import { injectUtm } from "../lib/utm.server";
import { PRODUCTS_BY_IDS_QUERY } from "../lib/shopify-products.server";

/**
 * Batch-create Zernio posts for many products at once.
 *
 * Accepts:
 *   productIds      — comma-separated Shopify gids
 *   templateId?     — PostTemplate id (manual or any trigger type)
 *   accounts?       — comma-separated "platform:accountId" — optional
 *                     fallback when the template has no accountIds
 *   cadenceMinutes  — number of minutes between consecutive posts (0 = all now)
 *   startAt         — ISO timestamp of when the first post fires
 *
 * For each product:
 *   - Renders the template (or default caption)
 *   - Computes scheduledFor = startAt + (i * cadenceMinutes)
 *   - POSTs to Zernio
 *   - Inserts a PostLog row
 *
 * Failures are tracked per-product but don't abort the batch — partial
 * success is preferred over all-or-nothing.
 */

interface BulkProduct {
  id: string;
  title: string;
  handle: string;
  description: string;
  onlineStoreUrl: string | null;
  featuredImage: { url: string; altText: string | null } | null;
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
}

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

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

export const action = async ({ request }: ActionFunctionArgs) => {
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
  const productIds = ((formData.get("productIds") as string) || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (productIds.length === 0) {
    return Response.json({ error: "No products provided" });
  }
  const templateId = formData.get("templateId") as string | null;
  const accountsRaw = (formData.get("accounts") as string) || "";
  const cadenceMinutes = parseInt((formData.get("cadenceMinutes") as string) || "0", 10);
  const startAt = formData.get("startAt") as string;

  // Resolve template (if any)
  let template: {
    contentTemplate: string;
    accountIds: string[];
    platforms: string[];
  } | null = null;
  if (templateId) {
    const t = await db.postTemplate.findFirst({
      where: { id: templateId, shopConfigId: config.id },
    });
    if (t) {
      template = {
        contentTemplate: t.contentTemplate,
        accountIds: t.accountIds,
        platforms: t.platforms,
      };
    }
  }

  // Resolve accounts: explicit picks > template's accountIds > all active in default profile
  const apiKey = decrypt(config.zernioApiKeyEncrypted);
  const client = new ZernioClient(apiKey);
  const liveAccounts = await client.getAccounts(
    config.defaultProfileId || undefined,
  );

  const explicitPicks = accountsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [platform, accountId] = s.split(":");
      return { platform, accountId };
    });

  let platforms: Array<{ platform: string; accountId: string }>;
  if (explicitPicks.length > 0) {
    platforms = explicitPicks;
  } else if (template && template.accountIds.length > 0) {
    platforms = template.accountIds
      .map((id) => {
        const acc = liveAccounts.find((a) => a._id === id);
        if (!acc) return null;
        return { platform: acc.platform, accountId: acc._id };
      })
      .filter(
        (p): p is { platform: string; accountId: string } => p !== null,
      );
  } else {
    platforms = liveAccounts
      .filter((a) => a.isActive)
      .map((a) => ({ platform: a.platform, accountId: a._id }));
  }
  if (platforms.length === 0) {
    return Response.json({
      error: "No target accounts. Pick accounts or define a template with accounts.",
    });
  }

  // Fetch product details for caption rendering
  const { admin } = await unauthenticated.admin(shop);
  const resp = await admin.graphql(PRODUCTS_BY_IDS_QUERY, {
    variables: { ids: productIds },
  });
  const json = (await resp.json()) as { data?: { nodes: Array<BulkProduct | null> } };
  const products = (json.data?.nodes ?? []).filter((p): p is BulkProduct => !!p);
  if (products.length === 0) {
    return Response.json({ error: "Could not load any of the selected products" });
  }

  const start = startAt ? new Date(startAt) : new Date();
  if (Number.isNaN(start.getTime())) {
    return Response.json({ error: "Invalid start time" });
  }

  const results: Array<{ productId: string; ok: boolean; error?: string }> = [];

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    try {
      const productUrl =
        product.onlineStoreUrl ?? `https://${shop}/products/${product.handle}`;
      const description = product.description ? stripHtml(product.description) : "";
      const descSnippet = description.slice(0, 200);

      // Caption from template, or sensible default
      let content: string;
      if (template) {
        content = renderTemplate(template.contentTemplate, {
          title: product.title,
          price: product.priceRangeV2.minVariantPrice.amount,
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
        content = injectUtm(content, { shop });
      }

      // Stagger scheduledFor; cadence=0 → publish now
      const offsetMs = cadenceMinutes * 60_000 * i;
      const when = cadenceMinutes > 0 ? new Date(start.getTime() + offsetMs) : null;

      const mediaItems: MediaItem[] | undefined = product.featuredImage
        ? [{ type: "image", url: product.featuredImage.url }]
        : undefined;

      const params: CreatePostParams = {
        content,
        mediaItems,
        platforms,
        timezone: config.defaultTimezone,
        metadata: {
          source: "shopify",
          productId: product.id,
          shopDomain: shop,
          bulk: true,
          batchSize: products.length,
        },
        ...(when ? { scheduledFor: when.toISOString() } : { publishNow: true }),
      };

      const post = await client.createPost(params);

      await db.postLog.create({
        data: {
          shopConfigId: config.id,
          shopifyProductId: product.id,
          shopifyProductTitle: product.title,
          zernioPostId: post._id,
          status: when ? "scheduled" : "publishing",
          triggerType: "manual",
          platforms: platforms.map((p) => p.platform),
          ...(when ? { scheduledFor: when } : {}),
        },
      });

      results.push({ productId: product.id, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ productId: product.id, ok: false, error: message });
    }
  }

  const created = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  return Response.json({
    success: true,
    total: products.length,
    created,
    failed: failed.length,
    failures: failed,
  });
};
