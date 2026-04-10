import { useEffect } from "react";
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
import { decrypt } from "../lib/encryption.server";
import { ZernioClient } from "../lib/zernio-client";
import { PRODUCT_DETAIL_QUERY } from "../lib/shopify-products.server";
import type { ShopifyProductDetail } from "../lib/shopify-products.server";

// ---------------------------------------------------------------------------
// Loader: Fetch product details + Zernio accounts
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");

  if (!productId) {
    return { error: "No product selected", product: null, accounts: [], profiles: [] };
  }

  // Fetch product from Shopify
  const response = await admin.graphql(PRODUCT_DETAIL_QUERY, {
    variables: { id: productId },
  });
  const { data } = await response.json();
  const product = data.product as ShopifyProductDetail | null;

  if (!product) {
    return { error: "Product not found", product: null, accounts: [], profiles: [] };
  }

  // Fetch Zernio accounts
  const config = await db.shopConfig.findUnique({
    where: { shop: session.shop },
  });

  if (!config?.onboardingComplete) {
    return { error: "Please complete setup first", product, accounts: [], profiles: [] };
  }

  try {
    const apiKey = decrypt(config.zernioApiKeyEncrypted);
    const client = new ZernioClient(apiKey);
    const accounts = await client.getAccounts(config.defaultProfileId || undefined);
    const profiles = await client.getProfiles();
    return {
      product,
      accounts,
      profiles,
      defaultTimezone: config.defaultTimezone,
      defaultProfileId: config.defaultProfileId,
    };
  } catch {
    return { error: "Could not load Zernio accounts. Check your API key in Settings.", product, accounts: [], profiles: [] };
  }
};

