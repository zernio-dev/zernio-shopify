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
        <label className="form-label">
          <span className="form-label-text">Caption</span>
          <textarea
            id="postContent"
            rows={6}
            defaultValue={defaultContent}
            className="textarea"
          />
        </label>
      </s-section>

      {/* Media */}
      {product.images.nodes.length > 0 && (
        <s-section heading="Product images">
          <s-paragraph>Select images to include in your post.</s-paragraph>
          <s-stack direction="inline" gap="base">
            {product.images.nodes.map((img: { id: string; url: string; altText: string | null }) => (
              <label key={img.id} className="media-checkbox-label">
                <input
                  type="checkbox"
                  name="media"
                  value={img.url}
                  defaultChecked={img.url === product.featuredImage?.url}
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
              <label key={acc._id} className={`checkbox-label ${!acc.isActive ? "checkbox-label-dimmed" : ""}`}>
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
        <label className="checkbox-label">
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
          className={`btn btn-primary btn-lg ${submitState === "sending" ? "btn-loading" : ""}`}
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
