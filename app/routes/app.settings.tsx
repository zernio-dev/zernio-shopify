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
import { decrypt, encrypt, apiKeyPreview } from "../lib/encryption.server";
import { ZernioClient, ZernioApiError } from "../lib/zernio-client";

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

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "update-key") {
    const apiKey = formData.get("apiKey") as string;
    if (!apiKey?.startsWith("sk_")) {
      return { error: "API key must start with sk_" };
    }

    try {
      const client = new ZernioClient(apiKey);
      await client.getUser();
    } catch (err) {
      if (err instanceof ZernioApiError && err.status === 401) {
        return { error: "Invalid API key" };
      }
      return { error: "Could not verify key. Try again." };
    }

    await db.shopConfig.update({
      where: { shop: session.shop },
      data: {
        zernioApiKeyEncrypted: encrypt(apiKey),
        zernioApiKeyPreview: apiKeyPreview(apiKey),
      },
    });

    return { success: "API key updated" };
  }

  if (intent === "update-settings") {
    const profileId = formData.get("profileId") as string;
    const timezone = formData.get("timezone") as string;

    await db.shopConfig.update({
      where: { shop: session.shop },
      data: {
        defaultProfileId: profileId || null,
        defaultTimezone: timezone || "UTC",
        autoPostNewProducts: formData.get("autoPostNewProducts") === "on",
        autoPostBackInStock: formData.get("autoPostBackInStock") === "on",
        autoPostPriceDrop: formData.get("autoPostPriceDrop") === "on",
      },
    });

    return { success: "Settings saved" };
  }

  return null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Settings() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show(fetcher.data.success);
    }
  }, [fetcher.data, shopify]);

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

  return (
    <s-page heading="Settings">
      {/* API Key Section */}
      <s-section heading="Zernio API key">
        <s-paragraph>
          Current key: <s-text fontWeight="bold">{loaderData.keyPreview}</s-text>
        </s-paragraph>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="update-key" />
          <s-text-field
            name="apiKey"
            label="New API key"
            type="password"
            placeholder="sk_..."
            autoComplete="off"
            error={fetcher.data?.error || undefined}
          />
          <s-button type="submit" {...(fetcher.state !== "idle" ? { loading: true } : {})}>
            Update key
          </s-button>
        </fetcher.Form>
      </s-section>

      {/* Preferences Section */}
      <s-section heading="Preferences">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="update-settings" />

          {loaderData.profiles && loaderData.profiles.length > 0 && (
            <s-select
              name="profileId"
              label="Default Zernio profile"
              value={loaderData.defaultProfileId || ""}
            >
              <option value="">None</option>
              {loaderData.profiles.map(
                (p: { _id: string; name: string }) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ),
              )}
            </s-select>
          )}

          <s-text-field
            name="timezone"
            label="Default timezone"
            defaultValue={loaderData.defaultTimezone}
            details="IANA timezone, e.g. America/New_York"
          />

          <s-heading>Auto-post triggers (coming soon)</s-heading>
          <s-paragraph>
            These toggles are ready for Phase 2. When enabled, the app will
            automatically create social posts when products change.
          </s-paragraph>
          <s-checkbox
            name="autoPostNewProducts"
            label="Auto-post new products"
            defaultChecked={loaderData.autoPostNewProducts}
          />
          <s-checkbox
            name="autoPostBackInStock"
            label="Auto-post when products are back in stock"
            defaultChecked={loaderData.autoPostBackInStock}
          />
          <s-checkbox
            name="autoPostPriceDrop"
            label="Auto-post on price drops"
            defaultChecked={loaderData.autoPostPriceDrop}
          />

          <s-button type="submit" variant="primary" {...(fetcher.state !== "idle" ? { loading: true } : {})}>
            Save settings
          </s-button>
        </fetcher.Form>
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
