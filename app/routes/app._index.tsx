import { useEffect, useState, useCallback } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ZernioClient, ZernioApiError } from "../lib/zernio-client";
import { encrypt, apiKeyPreview } from "../lib/encryption.server";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await db.shopConfig.findUnique({
    where: { shop: session.shop },
  });

  if (!config?.onboardingComplete) {
    return { onboarded: false, recentPosts: [] };
  }

  const recentPosts = await db.postLog.findMany({
    where: { shopConfigId: config.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  return { onboarded: true, recentPosts };
};

// ---------------------------------------------------------------------------
// Action - handles API key verification
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  // Use authenticate.admin to get the shop from the session.
  // For POST requests in embedded apps, this uses the session token
  // from the Authorization header added by App Bridge's fetch.
  let shop: string;
  try {
    const { session } = await authenticate.admin(request);
    shop = session.shop;
  } catch (err) {
    // If auth throws a Response (redirect/bounce), catch it and
    // try to get the shop from the URL or return an error.
    if (err instanceof Response) {
      console.log("[zernio] auth redirect in action, status:", err.status);
      // Re-throw so React Router handles the redirect
      throw err;
    }
    throw err;
  }

  console.log("[zernio] action called for", shop);

  const formData = await request.formData();
  const apiKey = formData.get("apiKey") as string;

  console.log("[zernio] apiKey received:", apiKey ? apiKey.slice(0, 8) + "..." : "EMPTY");

  if (!apiKey?.startsWith("sk_")) {
    return { error: "API key must start with sk_" };
  }

  try {
    const client = new ZernioClient(apiKey);
    console.log("[zernio] calling getUser...");
    const user = await client.getUser();
    console.log("[zernio] user plan:", user.planName);

    const profiles = await client.getProfiles();
    console.log("[zernio] profiles:", profiles.length);

    await db.shopConfig.upsert({
      where: { shop },
      create: {
        shop,
        zernioApiKeyEncrypted: encrypt(apiKey),
        zernioApiKeyPreview: apiKeyPreview(apiKey),
        defaultProfileId: profiles[0]?._id || null,
        onboardingComplete: true,
      },
      update: {
        zernioApiKeyEncrypted: encrypt(apiKey),
        zernioApiKeyPreview: apiKeyPreview(apiKey),
        defaultProfileId: profiles[0]?._id || null,
        onboardingComplete: true,
      },
    });

    return { success: true, plan: user.planName };
  } catch (err) {
    console.error("[zernio] error:", err);
    if (err instanceof ZernioApiError && err.status === 401) {
      return { error: "Invalid API key" };
    }
    return { error: "Could not connect to Zernio. Try again." };
  }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AppIndex() {
  const { onboarded, recentPosts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [apiKey, setApiKey] = useState("");

  const isSubmitting = fetcher.state !== "idle";
  const actionData = fetcher.data;

  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show("Connected to Zernio!");
      setTimeout(() => window.location.reload(), 500);
    }
  }, [actionData, shopify]);

  // Onboarding: enter API key
  if (!onboarded && !actionData?.success) {
    return (
      <s-page heading="Connect to Zernio" subtitle="Enter your API key to get started">
        <s-section heading="Get started">
          <s-paragraph>
            Connect your Zernio account to start scheduling social media posts
            for your Shopify products.
          </s-paragraph>
          <s-paragraph>
            <s-link href="https://zernio.com/dashboard/api-keys" target="_blank">
              Get your API key at zernio.com
            </s-link>
          </s-paragraph>
        </s-section>

        <s-section heading="API key">
          <s-stack direction="block" gap="base">
            <label htmlFor="apiKeyInput">
              <s-text fontWeight="bold">Zernio API key</s-text>
            </label>
            <input
              id="apiKeyInput"
              name="apiKey"
              type="password"
              placeholder="sk_..."
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: "14px",
                border: "1px solid #ccc",
                borderRadius: "8px",
              }}
            />

            {actionData?.error && (
              <s-banner tone="critical">{actionData.error}</s-banner>
            )}

            <button
              type="button"
              disabled={isSubmitting || !apiKey}
              onClick={async () => {
                console.log("[zernio] raw fetch starting...");
                try {
                  const body = new URLSearchParams({ apiKey });
                  const res = await fetch("/api/verify-key", {
                    method: "POST",
                    body,
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                  });
                  console.log("[zernio] response status:", res.status);
                  const data = await res.json();
                  console.log("[zernio] response data:", data);
                  if (data.success) {
                    shopify.toast.show("Connected to Zernio!");
                    setTimeout(() => window.location.reload(), 500);
                  } else if (data.error) {
                    setApiKey("");
                    alert("Error: " + data.error);
                  }
                } catch (err) {
                  console.error("[zernio] fetch error:", err);
                  alert("Network error: " + err);
                }
              }}
              style={{
                padding: "8px 24px",
                fontSize: "14px",
                fontWeight: 600,
                backgroundColor: isSubmitting ? "#999" : "#008060",
                color: "white",
                border: "none",
                borderRadius: "8px",
                cursor: isSubmitting ? "wait" : "pointer",
                opacity: !apiKey ? 0.5 : 1,
              }}
            >
              {isSubmitting ? "Connecting..." : "Connect"}
            </button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  // Dashboard
  return (
    <s-page heading="Zernio">
      <s-button slot="primary-action" href="/app/products">
        Share a product
      </s-button>

      <s-section heading="Quick actions">
        <s-stack direction="inline" gap="base">
          <s-button href="/app/products">Browse products</s-button>
          <s-button href="/app/posts">View scheduled posts</s-button>
          <s-button href="/app/settings" variant="tertiary">Settings</s-button>
        </s-stack>
      </s-section>

      <s-section heading="Recent posts">
        {recentPosts.length === 0 ? (
          <s-paragraph>
            No posts yet. Go to <s-link href="/app/products">Products</s-link> to
            schedule your first social media post.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header>
              <s-table-header-cell>Product</s-table-header-cell>
              <s-table-header-cell>Platforms</s-table-header-cell>
              <s-table-header-cell>Status</s-table-header-cell>
            </s-table-header>
            <s-table-body>
              {recentPosts.map(
                (post: {
                  id: string;
                  shopifyProductTitle: string | null;
                  platforms: string[];
                  status: string;
                }) => (
                  <s-table-row key={post.id}>
                    <s-table-cell>
                      {post.shopifyProductTitle || "Unknown"}
                    </s-table-cell>
                    <s-table-cell>{post.platforms.join(", ")}</s-table-cell>
                    <s-table-cell>
                      <s-badge
                        tone={
                          post.status === "published"
                            ? "success"
                            : post.status === "failed"
                              ? "critical"
                              : undefined
                        }
                      >
                        {post.status}
                      </s-badge>
                    </s-table-cell>
                  </s-table-row>
                ),
              )}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
