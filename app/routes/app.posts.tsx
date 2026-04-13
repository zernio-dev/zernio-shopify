import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Post history with filters and inline detail expansion.
 *
 * URL params:
 *   status     — published | scheduled | failed | partial | publishing | pending
 *   trigger    — manual | new_product | price_drop | back_in_stock
 *   platform   — instagram | tiktok | …
 *   range      — 24h | 7d | 30d | all
 *
 * All filters are pushed into the URL so the merchant can bookmark a
 * filtered view and so navigation back/forward is intuitive.
 */

const STATUS_TONES: Record<
  string,
  "success" | "warning" | "critical" | "info" | undefined
> = {
  published: "success",
  scheduled: "info",
  pending: undefined,
  publishing: "info",
  partial: "warning",
  failed: "critical",
};

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "scheduled", label: "Scheduled" },
  { value: "publishing", label: "Publishing" },
  { value: "published", label: "Published" },
  { value: "partial", label: "Partial" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
];

const TRIGGER_OPTIONS = [
  { value: "", label: "Any trigger" },
  { value: "manual", label: "Manual" },
  { value: "new_product", label: "New product" },
  { value: "price_drop", label: "Price drop" },
  { value: "back_in_stock", label: "Back in stock" },
];

const RANGE_OPTIONS = [
  { value: "all", label: "All time" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "";
  const trigger = url.searchParams.get("trigger") || "";
  const platform = url.searchParams.get("platform") || "";
  const range = url.searchParams.get("range") || "all";

  const config = await db.shopConfig.findUnique({
    where: { shop: session.shop },
  });
  if (!config) return { posts: [], availablePlatforms: [], filters: { status, trigger, platform, range } };

  // Compute date floor from the range filter
  let createdGte: Date | undefined;
  if (range === "24h") createdGte = new Date(Date.now() - 24 * 60 * 60_000);
  else if (range === "7d") createdGte = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  else if (range === "30d") createdGte = new Date(Date.now() - 30 * 24 * 60 * 60_000);

  const where: Record<string, unknown> = { shopConfigId: config.id };
  if (status) where.status = status;
  if (trigger) where.triggerType = trigger;
  if (platform) where.platforms = { has: platform };
  if (createdGte) where.createdAt = { gte: createdGte };

  const posts = await db.postLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Build the platform filter dropdown from posts we've actually seen
  // (not from a hardcoded list — keeps it accurate per shop)
  const platformsSeen = await db.postLog.findMany({
    where: { shopConfigId: config.id },
    select: { platforms: true },
    take: 500,
  });
  const availablePlatforms = Array.from(
    new Set(platformsSeen.flatMap((p) => p.platforms)),
  ).sort();

  return {
    posts,
    availablePlatforms,
    filters: { status, trigger, platform, range },
  };
};

export default function Posts() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(null);

  const updateFilter = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  };

  const clearFilters = () => setSearchParams({});

  const hasFilters =
    !!data.filters.status ||
    !!data.filters.trigger ||
    !!data.filters.platform ||
    (data.filters.range && data.filters.range !== "all");

  return (
    <s-page heading="Posts">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/products")}
      >
        New post
      </s-button>

      {/* Filters */}
      <s-section heading="Filter">
        <s-stack direction="inline" gap="base" alignItems="end">
          <s-select
            label="Status"
            value={data.filters.status}
            onChange={(e: any) => updateFilter("status", e.currentTarget.value)}
          >
            {STATUS_OPTIONS.map((s) => (
              <s-option key={s.value} value={s.value}>
                {s.label}
              </s-option>
            ))}
          </s-select>

          <s-select
            label="Trigger"
            value={data.filters.trigger}
            onChange={(e: any) => updateFilter("trigger", e.currentTarget.value)}
          >
            {TRIGGER_OPTIONS.map((t) => (
              <s-option key={t.value} value={t.value}>
                {t.label}
              </s-option>
            ))}
          </s-select>

          {data.availablePlatforms.length > 0 && (
            <s-select
              label="Platform"
              value={data.filters.platform}
              onChange={(e: any) => updateFilter("platform", e.currentTarget.value)}
            >
              <s-option value="">Any platform</s-option>
              {data.availablePlatforms.map((p) => (
                <s-option key={p} value={p}>
                  {p}
                </s-option>
              ))}
            </s-select>
          )}

          <s-select
            label="When"
            value={data.filters.range}
            onChange={(e: any) => updateFilter("range", e.currentTarget.value)}
          >
            {RANGE_OPTIONS.map((r) => (
              <s-option key={r.value} value={r.value}>
                {r.label}
              </s-option>
            ))}
          </s-select>

          {hasFilters && <s-button onClick={clearFilters}>Clear</s-button>}
        </s-stack>
      </s-section>

      {/* List */}
      <s-section heading={data.posts.length > 0 ? `${data.posts.length} result${data.posts.length === 1 ? "" : "s"}` : undefined}>
        {data.posts.length === 0 ? (
          <s-empty-state heading="No posts match">
            <s-paragraph>
              {hasFilters
                ? "Adjust the filters or clear them to see all posts."
                : "Schedule your first post from a product."}
            </s-paragraph>
            {hasFilters ? (
              <s-button onClick={clearFilters}>Clear filters</s-button>
            ) : (
              <s-button variant="primary" onClick={() => navigate("/app/products")}>
                Browse products
              </s-button>
            )}
          </s-empty-state>
        ) : (
          <s-stack direction="block" gap="small-200">
            {data.posts.map((post: {
              id: string;
              shopifyProductId: string;
              shopifyProductTitle: string | null;
              zernioPostId: string;
              status: string;
              triggerType: string;
              platforms: string[];
              scheduledFor: string | Date | null;
              publishedAt: string | Date | null;
              errorMessage: string | null;
              createdAt: string | Date;
            }) => {
              const isExpanded = expanded === post.id;
              return (
                <s-box
                  key={post.id}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background={isExpanded ? "subdued" : undefined}
                >
                  <s-clickable
                    onClick={() => setExpanded(isExpanded ? null : post.id)}
                  >
                    <s-stack direction="block" gap="small-100">
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <s-text fontWeight="bold">
                          {post.shopifyProductTitle || "Unknown product"}
                        </s-text>
                        <s-badge tone={STATUS_TONES[post.status]}>
                          {post.status}
                        </s-badge>
                        <s-badge>{post.triggerType.replace("_", " ")}</s-badge>
                      </s-stack>

                      <s-stack direction="inline" gap="small-100" alignItems="center">
                        {post.platforms.map((p) => (
                          <s-badge key={p}>{p}</s-badge>
                        ))}
                      </s-stack>

                      <s-text color="subdued">
                        {post.publishedAt
                          ? `Published ${formatDateTime(post.publishedAt)}`
                          : post.scheduledFor
                            ? `Scheduled for ${formatDateTime(post.scheduledFor)}`
                            : `Created ${formatDateTime(post.createdAt)}`}
                      </s-text>
                    </s-stack>
                  </s-clickable>

                  {isExpanded && (
                    <s-stack direction="block" gap="small-200">
                      <s-divider></s-divider>

                      <s-stack direction="block" gap="small-100">
                        <s-text fontWeight="bold">Details</s-text>
                        <s-text color="subdued">
                          Zernio post ID:&nbsp;
                          <s-text>{post.zernioPostId}</s-text>
                        </s-text>
                        <s-text color="subdued">
                          Created: {formatDateTime(post.createdAt)}
                        </s-text>
                        {post.scheduledFor && (
                          <s-text color="subdued">
                            Scheduled: {formatDateTime(post.scheduledFor)}
                          </s-text>
                        )}
                        {post.publishedAt && (
                          <s-text color="subdued">
                            Published: {formatDateTime(post.publishedAt)}
                          </s-text>
                        )}
                      </s-stack>

                      {post.errorMessage && (
                        <s-banner tone="critical">
                          <s-text fontWeight="bold">Error</s-text>
                          <s-text>{post.errorMessage}</s-text>
                        </s-banner>
                      )}

                      <s-stack direction="inline" gap="small-200">
                        <s-button
                          href={`https://zernio.com/dashboard/posts/${post.zernioPostId}`}
                          target="_blank"
                        >
                          Open in Zernio →
                        </s-button>
                        <s-button
                          onClick={() =>
                            navigate(
                              `/app/compose?productId=${encodeURIComponent(post.shopifyProductId)}`,
                            )
                          }
                        >
                          Repost
                        </s-button>
                      </s-stack>
                    </s-stack>
                  )}
                </s-box>
              );
            })}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

/**
 * Deterministic timestamp formatter — fixed locale + UTC timezone so SSR
 * and client render the same string (no React hydration mismatch).
 */
function formatDateTime(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
