import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Link, useFetcher, useLoaderData, useNavigate } from "react-router";
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
// Action - mirrors the official Shopify template pattern exactly:
// authenticate.admin(request), then do work, then return data.
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  console.log("[zernio] ACTION HIT for", shop);

  const formData = await request.formData();
  const apiKey = formData.get("apiKey") as string;

  console.log("[zernio] apiKey:", apiKey ? apiKey.slice(0, 8) + "..." : "EMPTY");

  if (!apiKey?.startsWith("sk_")) {
    return { error: "API key must start with sk_" };
  }

  try {
    const client = new ZernioClient(apiKey);
    const user = await client.getUser();
    const profiles = await client.getProfiles();

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
    return { error: "Could not connect to Zernio" };
  }
};

// ---------------------------------------------------------------------------
// Component - matches official template pattern: useFetcher + submit
// ---------------------------------------------------------------------------

export default function AppIndex() {
  const { onboarded, recentPosts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const productId = fetcher.data?.success;

  useEffect(() => {
    if (productId) {
      shopify.toast.show("Connected to Zernio!");
    }
  }, [productId, shopify]);

  // Track API key value in React state (safer than DOM queries on web components)
  const [apiKeyValue, setApiKeyValue] = useState("");

  // Onboarding
  if (!onboarded && !fetcher.data?.success) {
    const handleConnect = () => {
      const val = apiKeyValue.trim();
      if (!val.startsWith("sk_")) {
        alert("API key must start with sk_");
        return;
      }
      fetcher.submit({ apiKey: val }, { method: "POST", action: "/api/verify-key" });
    };

    return (
      <s-page heading="Connect to Zernio">
        <s-button slot="primary-action" onClick={handleConnect}>
          Connect
        </s-button>

        <s-section heading="Get started">
          <s-paragraph>
            Enter your Zernio API key to connect your account and start
            scheduling social media posts for your Shopify products.
          </s-paragraph>
          <s-paragraph>
            <s-link href="https://zernio.com/dashboard/api-keys" target="_blank">
              Get your API key at zernio.com
            </s-link>
          </s-paragraph>
        </s-section>

        <s-section heading="API key">
          <s-text-field
            label="API key"
            name="zernioApiKey"
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
            {isLoading ? "Connecting..." : "Connect to Zernio"}
          </s-button>
        </s-section>

        {fetcher.data?.success && (
          <s-section heading="Success!">
            <s-banner tone="success">
              Connected to Zernio ({fetcher.data.plan} plan). Reload to continue.
            </s-banner>
          </s-section>
        )}
      </s-page>
    );
  }

  // Dashboard
  return (
    <s-page heading="Zernio">
      <s-section heading="Quick actions">
        <s-stack direction="inline" gap="base">
          {/* Navigate within the iframe — App Bridge syncs the parent admin URL.
              The previous window.top.location hack tried to push the admin to
              /apps/zernio/* which doesn't exist as a top-level route. */}
          <s-button variant="primary" onClick={() => navigate("/app/products")}>
            Browse products
          </s-button>
          <s-button variant="primary" onClick={() => navigate("/app/posts")}>
            View posts
          </s-button>
          <s-button onClick={() => navigate("/app/settings")}>Settings</s-button>
        </s-stack>
      </s-section>

      <s-section heading="Recent posts">
        {recentPosts.length === 0 ? (
          <s-paragraph>
            No posts yet. Go to <s-link url="/app/products">Products</s-link> to
            schedule your first post.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header>
              <s-table-header-cell>Product</s-table-header-cell>
              <s-table-header-cell>Status</s-table-header-cell>
            </s-table-header>
            <s-table-body>
              {recentPosts.map(
                (post: { id: string; shopifyProductTitle: string | null; status: string }) => (
                  <s-table-row key={post.id}>
                    <s-table-cell>{post.shopifyProductTitle || "Unknown"}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={post.status === "published" ? "success" : post.status === "failed" ? "critical" : undefined}>
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
