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

  // Track form values in React state (safer than DOM queries on web components)
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [profileId, setProfileId] = useState(loaderData.defaultProfileId || "");
  const [timezone, setTimezone] = useState(loaderData.defaultTimezone || "UTC");
  const [autoPostNewProducts, setAutoPostNewProducts] = useState(loaderData.autoPostNewProducts || false);
  const [autoPostBackInStock, setAutoPostBackInStock] = useState(loaderData.autoPostBackInStock || false);
  const [autoPostPriceDrop, setAutoPostPriceDrop] = useState(loaderData.autoPostPriceDrop || false);

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
    if (!apiKeyValue.startsWith("sk_")) {
      setKeyError("API key must start with sk_");
      return;
    }

    setKeySubmitState("sending");
    setKeyError("");

    const body = new URLSearchParams();
    body.append("intent", "update-key");
    body.append("apiKey", apiKeyValue);

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
   * Reads values from React state (Polaris web components update state via onChange).
   */
  const handleUpdateSettings = () => {
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
        <s-text-field
          label="New API key"
          name="apiKeyInput"
          type="password"
          value={apiKeyValue}
          placeholder="sk_..."
          autoComplete="off"
          onChange={(e: any) => setApiKeyValue(e.currentTarget.value)}
        ></s-text-field>
        <s-button
          disabled={keySubmitState === "sending" || undefined}
          onClick={handleUpdateKey}
        >
          {keySubmitState === "sending" ? "Updating..." : "Update key"}
        </s-button>
      </s-section>

      {/* Preferences Section */}
      <s-section heading="Preferences">
        {settingsError && (
          <s-banner tone="critical">{settingsError}</s-banner>
        )}

        {loaderData.profiles && loaderData.profiles.length > 0 && (
          // s-select is a Polaris web component and only renders <s-option>
          // children (native <option> elements are ignored, which is why the
          // picker appeared empty). See:
          // https://shopify.dev/docs/api/app-home/web-components/forms/select
          <s-select
            label="Default Zernio profile"
            name="profileIdSelect"
            value={profileId}
            onChange={(e: any) => setProfileId(e.currentTarget.value)}
          >
            <s-option value="">None</s-option>
            {loaderData.profiles.map(
              (p: { _id: string; name: string }) => (
                <s-option key={p._id} value={p._id}>
                  {p.name}
                </s-option>
              ),
            )}
          </s-select>
        )}

        <s-text-field
          label="Default timezone"
          name="timezoneInput"
          value={timezone}
          placeholder="America/New_York"
          helpText="IANA timezone, e.g. America/New_York"
          onChange={(e: any) => setTimezone(e.currentTarget.value)}
        ></s-text-field>

        <s-heading>Auto-post triggers</s-heading>
        <s-paragraph>
          When enabled, the app automatically creates social posts when
          products change in your Shopify store.
        </s-paragraph>
        <s-checkbox
          label="Auto-post new products"
          name="autoPostNewProducts"
          checked={autoPostNewProducts || undefined}
          onChange={() => setAutoPostNewProducts((prev) => !prev)}
        ></s-checkbox>
        <s-checkbox
          label="Auto-post when products are back in stock"
          name="autoPostBackInStock"
          checked={autoPostBackInStock || undefined}
          onChange={() => setAutoPostBackInStock((prev) => !prev)}
        ></s-checkbox>
        <s-checkbox
          label="Auto-post on price drops"
          name="autoPostPriceDrop"
          checked={autoPostPriceDrop || undefined}
          onChange={() => setAutoPostPriceDrop((prev) => !prev)}
        ></s-checkbox>

        <s-button
          variant="primary"
          disabled={settingsSubmitState === "sending" || undefined}
          onClick={handleUpdateSettings}
        >
          {settingsSubmitState === "sending" ? "Saving..." : "Save settings"}
        </s-button>
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
