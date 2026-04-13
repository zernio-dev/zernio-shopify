import { useEffect, useState } from "react";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Dashboard.
 *
 * - When the merchant hasn't connected Zernio yet, render an inline
 *   onboarding card that posts to /api/verify-key.
 * - Once connected, render at-a-glance stats + the most recent posts.
 *
 * All "stats this week / pending / succeeded" numbers come from PostLog
 * — no live Zernio API calls on dashboard load (Zernio webhooks update
 * the local rows asynchronously).
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await db.shopConfig.findUnique({
    where: { shop: session.shop },
  });

  if (!config?.onboardingComplete) {
    return {
      onboarded: false,
      hasProfile: false,
      stats: { thisWeek: 0, pending: 0, published7d: 0 },
      recentPosts: [],
    };
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const startOfWeek = new Date();
  // Monday-start of the current week (or today if it's Monday)
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(
    startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7),
  );

  const [thisWeek, pending, published7d, recentPosts] = await Promise.all([
    db.postLog.count({
      where: { shopConfigId: config.id, createdAt: { gte: startOfWeek } },
    }),
    db.postLog.count({
      where: {
        shopConfigId: config.id,
        status: { in: ["pending", "scheduled", "publishing"] },
      },
    }),
    db.postLog.count({
      where: {
        shopConfigId: config.id,
        status: "published",
        publishedAt: { gte: sevenDaysAgo },
      },
    }),
    db.postLog.findMany({
      where: { shopConfigId: config.id },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
  ]);

  return {
    onboarded: true,
    hasProfile: !!config.defaultProfileId,
    stats: { thisWeek, pending, published7d },
    recentPosts,
  };
};

export default function AppIndex() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher<{ success?: boolean; plan?: string; error?: string }>();
  const shopify = useAppBridge();

  const [apiKeyValue, setApiKeyValue] = useState("");
  // `now` stays null on the server and during the first client paint — that
  // way SSR and the initial client render produce the same HTML. We only
  // swap to relative timestamps after hydration.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);
  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  // Toast and refresh once verify succeeds
  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Connected to Zernio!");
      // Force the loader to re-run so we drop into the dashboard
      setTimeout(() => navigate("/app", { replace: true }), 600);
    }
  }, [fetcher.data, shopify, navigate]);

  // ── Onboarding ─────────────────────────────────────────────────────
  if (!data.onboarded && !fetcher.data?.success) {
    const handleConnect = () => {
      const val = apiKeyValue.trim();
      if (!val.startsWith("sk_")) {
        shopify.toast.show("API key must start with sk_", { isError: true });
        return;
      }
      fetcher.submit({ apiKey: val }, { method: "POST", action: "/api/verify-key" });
    };

    return (
      <s-page heading="Welcome to Zernio for Shopify">
        <s-section heading="Connect your Zernio account">
          <s-paragraph>
            Paste your Zernio API key to start scheduling social posts for
            your Shopify products across 13 platforms.
          </s-paragraph>
          <s-paragraph>
            Need a key?{" "}
            <s-link href="https://zernio.com/dashboard/api-keys" target="_blank">
              Get one at zernio.com →
            </s-link>
          </s-paragraph>

          <s-text-field
            label="Zernio API key"
            type="password"
            value={apiKeyValue}
            placeholder="sk_..."
            autoComplete="off"
            onChange={(e: any) => setApiKeyValue(e.currentTarget.value)}
          ></s-text-field>

          {fetcher.data?.error && (
            <s-banner tone="critical">{fetcher.data.error}</s-banner>
          )}

          <s-button
            variant="primary"
            disabled={isLoading || undefined}
            onClick={handleConnect}
          >
            {isLoading ? "Connecting…" : "Connect"}
          </s-button>
        </s-section>

        <s-section slot="aside" heading="What you'll get">
          <s-unordered-list>
            <s-list-item>
              Browse your products and post to social with one click
            </s-list-item>
            <s-list-item>
              Schedule posts in your timezone, or auto-publish on price
              drop / new product / back in stock
            </s-list-item>
            <s-list-item>
              Customize captions and images per platform
            </s-list-item>
            <s-list-item>
              Bulk-schedule a whole catalog from the product list
            </s-list-item>
          </s-unordered-list>
        </s-section>
      </s-page>
    );
  }

  // ── Dashboard ──────────────────────────────────────────────────────
  return (
    <s-page heading="Zernio">
      <s-button slot="primary-action" variant="primary" onClick={() => navigate("/app/products")}>
        Browse products
      </s-button>
      <s-button slot="secondary-actions" onClick={() => navigate("/app/templates")}>
        Templates
      </s-button>

      {/* Stat cards */}
      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
          <StatCard
            label="Posts created this week"
            value={data.stats.thisWeek}
            tone="info"
          />
          <StatCard
            label="Pending or scheduled"
            value={data.stats.pending}
            tone={data.stats.pending > 0 ? "info" : undefined}
          />
          <StatCard
            label="Published in last 7 days"
            value={data.stats.published7d}
            tone={data.stats.published7d > 0 ? "success" : undefined}
          />
        </s-grid>
      </s-section>

      {/* Recent posts */}
      <s-section heading="Recent posts">
        {data.recentPosts.length === 0 ? (
          <s-empty-state heading="No posts yet">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Schedule your first post from a product, or set up a
                template that auto-publishes when products change.
              </s-paragraph>
              <s-stack direction="inline" gap="small-200">
                <s-button variant="primary" onClick={() => navigate("/app/products")}>
                  Browse products
                </s-button>
                <s-button onClick={() => navigate("/app/templates")}>
                  Create a template
                </s-button>
              </s-stack>
            </s-stack>
          </s-empty-state>
        ) : (
          <s-stack direction="block" gap="small-200">
            {data.recentPosts.map((post: {
              id: string;
              shopifyProductTitle: string | null;
              status: string;
              triggerType: string;
              platforms: string[];
              createdAt: string | Date;
              scheduledFor: string | Date | null;
              publishedAt: string | Date | null;
            }) => (
              <s-box
                key={post.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-stack direction="block" gap="small-100">
                    <s-text fontWeight="bold">
                      {post.shopifyProductTitle || "Unknown product"}
                    </s-text>
                    <s-stack direction="inline" gap="small-100" alignItems="center">
                      <s-badge tone={STATUS_TONES[post.status]}>
                        {post.status}
                      </s-badge>
                      <s-badge>
                        {post.triggerType.replace("_", " ")}
                      </s-badge>
                      {post.platforms.length > 0 && (
                        <s-text color="subdued">
                          {post.platforms.join(" · ")}
                        </s-text>
                      )}
                    </s-stack>
                    <s-text color="subdued">
                      {post.publishedAt
                        ? `Published ${now ? formatRelative(post.publishedAt, now) : formatAbsolute(post.publishedAt)}`
                        : post.scheduledFor
                          ? `Scheduled for ${formatAbsolute(post.scheduledFor)}`
                          : `Created ${now ? formatRelative(post.createdAt, now) : formatAbsolute(post.createdAt)}`}
                    </s-text>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
            <s-button onClick={() => navigate("/app/posts")}>View all posts</s-button>
          </s-stack>
        )}
      </s-section>

      {/* Helpful aside if user hasn't picked a default profile yet */}
      {!data.hasProfile && (
        <s-section slot="aside" heading="Set a default profile">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              You haven't picked a default Zernio profile. Posts created
              from this app will use your first connected profile.
            </s-paragraph>
            <s-button onClick={() => navigate("/app/settings")}>
              Open settings
            </s-button>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "info" | "success" | "critical" | undefined;
}) {
  return (
    <s-box padding="large-100" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="small-100">
        <s-text color="subdued">{label}</s-text>
        <s-stack direction="inline" gap="small-200" alignItems="baseline">
          <s-heading>{value}</s-heading>
          {value > 0 && tone && <s-badge tone={tone}>•</s-badge>}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

/**
 * Deterministic absolute timestamp — always renders identical text on the
 * server and client, which avoids React hydration mismatch (errors 418/425).
 *
 * We render this at SSR time. After the page hydrates, individual components
 * may swap to a relative form ("3h ago") via useEffect.
 */
function formatAbsolute(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/**
 * Returns "Xm ago" / "Xh ago" / "Xd ago" — but ONLY after the component
 * has mounted on the client (we pass `now` as a prop so the component
 * itself can null-check before calling). Server-render shows absolute.
 */
function formatRelative(d: string | Date, now: number): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const diffMs = now - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatAbsolute(date);
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
