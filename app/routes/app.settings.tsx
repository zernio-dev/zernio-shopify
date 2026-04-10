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

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const config = await db.shopConfig.findUnique({
    where: { shop: session.shop },
  });

  if (!config) {
    return { configured: false };
  }

  // Fetch profiles so user can change their default
  let profiles: Array<{ _id: string; name: string }> = [];
  try {
    const apiKey = decrypt(config.zernioApiKeyEncrypted);
    const client = new ZernioClient(apiKey);
    const fetched = await client.getProfiles();
    profiles = fetched.map((p) => ({ _id: p._id, name: p.name }));
  } catch {
    // Key may be invalid; let user re-enter
  }

  return {
    configured: true,
    keyPreview: config.zernioApiKeyPreview || "sk_***",
    defaultProfileId: config.defaultProfileId,
    defaultTimezone: config.defaultTimezone,
    autoPostNewProducts: config.autoPostNewProducts,
    autoPostBackInStock: config.autoPostBackInStock,
    autoPostPriceDrop: config.autoPostPriceDrop,
    profiles,
  };
};

// No action handler here. Form submissions use XHR to /api/update-settings
// to bypass the authenticate.admin() 410 issue on POST in embedded apps.

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Settings() {
  const loaderData = useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  const [keySubmitState, setKeySubmitState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [keyError, setKeyError] = useState("");
  const [settingsSubmitState, setSettingsSubmitState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [settingsError, setSettingsError] = useState("");

  // All hooks must be above this line. Early returns below.

  if (!loaderData.configured) {
    return (
      <s-page heading="Settings">
        <s-section>
          <s-banner tone="warning">
            Please complete setup first.
          </s-banner>
          <s-button href="/app">Go to setup</s-button>
        </s-section>
      </s-page>
    );
  }

  /**
   * Submit API key update via XHR to /api/update-settings.
   * Uses XMLHttpRequest to bypass App Bridge's fetch interceptor.
   */
  const handleUpdateKey = () => {
    const apiKeyInput = document.getElementById("apiKeyInput") as HTMLInputElement;
    const apiKey = apiKeyInput?.value || "";

    if (!apiKey.startsWith("sk_")) {
      setKeyError("API key must start with sk_");
      return;
    }

    setKeySubmitState("sending");
    setKeyError("");

    const body = new URLSearchParams();
    body.append("intent", "update-key");
    body.append("apiKey", apiKey);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/update-settings", true);
    xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        if (result.success) {
          setKeySubmitState("done");
          shopify.toast.show(result.success);
        } else {
          setKeySubmitState("error");
          setKeyError(result.error || "Unknown error");
        }
      } catch {
        setKeySubmitState("error");
        setKeyError("Invalid response from server");
      }
    };
    xhr.onerror = () => {
      setKeySubmitState("error");
      setKeyError("Network error. Try again.");
    };
    xhr.send(body.toString());
  };

  /**
   * Submit preferences update via XHR to /api/update-settings.
   * Reads native HTML input values directly from the DOM since
   * Polaris web components don't participate in form submission.
   */
  const handleUpdateSettings = () => {
    const profileId = (document.getElementById("profileIdSelect") as HTMLSelectElement)?.value || "";
    const timezone = (document.getElementById("timezoneInput") as HTMLInputElement)?.value || "UTC";
    const autoPostNewProducts = (document.getElementById("autoPostNewProducts") as HTMLInputElement)?.checked;
    const autoPostBackInStock = (document.getElementById("autoPostBackInStock") as HTMLInputElement)?.checked;
    const autoPostPriceDrop = (document.getElementById("autoPostPriceDrop") as HTMLInputElement)?.checked;

    setSettingsSubmitState("sending");
    setSettingsError("");

    const body = new URLSearchParams();
    body.append("intent", "update-settings");
    body.append("profileId", profileId);
    body.append("timezone", timezone);
    if (autoPostNewProducts) body.append("autoPostNewProducts", "on");
    if (autoPostBackInStock) body.append("autoPostBackInStock", "on");
    if (autoPostPriceDrop) body.append("autoPostPriceDrop", "on");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/update-settings", true);
    xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        if (result.success) {
          setSettingsSubmitState("done");
          shopify.toast.show(result.success);
        } else {
          setSettingsSubmitState("error");
          setSettingsError(result.error || "Unknown error");
        }
      } catch {
        setSettingsSubmitState("error");
        setSettingsError("Invalid response from server");
      }
    };
    xhr.onerror = () => {
      setSettingsSubmitState("error");
      setSettingsError("Network error. Try again.");
    };
    xhr.send(body.toString());
  };

  return (
    <s-page heading="Settings">
      {/* API Key Section */}
      <s-section heading="Zernio API key">
        <s-paragraph>
          Current key: <s-text fontWeight="bold">{loaderData.keyPreview}</s-text>
        </s-paragraph>
        {keyError && (
          <s-banner tone="critical">{keyError}</s-banner>
        )}
        <label>
          <s-text fontWeight="bold">New API key</s-text>
          <input
            id="apiKeyInput"
            type="password"
            placeholder="sk_..."
            autoComplete="off"
            style={{ width: "100%", padding: "8px", fontSize: "14px", border: "1px solid #ccc", borderRadius: "8px", marginTop: "4px", fontFamily: "inherit" }}
          />
        </label>
        <button
          type="button"
          disabled={keySubmitState === "sending"}
          onClick={handleUpdateKey}
          style={{
            padding: "8px 20px",
            fontSize: "14px",
            fontWeight: 600,
            backgroundColor: keySubmitState === "sending" ? "#999" : "#333",
            color: "white",
            border: "none",
            borderRadius: "8px",
            cursor: keySubmitState === "sending" ? "wait" : "pointer",
            marginTop: "8px",
          }}
        >
          {keySubmitState === "sending" ? "Updating..." : "Update key"}
        </button>
      </s-section>

      {/* Preferences Section */}
      <s-section heading="Preferences">
        {settingsError && (
          <s-banner tone="critical">{settingsError}</s-banner>
        )}

        {loaderData.profiles && loaderData.profiles.length > 0 && (
          <label>
            <s-text fontWeight="bold">Default Zernio profile</s-text>
            <select
              id="profileIdSelect"
              defaultValue={loaderData.defaultProfileId || ""}
              style={{ width: "100%", padding: "8px", fontSize: "14px", border: "1px solid #ccc", borderRadius: "8px", marginTop: "4px", fontFamily: "inherit" }}
            >
              <option value="">None</option>
              {loaderData.profiles.map(
                (p: { _id: string; name: string }) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ),
              )}
            </select>
          </label>
        )}

        <label style={{ display: "block", marginTop: "12px" }}>
          <s-text fontWeight="bold">Default timezone</s-text>
          <input
            id="timezoneInput"
            type="text"
            defaultValue={loaderData.defaultTimezone}
            placeholder="America/New_York"
            style={{ width: "100%", padding: "8px", fontSize: "14px", border: "1px solid #ccc", borderRadius: "8px", marginTop: "4px", fontFamily: "inherit" }}
          />
          <s-text tone="subdued">IANA timezone, e.g. America/New_York</s-text>
        </label>

        <s-heading>Auto-post triggers</s-heading>
        <s-paragraph>
          When enabled, the app automatically creates social posts when
          products change in your Shopify store.
        </s-paragraph>
        <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="checkbox"
            id="autoPostNewProducts"
            defaultChecked={loaderData.autoPostNewProducts}
          />
          <span>Auto-post new products</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="checkbox"
            id="autoPostBackInStock"
            defaultChecked={loaderData.autoPostBackInStock}
          />
          <span>Auto-post when products are back in stock</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="checkbox"
            id="autoPostPriceDrop"
            defaultChecked={loaderData.autoPostPriceDrop}
          />
          <span>Auto-post on price drops</span>
        </label>

        <button
          type="button"
          disabled={settingsSubmitState === "sending"}
          onClick={handleUpdateSettings}
          style={{
            padding: "10px 32px",
            fontSize: "14px",
            fontWeight: 600,
            backgroundColor: settingsSubmitState === "sending" ? "#999" : "#008060",
            color: "white",
            border: "none",
            borderRadius: "8px",
            cursor: settingsSubmitState === "sending" ? "wait" : "pointer",
            marginTop: "12px",
          }}
        >
          {settingsSubmitState === "sending" ? "Saving..." : "Save settings"}
        </button>
      </s-section>

      <s-section slot="aside" heading="Help">
        <s-unordered-list>
          <s-list-item>
            <s-link href="https://zernio.com/dashboard/api-keys" target="_blank">
              Manage API keys
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="https://docs.zernio.com" target="_blank">
              Zernio API docs
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="https://github.com/zernio-dev/zernio-shopify" target="_blank">
              Source code
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
