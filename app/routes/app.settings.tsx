import { useState } from "react";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { decrypt } from "../lib/encryption.server";
import { ZernioClient } from "../lib/zernio-client";

/**
 * Settings page — organized into clearly-headed sections rather than tabs
 * (Polaris web components don't ship a tabs primitive). The layout is
 * one column with strong visual hierarchy via s-section heading + Help
 * aside.
 *
 * Sections:
 *   - Connection: API key
 *   - Defaults: profile, timezone
 *   - Auto-publish: product/price-drop/back-in-stock toggles
 *   - Links: UTM tracking toggle
 *   - Danger: disconnect Zernio
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const config = await db.shopConfig.findUnique({
    where: { shop: session.shop },
  });
  if (!config) return { configured: false };

  let profiles: Array<{ _id: string; name: string }> = [];
  try {
    const apiKey = decrypt(config.zernioApiKeyEncrypted);
    const client = new ZernioClient(apiKey);
    const fetched = await client.getProfiles();
    profiles = fetched.map((p) => ({ _id: p._id, name: p.name }));
  } catch {
    // Bad key — leave profiles empty so the user sees the option to re-enter
  }

  // Backfill defaultTimezone from shop.ianaTimezone when we still have the
  // legacy "UTC" placeholder (the Prisma default).
  let defaultTimezone = config.defaultTimezone;
  if (!defaultTimezone || defaultTimezone === "UTC") {
    try {
      const shopResp = await admin.graphql(`#graphql
        query ShopTimezone { shop { ianaTimezone } }
      `);
      const shopData = (await shopResp.json())?.data?.shop;
      const iana = shopData?.ianaTimezone;
      if (iana && iana !== defaultTimezone) {
        defaultTimezone = iana;
        await db.shopConfig.update({
          where: { shop: session.shop },
          data: { defaultTimezone: iana },
        });
      }
    } catch {
      // Non-fatal
    }
  }

  // Timezone option groups
  const allZones = new Set<string>(Intl.supportedValuesOf("timeZone"));
  allZones.add("UTC");
  if (defaultTimezone) allZones.add(defaultTimezone);
  const zonesByRegion: Record<string, string[]> = {};
  for (const z of allZones) {
    const region = z.includes("/") ? z.split("/")[0] : "Other";
    (zonesByRegion[region] ||= []).push(z);
  }
  const timezoneGroups = Object.entries(zonesByRegion)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([region, zones]) => ({ region, zones: zones.sort() }));

  return {
    configured: true,
    shop: session.shop,
    keyPreview: config.zernioApiKeyPreview || "sk_***",
    defaultProfileId: config.defaultProfileId,
    defaultTimezone,
    autoPostNewProducts: config.autoPostNewProducts,
    autoPostBackInStock: config.autoPostBackInStock,
    autoPostPriceDrop: config.autoPostPriceDrop,
    utmEnabled: config.utmEnabled,
    profiles,
    timezoneGroups,
  };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  // ── State (all hooks above any early return) ───────────────────────
  const [keySubmitState, setKeySubmitState] = useState<
    "idle" | "sending" | "done" | "error"
  >("idle");
  const [keyError, setKeyError] = useState("");
  const [settingsSubmitState, setSettingsSubmitState] = useState<
    "idle" | "sending" | "done" | "error"
  >("idle");
  const [settingsError, setSettingsError] = useState("");

  const [apiKeyValue, setApiKeyValue] = useState("");
  const [profileId, setProfileId] = useState(data.defaultProfileId || "");
  const [timezone, setTimezone] = useState(data.defaultTimezone || "UTC");
  const [autoPostNewProducts, setAutoPostNewProducts] = useState(
    data.autoPostNewProducts || false,
  );
  const [autoPostBackInStock, setAutoPostBackInStock] = useState(
    data.autoPostBackInStock || false,
  );
  const [autoPostPriceDrop, setAutoPostPriceDrop] = useState(
    data.autoPostPriceDrop || false,
  );
  const [utmEnabled, setUtmEnabled] = useState(data.utmEnabled || false);

  if (!data.configured) {
    return (
      <s-page heading="Settings">
        <s-section>
          <s-banner tone="warning">Please complete setup first.</s-banner>
          <s-button onClick={() => navigate("/app")}>Go to setup</s-button>
        </s-section>
      </s-page>
    );
  }

  // ── Handlers ───────────────────────────────────────────────────────
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
          setApiKeyValue("");
          shopify.toast.show("API key updated");
        } else {
          setKeySubmitState("error");
          setKeyError(result.error || "Unknown error");
        }
      } catch {
        setKeySubmitState("error");
        setKeyError("Bad response from server");
      }
    };
    xhr.onerror = () => {
      setKeySubmitState("error");
      setKeyError("Network error. Try again.");
    };
    xhr.send(body.toString());
  };

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
    if (utmEnabled) body.append("utmEnabled", "on");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/update-settings", true);
    xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        if (result.success) {
          setSettingsSubmitState("done");
          shopify.toast.show("Settings saved");
        } else {
          setSettingsSubmitState("error");
          setSettingsError(result.error || "Unknown error");
        }
      } catch {
        setSettingsSubmitState("error");
        setSettingsError("Bad response from server");
      }
    };
    xhr.onerror = () => {
      setSettingsSubmitState("error");
      setSettingsError("Network error. Try again.");
    };
    xhr.send(body.toString());
  };

  // Live preview of UTM injection on the merchant's product URL
  const utmExample = (() => {
    const baseUrl = `https://${data.shop}/products/sample`;
    if (!utmEnabled) return baseUrl;
    return `${baseUrl}?utm_source=zernio&utm_medium=social&utm_campaign=instagram`;
  })();

  return (
    <s-page heading="Settings">
      {/* ── Connection ──────────────────────────────────────── */}
      <s-section heading="Zernio connection">
        <s-paragraph>
          Current key: <s-text fontWeight="bold">{data.keyPreview}</s-text>
        </s-paragraph>
        {keyError && <s-banner tone="critical">{keyError}</s-banner>}
        <s-text-field
          label="Replace API key"
          details="Paste a new key to rotate. The current key keeps working until this saves."
          type="password"
          value={apiKeyValue}
          placeholder="sk_..."
          autoComplete="off"
          onChange={(e: any) => setApiKeyValue(e.currentTarget.value)}
        ></s-text-field>
        <s-button
          disabled={
            keySubmitState === "sending" || !apiKeyValue || undefined
          }
          onClick={handleUpdateKey}
        >
          {keySubmitState === "sending" ? "Updating…" : "Update API key"}
        </s-button>
      </s-section>

      {/* ── Defaults ────────────────────────────────────────── */}
      <s-section heading="Defaults">
        {settingsError && (
          <s-banner tone="critical">{settingsError}</s-banner>
        )}

        {data.profiles && data.profiles.length > 0 && (
          <s-select
            label="Default Zernio profile"
            details="New posts use this profile's connected accounts unless overridden"
            value={profileId}
            onChange={(e: any) => setProfileId(e.currentTarget.value)}
          >
            <s-option value="">None</s-option>
            {data.profiles.map((p: { _id: string; name: string }) => (
              <s-option key={p._id} value={p._id}>
                {p.name}
              </s-option>
            ))}
          </s-select>
        )}

        <s-select
          label="Default timezone"
          details="Used to interpret scheduled times (auto-detected from your shop)"
          value={timezone}
          onChange={(e: any) => setTimezone(e.currentTarget.value)}
        >
          {data.timezoneGroups?.map(
            (group: { region: string; zones: string[] }) => (
              <s-option-group key={group.region} label={group.region}>
                {group.zones.map((z: string) => (
                  <s-option key={z} value={z}>
                    {z}
                  </s-option>
                ))}
              </s-option-group>
            ),
          )}
        </s-select>
      </s-section>

      {/* ── Auto-publish ────────────────────────────────────── */}
      <s-section heading="Auto-publish triggers">
        <s-paragraph>
          Publish automatically when a product event happens in Shopify.
          Posts go live immediately by default — set a delay or fixed
          time on a Template if you need scheduling.
        </s-paragraph>

        <s-checkbox
          label="When a product is created"
          details="Fires on products/create. Skips drafts."
          checked={autoPostNewProducts || undefined}
          onChange={() => setAutoPostNewProducts((prev) => !prev)}
        ></s-checkbox>

        <s-checkbox
          label="When a product goes on sale"
          details="Fires when compare-at price is set above current price. Dedupes per product for 1 hour."
          checked={autoPostPriceDrop || undefined}
          onChange={() => setAutoPostPriceDrop((prev) => !prev)}
        ></s-checkbox>

        <s-checkbox
          label="When a product is back in stock"
          details="Fires when any variant goes from 0 to any positive count. Dedupes per product for 24 hours."
          checked={autoPostBackInStock || undefined}
          onChange={() => setAutoPostBackInStock((prev) => !prev)}
        ></s-checkbox>
      </s-section>

      {/* ── Links ───────────────────────────────────────────── */}
      <s-section heading="Links">
        <s-checkbox
          label="Add UTM tracking to product links"
          details="Appends utm_source/utm_medium/utm_campaign to your storefront URLs in posts so you can attribute social traffic in analytics."
          checked={utmEnabled || undefined}
          onChange={() => setUtmEnabled((prev) => !prev)}
        ></s-checkbox>

        <s-box
          padding="small-200"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <s-stack direction="block" gap="small-100">
            <s-text color="subdued">Example link:</s-text>
            <s-text>{utmExample}</s-text>
          </s-stack>
        </s-box>
      </s-section>

      {/* ── Save bar ────────────────────────────────────────── */}
      <s-section>
        <s-button
          variant="primary"
          disabled={settingsSubmitState === "sending" || undefined}
          onClick={handleUpdateSettings}
        >
          {settingsSubmitState === "sending" ? "Saving…" : "Save settings"}
        </s-button>
      </s-section>

      {/* ── Danger zone ─────────────────────────────────────── */}
      <s-section heading="Disconnect">
        <s-paragraph>
          To remove this app entirely, uninstall it from your Shopify
          admin's Apps page. Uninstalling deletes all of this app's data
          for your store (templates, post history, settings).
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Help">
        <s-unordered-list>
          <s-list-item>
            <s-link href="https://zernio.com/dashboard/api-keys" target="_blank">
              Manage API keys at zernio.com →
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="https://docs.zernio.com" target="_blank">
              Zernio API docs →
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="https://github.com/zernio-dev/zernio-shopify" target="_blank">
              Source code on GitHub →
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