// ---------------------------------------------------------------------------
// Action: Create a post via Zernio API
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const config = await db.shopConfig.findUnique({
    where: { shop: session.shop },
  });
  if (!config) return { error: "Not configured" };

  const apiKey = decrypt(config.zernioApiKeyEncrypted);
  const client = new ZernioClient(apiKey);

  const content = formData.get("content") as string;
  const productId = formData.get("productId") as string;
  const productTitle = formData.get("productTitle") as string;
  const selectedAccounts = formData.getAll("accounts") as string[];
  const mediaUrls = formData.getAll("media") as string[];
  const scheduledFor = formData.get("scheduledFor") as string;
  const publishNow = formData.get("publishNow") === "true";
  const timezone = formData.get("timezone") as string;

  if (!content?.trim()) {
    return { error: "Post content is required" };
  }

  if (selectedAccounts.length === 0) {
    return { error: "Select at least one social account" };
  }

  // Build platforms array: each selected account becomes a platform entry.
  // Account format is "platform:accountId" (set in the checkbox value).
  const platforms = selectedAccounts.map((acc) => {
    const [platform, accountId] = acc.split(":");
    return {
      platform,
      accountId,
      ...(scheduledFor && !publishNow ? { scheduledFor } : {}),
    };
  });

  const mediaItems = mediaUrls
    .filter(Boolean)
    .map((url) => ({ type: "image" as const, url }));

  try {
    const post = await client.createPost({
      content,
      mediaItems: mediaItems.length > 0 ? mediaItems : undefined,
      platforms,
      ...(publishNow ? { publishNow: true } : {}),
      ...(scheduledFor && !publishNow ? { scheduledFor } : {}),
      timezone: timezone || config.defaultTimezone,
      metadata: {
        source: "shopify",
        productId,
        shopDomain: session.shop,
      },
    });

    // Log locally for status tracking
    await db.postLog.create({
      data: {
        shopConfigId: config.id,
        shopifyProductId: productId,
        shopifyProductTitle: productTitle,
        zernioPostId: post._id,
        status: publishNow ? "publishing" : "scheduled",
        triggerType: "manual",
        platforms: platforms.map((p) => p.platform),
        scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      },
    });

    return { success: true, postId: post._id };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create post";
    return { error: message };
  }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Compose() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Post scheduled!");
    }
  }, [fetcher.data, shopify]);

  if (loaderData.error && !loaderData.product) {
    return (
      <s-page heading="Share to social">
        <s-section>
          <s-banner tone="critical">{loaderData.error}</s-banner>
          <s-button href="/app/products">Back to products</s-button>
        </s-section>
      </s-page>
    );
  }

  const { product, accounts } = loaderData;

  if (!product) return null;

  // Build a default caption from product data
  const defaultContent = [
    product.title,
    product.description ? `\n\n${product.description.slice(0, 200)}${product.description.length > 200 ? "..." : ""}` : "",
    product.onlineStoreUrl ? `\n\n${product.onlineStoreUrl}` : "",
  ].join("");

  // Show success state
  if (fetcher.data?.success) {
    return (
      <s-page heading="Post created!">
        <s-section>
          <s-banner tone="success">
            Your post for &quot;{product.title}&quot; has been sent to Zernio.
          </s-banner>
          <s-stack direction="inline" gap="base">
            <s-button href="/app/posts">View posts</s-button>
            <s-button href="/app/products" variant="tertiary">
              Share another product
            </s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Share to social" subtitle={product.title}>
      <s-button slot="primary-action" href="/app/products" variant="tertiary">
        Back
      </s-button>

      <fetcher.Form method="post">
        <input type="hidden" name="productId" value={product.id} />
        <input type="hidden" name="productTitle" value={product.title} />
        <input
          type="hidden"
          name="timezone"
          value={loaderData.defaultTimezone || "UTC"}
        />

        {/* Content */}
        <s-section heading="Post content">
          {fetcher.data?.error && (
            <s-banner tone="critical">{fetcher.data.error}</s-banner>
          )}
          {loaderData.error && (
            <s-banner tone="warning">{loaderData.error}</s-banner>
          )}
          <s-text-area
            name="content"
            label="Caption"
            rows={6}
            defaultValue={defaultContent}
          />
        </s-section>

        {/* Media selection */}
        {product.images.nodes.length > 0 && (
          <s-section heading="Product images">
            <s-paragraph>Select images to include in your post.</s-paragraph>
            <s-stack direction="inline" gap="base">
              {product.images.nodes.map((img) => (
                <label key={img.id} style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    name="media"
                    value={img.url}
                    defaultChecked={
                      img.url === product.featuredImage?.url
                    }
                    style={{ marginRight: "4px" }}
                  />
                  <s-thumbnail
                    source={img.url}
                    alt={img.altText || product.title}
                  />
                </label>
              ))}
            </s-stack>
          </s-section>
        )}

        {/* Account selection */}
        <s-section heading="Post to">
          {accounts.length === 0 ? (
            <s-banner tone="warning">
              No social accounts found. Connect accounts in your{" "}
              <s-link href="https://zernio.com/dashboard" target="_blank">
                Zernio dashboard
              </s-link>
              .
            </s-banner>
          ) : (
            <s-choice-list
              name="accounts"
              title="Select accounts"
              allowMultiple
            >
              {accounts.map((acc) => (
                <s-choice
                  key={acc._id}
                  value={`${acc.platform}:${acc._id}`}
                  label={`${acc.platform} - @${acc.username}`}
                  disabled={!acc.isActive}
                />
              ))}
            </s-choice-list>
          )}
        </s-section>

        {/* Scheduling */}
        <s-section heading="Schedule">
          <s-stack direction="block" gap="base">
            <s-date-field
              name="scheduledFor"
              label="Schedule for (leave empty to publish now)"
            />
            <s-checkbox name="publishNow" value="true" label="Publish immediately" />
          </s-stack>
        </s-section>

        {/* Submit */}
        <s-section>
          <s-button
            type="submit"
            variant="primary"
            {...(isSubmitting ? { loading: true } : {})}
          >
            {isSubmitting ? "Sending..." : "Schedule post"}
          </s-button>
        </s-section>
      </fetcher.Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
