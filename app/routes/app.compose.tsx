import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
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
  const shopify = useAppBridge();

  const [submitState, setSubmitState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [submitError, setSubmitError] = useState("");

  const { product, accounts } = loaderData;

  const defaultContent = product ? [
    product.title,
    product.description ? `\n\n${product.description.slice(0, 200)}${product.description.length > 200 ? "..." : ""}` : "",
    product.onlineStoreUrl ? `\n\n${product.onlineStoreUrl}` : "",
  ].join("") : "";

  // All hooks must be above this line. Early returns below.

  if (loaderData.error && !product) {
    return (
      <s-page heading="Share to social">
        <s-section>
          <s-banner tone="critical">{loaderData.error}</s-banner>
        </s-section>
      </s-page>
    );
  }

  if (!product) return null;

  if (submitState === "done") {
    return (
      <s-page heading="Post created!">
        <s-section>
          <s-banner tone="success">
            Your post for &quot;{product.title}&quot; has been sent to Zernio.
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  useEffect(() => {
    if (fetcher.data?.success) {
      setSubmitState("done");
      shopify.toast.show("Post created!");
    } else if (fetcher.data?.error) {
      setSubmitState("error");
      setSubmitError(fetcher.data.error);
    }
  }, [fetcher.data, shopify]);

  const handleSubmit = async () => {
    const content = (document.getElementById("postContent") as HTMLTextAreaElement)?.value || "";
    const publishNow = (document.getElementById("publishNow") as HTMLInputElement)?.checked;

    const accountCheckboxes = document.querySelectorAll<HTMLInputElement>('input[name="accounts"]:checked');
    const selectedAccounts = Array.from(accountCheckboxes).map(cb => cb.value);

    const mediaCheckboxes = document.querySelectorAll<HTMLInputElement>('input[name="media"]:checked');
    const selectedMedia = Array.from(mediaCheckboxes).map(cb => cb.value);

    if (!content.trim()) { alert("Post content is required"); return; }
    if (selectedAccounts.length === 0) { alert("Select at least one account"); return; }

    setSubmitState("sending");
    setSubmitError("");

    // Use XMLHttpRequest instead of fetch to bypass App Bridge's fetch interceptor
    // which swallows requests in embedded Shopify apps.
    const body = new URLSearchParams();
    body.append("content", content);
    body.append("productId", product.id);
    body.append("productTitle", product.title);
    body.append("publishNow", publishNow ? "true" : "false");
    body.append("timezone", loaderData.defaultTimezone || "UTC");
    body.append("accounts", selectedAccounts.join(","));
    body.append("media", selectedMedia.join(","));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/create-post", true);
    xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        if (result.success) {
          setSubmitState("done");
          shopify.toast.show("Post created!");
        } else {
          setSubmitState("error");
          setSubmitError(result.error || "Unknown error");
        }
      } catch {
        setSubmitState("error");
        setSubmitError("Invalid response from server");
      }
    };
    xhr.onerror = () => {
      setSubmitState("error");
      setSubmitError("Network error. Try again.");
    };
    xhr.send(body.toString());
  };

  return (
    <s-page heading="Share to social" subtitle={product.title}>
      {/* Content */}
      <s-section heading="Post content">
        {submitError && (
          <s-banner tone="critical">{submitError}</s-banner>
        )}
        {loaderData.error && (
          <s-banner tone="warning">{loaderData.error}</s-banner>
        )}
        <label>
          <s-text fontWeight="bold">Caption</s-text>
          <textarea
            id="postContent"
            rows={6}
            defaultValue={defaultContent}
            style={{ width: "100%", padding: "8px", fontSize: "14px", border: "1px solid #ccc", borderRadius: "8px", marginTop: "4px", fontFamily: "inherit" }}
          />
        </label>
      </s-section>

      {/* Media */}
      {product.images.nodes.length > 0 && (
        <s-section heading="Product images">
          <s-paragraph>Select images to include in your post.</s-paragraph>
          <s-stack direction="inline" gap="base">
            {product.images.nodes.map((img: { id: string; url: string; altText: string | null }) => (
              <label key={img.id} style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  name="media"
                  value={img.url}
                  defaultChecked={img.url === product.featuredImage?.url}
                  style={{ marginRight: "4px" }}
                />
                <s-thumbnail source={img.url} alt={img.altText || product.title} />
              </label>
            ))}
          </s-stack>
        </s-section>
      )}

      {/* Accounts */}
      <s-section heading="Post to">
        {accounts.length === 0 ? (
          <s-banner tone="warning">
            No social accounts found. Connect accounts at zernio.com.
          </s-banner>
        ) : (
          <s-stack direction="block" gap="small-200">
            {accounts.map((acc: { _id: string; platform: string; username: string; isActive: boolean }) => (
              <label key={acc._id} style={{ display: "flex", alignItems: "center", gap: "8px", opacity: acc.isActive ? 1 : 0.5 }}>
                <input
                  type="checkbox"
                  name="accounts"
                  value={`${acc.platform}:${acc._id}`}
                  disabled={!acc.isActive}
                />
                <span>{acc.platform} - @{acc.username}</span>
              </label>
            ))}
          </s-stack>
        )}
      </s-section>

      {/* Schedule */}
      <s-section heading="Schedule">
        <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input type="checkbox" id="publishNow" defaultChecked />
          <span>Publish immediately</span>
        </label>
      </s-section>

      {/* Submit */}
      <s-section>
        <button
          type="button"
          disabled={submitState === "sending"}
          onClick={handleSubmit}
          style={{
            padding: "10px 32px",
            fontSize: "14px",
            fontWeight: 600,
            backgroundColor: submitState === "sending" ? "#999" : "#008060",
            color: "white",
            border: "none",
            borderRadius: "8px",
            cursor: submitState === "sending" ? "wait" : "pointer",
          }}
        >
          {submitState === "sending" ? "Sending..." : "Schedule post"}
        </button>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
