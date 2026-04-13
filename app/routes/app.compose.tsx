import { useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { decrypt } from "../lib/encryption.server";
import { ZernioClient } from "../lib/zernio-client";
import { PRODUCT_DETAIL_QUERY } from "../lib/shopify-products.server";
import type { ShopifyProductDetail } from "../lib/shopify-products.server";

/**
 * Compose page — turn a Shopify product into a Zernio post.
 *
 * Supports:
 *   - Quick-start from a manual PostTemplate
 *   - Shared caption + per-platform caption overrides with live char counts
 *   - Multi-image media picker + per-platform image overrides
 *   - Account selection grouped by platform
 *   - Publish immediately or schedule at a specific moment
 *
 * All form submission goes via XHR to /api/create-post (avoids the
 * embedded-app POST 410 issue).
 */

// Per-platform character limits used for the live counter. Soft caps —
// we don't enforce them client-side (Zernio handles platform-specific
// validation server-side), just show a visual warning.
const PLATFORM_LIMITS: Record<string, number> = {
  twitter: 280,
  x: 280,
  bluesky: 300,
  threads: 500,
  pinterest: 500,
  snapchat: 250,
  googlebusiness: 1500,
  google_business: 1500,
  instagram: 2200,
  tiktok: 2200,
  linkedin: 3000,
  telegram: 4096,
  youtube: 5000,
  reddit: 40000,
  facebook: 63206,
};

function limitFor(platform: string): number | null {
  return PLATFORM_LIMITS[platform.toLowerCase()] ?? null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  const templateId = url.searchParams.get("templateId");

  if (!productId) {
    return { error: "No product selected", product: null, accounts: [], templates: [] };
  }

  const response = await admin.graphql(PRODUCT_DETAIL_QUERY, {
    variables: { id: productId },
  });
  const { data } = await response.json();
  const product = data.product as ShopifyProductDetail | null;
  if (!product) {
    return { error: "Product not found", product: null, accounts: [], templates: [] };
  }

  const config = await db.shopConfig.findUnique({
    where: { shop: session.shop },
  });
  if (!config?.onboardingComplete) {
    return {
      error: "Please complete setup first",
      product,
      accounts: [],
      templates: [],
    };
  }

  // Manual templates double as quick-start presets in the composer
  const templates = await db.postTemplate.findMany({
    where: {
      shopConfigId: config.id,
      isActive: true,
      triggerType: "manual",
    },
    orderBy: { updatedAt: "desc" },
  });

  let accounts: Array<{
    _id: string;
    platform: string;
    username: string;
    isActive: boolean;
  }> = [];
  try {
    const apiKey = decrypt(config.zernioApiKeyEncrypted);
    const client = new ZernioClient(apiKey);
    const fetched = await client.getAccounts(config.defaultProfileId || undefined);
    accounts = fetched.map((a) => ({
      _id: a._id,
      platform: a.platform,
      username: a.username,
      isActive: a.isActive,
    }));
  } catch {
    return {
      error: "Could not load Zernio accounts. Check your API key in Settings.",
      product,
      accounts,
      templates,
      defaultTimezone: config.defaultTimezone,
    };
  }

  return {
    product,
    accounts,
    templates,
    defaultTimezone: config.defaultTimezone,
    initialTemplateId: templateId,
  };
};

/** Apply mustache substitutions for the manual-template quick-start. */
function renderManualTemplate(
  tpl: string,
  product: ShopifyProductDetail,
): string {
  return tpl
    .replace(/\{\{title\}\}/g, product.title)
    .replace(/\{\{price\}\}/g, product.priceRangeV2?.minVariantPrice?.amount ?? "")
    .replace(/\{\{url\}\}/g, product.onlineStoreUrl ?? "")
    .replace(/\{\{description\}\}/g, (product.description ?? "").slice(0, 200));
}

export default function Compose() {
  const data = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const product = data.product;
  const accounts = data.accounts;
  const templates = data.templates;

  // Default caption: use selected manual template or fall back to title +
  // description snippet + storefront URL.
  const initialContent = useMemo(() => {
    if (!product) return "";
    if (data.initialTemplateId) {
      const t = templates.find((x: { id: string }) => x.id === data.initialTemplateId);
      if (t) return renderManualTemplate(t.contentTemplate, product);
    }
    const desc = product.description
      ? `\n\n${product.description.slice(0, 200)}${product.description.length > 200 ? "..." : ""}`
      : "";
    const url = product.onlineStoreUrl ? `\n\n${product.onlineStoreUrl}` : "";
    return `${product.title}${desc}${url}`;
  }, [product, data.initialTemplateId, templates]);

  // ── State (all hooks above the early return) ────────────────────────
  const [postContent, setPostContent] = useState(initialContent);
  const [publishNow, setPublishNow] = useState(true);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<string[]>(
    product?.featuredImage?.url ? [product.featuredImage.url] : [],
  );
  const [scheduledFor, setScheduledFor] = useState("");
  const [templateId, setTemplateId] = useState<string>(data.initialTemplateId ?? "");
  // overrides keyed by "platform:accountId"
  const [overrides, setOverrides] = useState<
    Record<string, { content?: string; media?: string[] }>
  >({});
  const [submitState, setSubmitState] = useState<
    "idle" | "sending" | "done" | "error"
  >("idle");
  const [submitError, setSubmitError] = useState("");

  // Early returns ─────────────────────────────────────────────────────
  if (data.error && !product) {
    return (
      <s-page heading="Share to social">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-banner tone="critical">{data.error}</s-banner>
            <s-button onClick={() => navigate("/app/products")}>
              Back to products
            </s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }
  if (!product) return null;

  if (submitState === "done") {
    return (
      <s-page heading="Done">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-banner tone="success">
              Your post for &quot;{product.title}&quot; was sent to Zernio.
            </s-banner>
            <s-stack direction="inline" gap="base">
              <s-button variant="primary" onClick={() => navigate("/app/posts")}>
                View posts
              </s-button>
              <s-button onClick={() => navigate("/app/products")}>
                Back to products
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    if (!id) return;
    const t = templates.find((x: { id: string }) => x.id === id);
    if (t) setPostContent(renderManualTemplate(t.contentTemplate, product));
  };

  const toggleAccount = (key: string) => {
    setSelectedAccounts((prev) =>
      prev.includes(key) ? prev.filter((v) => v !== key) : [...prev, key],
    );
  };

  const setOverrideContent = (key: string, value: string) => {
    setOverrides((prev) => ({
      ...prev,
      [key]: { ...prev[key], content: value },
    }));
  };

  const toggleOverrideMedia = (key: string, url: string) => {
    setOverrides((prev) => {
      const cur = prev[key]?.media ?? selectedMedia;
      const next = cur.includes(url) ? cur.filter((u) => u !== url) : [...cur, url];
      return { ...prev, [key]: { ...prev[key], media: next } };
    });
  };

  const clearOverride = (key: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = () => {
    if (!postContent.trim()) {
      setSubmitError("Caption is required");
      setSubmitState("error");
      return;
    }
    if (selectedAccounts.length === 0) {
      setSubmitError("Select at least one account to post to");
      setSubmitState("error");
      return;
    }

    setSubmitState("sending");
    setSubmitError("");

    // Strip empty overrides so we don't send noise
    const cleanOverrides: Record<string, { content?: string; media?: string[] }> = {};
    for (const key of Object.keys(overrides)) {
      const ov = overrides[key];
      const trimmed: { content?: string; media?: string[] } = {};
      if (ov.content && ov.content.trim()) trimmed.content = ov.content;
      if (ov.media && ov.media.length > 0) trimmed.media = ov.media;
      if (Object.keys(trimmed).length > 0) cleanOverrides[key] = trimmed;
    }

    const body = new URLSearchParams();
    body.append("content", postContent);
    body.append("productId", product.id);
    body.append("productTitle", product.title);
    body.append("publishNow", publishNow ? "true" : "false");
    body.append("timezone", data.defaultTimezone || "UTC");
    body.append("accounts", selectedAccounts.join(","));
    body.append("media", selectedMedia.join(","));
    if (Object.keys(cleanOverrides).length > 0) {
      body.append("overrides", JSON.stringify(cleanOverrides));
    }
    if (scheduledFor && !publishNow) {
      body.append("scheduledFor", new Date(scheduledFor).toISOString());
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/create-post", true);
    xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        if (result.success) {
          setSubmitState("done");
          shopify.toast.show(
            publishNow ? "Post sent to Zernio" : "Post scheduled",
          );
        } else {
          setSubmitState("error");
          setSubmitError(result.error || "Unknown error");
        }
      } catch {
        setSubmitState("error");
        setSubmitError("Bad response from server");
      }
    };
    xhr.onerror = () => {
      setSubmitState("error");
      setSubmitError("Network error. Try again.");
    };
    xhr.send(body.toString());
  };

  // ── Render ──────────────────────────────────────────────────────────
  const submitLabel = submitState === "sending"
    ? "Sending..."
    : publishNow
      ? "Publish now"
      : scheduledFor
        ? "Schedule post"
        : "Save as draft";

  return (
    <s-page heading="Share to social" subtitle={product.title}>
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={submitState === "sending" || undefined}
        onClick={handleSubmit}
      >
        {submitLabel}
      </s-button>
      <s-button slot="secondary-actions" onClick={() => navigate("/app/products")}>
        Cancel
      </s-button>

      {submitError && <s-banner tone="critical">{submitError}</s-banner>}
      {data.error && !submitError && (
        <s-banner tone="warning">{data.error}</s-banner>
      )}

      {/* Template quick-start */}
      {templates.length > 0 && (
        <s-section heading="Quick start">
          <s-select
            label="Start from template"
            details="Loads a saved caption format for this product"
            value={templateId}
            onChange={(e: any) => applyTemplate(e.currentTarget.value)}
          >
            <s-option value="">Blank caption</s-option>
            {templates.map((t: { id: string; name: string }) => (
              <s-option key={t.id} value={t.id}>
                {t.name}
              </s-option>
            ))}
          </s-select>
        </s-section>
      )}

      {/* Caption */}
      <s-section heading="Caption">
        <s-text-area
          label="Shared across all platforms"
          rows={6}
          value={postContent}
          onChange={(e: any) => setPostContent(e.currentTarget.value)}
        ></s-text-area>
        <s-text color="subdued">
          {postContent.length} characters
        </s-text>
      </s-section>

      {/* Media */}
      {product.images.nodes.length > 0 && (
        <s-section heading="Images">
          <s-paragraph>
            Pick which product images to attach. The composer adds the
            featured image by default.
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            {product.images.nodes.map(
              (img: { id: string; url: string; altText: string | null }) => {
                const isSelected = selectedMedia.includes(img.url);
                return (
                  <s-stack
                    key={img.id}
                    direction="block"
                    gap="small-200"
                    alignItems="center"
                  >
                    <s-checkbox
                      label=""
                      checked={isSelected || undefined}
                      onChange={() =>
                        setSelectedMedia((prev) =>
                          isSelected
                            ? prev.filter((u) => u !== img.url)
                            : [...prev, img.url],
                        )
                      }
                    ></s-checkbox>
                    <s-thumbnail
                      source={img.url}
                      alt={img.altText || product.title}
                    />
                  </s-stack>
                );
              },
            )}
          </s-stack>
        </s-section>
      )}

      {/* Accounts */}
      <s-section heading="Post to">
        {accounts.length === 0 ? (
          <s-banner tone="warning">
            No social accounts found. Connect them at zernio.com.
          </s-banner>
        ) : (
          <s-stack direction="block" gap="small-200">
            {accounts.map((acc) => {
              const key = `${acc.platform}:${acc._id}`;
              const checked = selectedAccounts.includes(key);
              return (
                <s-checkbox
                  key={acc._id}
                  label={`${acc.platform} — @${acc.username}`}
                  checked={checked || undefined}
                  disabled={!acc.isActive || undefined}
                  onChange={() => toggleAccount(key)}
                ></s-checkbox>
              );
            })}
          </s-stack>
        )}
      </s-section>

      {/* Per-platform overrides — one card per selected account */}
      {selectedAccounts.length > 0 && (
        <s-section heading="Customize per platform (optional)">
          <s-paragraph>
            Tailor the caption or images for a specific platform. Anything
            you leave blank uses the shared caption above.
          </s-paragraph>
          <s-stack direction="block" gap="base">
            {selectedAccounts.map((key) => {
              const [platform, accountId] = key.split(":");
              const acc = accounts.find((a) => a._id === accountId);
              const ov = overrides[key];
              const content = ov?.content ?? "";
              const overrideMedia = ov?.media ?? selectedMedia;
              const limit = limitFor(platform);
              const effectiveContent = content || postContent;
              const tone =
                limit && effectiveContent.length > limit
                  ? "critical"
                  : limit && effectiveContent.length > limit * 0.9
                    ? "caution"
                    : undefined;

              return (
                <s-box
                  key={key}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack direction="block" gap="small-200">
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-text fontWeight="bold">
                        {platform} — @{acc?.username ?? "unknown"}
                      </s-text>
                      <s-badge tone={tone}>
                        {limit
                          ? `${effectiveContent.length} / ${limit}`
                          : `${effectiveContent.length}`}
                      </s-badge>
                      {(ov?.content || ov?.media) && (
                        <s-button size="slim" onClick={() => clearOverride(key)}>
                          Clear override
                        </s-button>
                      )}
                    </s-stack>

                    <s-text-area
                      label="Caption override"
                      details="Leave blank to use the shared caption"
                      rows={4}
                      value={content}
                      placeholder={postContent}
                      onChange={(e: any) =>
                        setOverrideContent(key, e.currentTarget.value)
                      }
                    ></s-text-area>

                    {product.images.nodes.length > 0 && (
                      <s-stack direction="block" gap="small-100">
                        <s-text color="subdued">Image override</s-text>
                        <s-stack direction="inline" gap="small-200">
                          {product.images.nodes.map(
                            (img: {
                              id: string;
                              url: string;
                              altText: string | null;
                            }) => {
                              const isSelected = overrideMedia.includes(img.url);
                              return (
                                <s-stack
                                  key={img.id}
                                  direction="block"
                                  gap="small-100"
                                  alignItems="center"
                                >
                                  <s-checkbox
                                    label=""
                                    checked={isSelected || undefined}
                                    onChange={() => toggleOverrideMedia(key, img.url)}
                                  ></s-checkbox>
                                  <s-thumbnail
                                    source={img.url}
                                    alt={img.altText || product.title}
                                  />
                                </s-stack>
                              );
                            },
                          )}
                        </s-stack>
                      </s-stack>
                    )}
                  </s-stack>
                </s-box>
              );
            })}
          </s-stack>
        </s-section>
      )}

      {/* Schedule */}
      <s-section heading="When to publish">
        <s-checkbox
          label="Publish immediately"
          checked={publishNow || undefined}
          onChange={() => setPublishNow((prev) => !prev)}
        ></s-checkbox>

        {!publishNow && (
          <s-stack direction="block" gap="small-100">
            <s-text-field
              label="Schedule for"
              type="datetime-local"
              value={scheduledFor}
              onChange={(e: any) => setScheduledFor(e.currentTarget.value)}
            ></s-text-field>
            <s-text color="subdued">
              Times use {data.defaultTimezone || "UTC"}.
              {scheduledFor &&
                ` Will publish ${new Date(scheduledFor).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}.`}
            </s-text>
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
