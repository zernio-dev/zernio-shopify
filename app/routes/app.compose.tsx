import { useState } from "react";
import type {
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

// No action handler here. Post creation uses XHR to /api/create-post to
// bypass the authenticate.admin() 410 issue on POST in embedded apps.

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

  // Track form values in React state (safer than DOM queries on web components)
  const [postContent, setPostContent] = useState(defaultContent);
  const [publishNow, setPublishNow] = useState(true);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<string[]>(
    product?.featuredImage?.url ? [product.featuredImage.url] : [],
  );
  const [scheduledFor, setScheduledFor] = useState("");

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

  const handleSubmit = async () => {
    if (!postContent.trim()) { alert("Post content is required"); return; }
    if (selectedAccounts.length === 0) { alert("Select at least one account"); return; }

    setSubmitState("sending");
    setSubmitError("");

    // Use XMLHttpRequest instead of fetch to bypass App Bridge's fetch interceptor
    // which swallows requests in embedded Shopify apps.
    const body = new URLSearchParams();
    body.append("content", postContent);
    body.append("productId", product.id);
    body.append("productTitle", product.title);
    body.append("publishNow", publishNow ? "true" : "false");
    body.append("timezone", loaderData.defaultTimezone || "UTC");
    body.append("accounts", selectedAccounts.join(","));
    body.append("media", selectedMedia.join(","));
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
          const toastMsg = publishNow
            ? "Post published!"
            : scheduledFor
              ? "Post scheduled!"
              : "Draft saved!";
          shopify.toast.show(toastMsg);
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
        <s-text-area
          label="Caption"
          name="postContent"
          value={postContent}
          rows={6}
          onChange={(e: any) => setPostContent(e.currentTarget.value)}
        ></s-text-area>
      </s-section>

      {/* Media */}
      {product.images.nodes.length > 0 && (
        <s-section heading="Product images">
          <s-paragraph>Select images to include in your post.</s-paragraph>
          <s-stack direction="inline" gap="base">
            {product.images.nodes.map((img: { id: string; url: string; altText: string | null }) => {
              const isSelected = selectedMedia.includes(img.url);
              return (
                <s-stack key={img.id} direction="block" gap="small-200" align="center">
                  <s-checkbox
                    label=""
                    name={`media-${img.id}`}
                    checked={isSelected || undefined}
                    onChange={() => {
                      setSelectedMedia((prev) =>
                        isSelected
                          ? prev.filter((u) => u !== img.url)
                          : [...prev, img.url],
                      );
                    }}
                  ></s-checkbox>
                  <s-thumbnail source={img.url} alt={img.altText || product.title} />
                </s-stack>
              );
            })}
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
            {accounts.map((acc: { _id: string; platform: string; username: string; isActive: boolean }) => {
              const accValue = `${acc.platform}:${acc._id}`;
              const isChecked = selectedAccounts.includes(accValue);
              return (
                <s-checkbox
                  key={acc._id}
                  label={`${acc.platform} - @${acc.username}`}
                  name={`account-${acc._id}`}
                  checked={isChecked || undefined}
                  disabled={!acc.isActive || undefined}
                  onChange={() => {
                    setSelectedAccounts((prev) =>
                      isChecked
                        ? prev.filter((v) => v !== accValue)
                        : [...prev, accValue],
                    );
                  }}
                ></s-checkbox>
              );
            })}
          </s-stack>
        )}
      </s-section>

      {/* Schedule */}
      <s-section heading="Schedule">
        <s-checkbox
          label="Publish immediately"
          name="publishNow"
          checked={publishNow || undefined}
          onChange={() => setPublishNow((prev) => !prev)}
        ></s-checkbox>

        {/* Date/time picker for scheduling (hidden when "Publish immediately" is checked) */}
        {!publishNow && (
          <div style={{ marginTop: "12px" }}>
            <label
              htmlFor="scheduledFor"
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: 550,
                marginBottom: "4px",
                color: "var(--p-color-text)",
              }}
            >
              Schedule for
            </label>
            <input
              id="scheduledFor"
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
              style={{
                width: "100%",
                maxWidth: "320px",
                padding: "8px 12px",
                fontSize: "14px",
                lineHeight: "20px",
                border: "1px solid var(--p-color-border, #8c9196)",
                borderRadius: "8px",
                backgroundColor: "var(--p-color-bg-surface, #fff)",
                color: "var(--p-color-text, #202223)",
                fontFamily: "inherit",
              }}
            />
            <p
              style={{
                fontSize: "12px",
                color: "var(--p-color-text-secondary, #6d7175)",
                marginTop: "4px",
              }}
            >
              {scheduledFor
                ? `Will be scheduled for ${new Date(scheduledFor).toLocaleString()}`
                : "Leave empty to save as draft"}
            </p>
          </div>
        )}
      </s-section>

      {/* Submit */}
      <s-section>
        <s-button
          variant="primary"
          disabled={submitState === "sending" || undefined}
          onClick={handleSubmit}
        >
          {submitState === "sending"
            ? "Sending..."
            : publishNow
              ? "Publish now"
              : scheduledFor
                ? "Schedule post"
                : "Save as draft"}
        </s-button>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
