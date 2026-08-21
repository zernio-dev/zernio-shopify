import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRouteError, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { decrypt } from "../lib/encryption.server";
import { ZernioClient } from "../lib/zernio-client";

/**
 * Social accounts: list what's connected on the Zernio side and connect new
 * platforms via the headless connect flow. OAuth cannot run inside the admin
 * iframe, so Connect opens the platform's auth page in a new tab and bounces
 * back here with ?connected=1.
 */

const CONNECTABLE_PLATFORMS = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "tiktok", label: "TikTok" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "twitter", label: "X (Twitter)" },
  { id: "youtube", label: "YouTube" },
  { id: "threads", label: "Threads" },
  { id: "pinterest", label: "Pinterest" },
  { id: "bluesky", label: "Bluesky" },
  { id: "reddit", label: "Reddit" },
  { id: "telegram", label: "Telegram" },
  { id: "googlebusiness", label: "Google Business" },
  { id: "snapchat", label: "Snapchat" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await db.shopConfig.findUnique({ where: { shop: session.shop } });

  if (!config?.onboardingComplete) {
    return {
      onboarded: false,
      accounts: [],
      keySource: "byo",
      approachingCappedAmount: false,
      capBlocked: false,
      cappedAmountUsd: null as number | null,
    };
  }

  const client = new ZernioClient(decrypt(config.zernioApiKeyEncrypted));
  let accounts: Array<{ _id: string; platform: string; username: string; isActive: boolean }> = [];
  try {
    accounts = (await client.getAccounts()).map((a) => ({
      _id: a._id,
      platform: a.platform,
      username: a.username,
      isActive: a.isActive,
    }));
  } catch {
    // Key suspended or API unreachable — show the empty state rather than 500.
  }

  return {
    onboarded: true,
    accounts,
    keySource: config.keySource,
    approachingCappedAmount: config.approachingCappedAmount,
    capBlocked: config.capBlocked,
    cappedAmountUsd: config.cappedAmountUsd,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const config = await db.shopConfig.findUnique({ where: { shop } });
  if (!config?.onboardingComplete) {
    return Response.json({ error: "Connect Zernio first" }, { status: 400 });
  }

  if (intent === "connect") {
    const platform = (formData.get("platform") as string) || "";
    if (!CONNECTABLE_PLATFORMS.some((p) => p.id === platform)) {
      return Response.json({ error: "Unknown platform" }, { status: 400 });
    }
    if (config.keySource === "shopify" && config.capBlocked) {
      return Response.json({
        error: "You reached your approved Shopify spending limit. Raise it to connect more accounts.",
      });
    }
    if (!config.defaultProfileId) {
      return Response.json({ error: "No Zernio profile on this connection. Re-run onboarding from Settings." });
    }
    const client = new ZernioClient(decrypt(config.zernioApiKeyEncrypted));
    const appUrl = process.env.SHOPIFY_APP_URL || "https://store.zernio.com";
    try {
      const url = await client.getConnectUrl({
        platform,
        profileId: config.defaultProfileId,
        redirectUrl: `${appUrl}/app/accounts?connected=1`,
      });
      return Response.json({ url });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not start the connect flow";
      return Response.json({ error: message });
    }
  }

  if (intent === "raise-cap") {
    if (!config.subscriptionLineItemId || !config.cappedAmountUsd) {
      return Response.json({ error: "No active Shopify subscription" }, { status: 400 });
    }
    // Throws a redirect to Shopify's confirmation page; the
    // subscriptions-update webhook clears the cap flags after approval.
    await billing.updateUsageCappedAmount({
      subscriptionLineItemId: config.subscriptionLineItemId,
      cappedAmount: { amount: config.cappedAmountUsd * 2, currencyCode: "USD" },
    });
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
};

export default function AccountsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ url?: string; error?: string }>();
  const shopify = useAppBridge();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (fetcher.data?.url) {
      window.open(fetcher.data.url, "_blank", "noopener");
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (searchParams.get("connected") === "1") {
      shopify.toast.show("Account connected!");
    }
  }, [searchParams, shopify]);

  const isWorking = fetcher.state !== "idle";
  const showCapBanner =
    data.keySource === "shopify" && (data.approachingCappedAmount || data.capBlocked);
  const connectDisabled = isWorking || (data.keySource === "shopify" && data.capBlocked);

  return (
    <s-page heading="Social accounts">
      {showCapBanner && (
        <s-banner tone={data.capBlocked ? "critical" : "warning"}>
          {data.capBlocked
            ? `You reached your approved Shopify spending limit${data.cappedAmountUsd ? ` ($${data.cappedAmountUsd} per 30 days)` : ""}. Raise it to keep connecting accounts.`
            : `You are near your approved Shopify spending limit${data.cappedAmountUsd ? ` ($${data.cappedAmountUsd} per 30 days)` : ""}. Raise it to keep connecting accounts.`}{" "}
          <s-button
            variant="primary"
            disabled={isWorking || undefined}
            onClick={() => fetcher.submit({ intent: "raise-cap" }, { method: "POST" })}
          >
            Raise limit
          </s-button>
        </s-banner>
      )}

      <s-section heading="Connected">
        {data.accounts.length === 0 ? (
          <s-paragraph>
            No social accounts connected yet. Connect your first one below and
            it will be ready in the Compose page.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {data.accounts.map((account) => (
              <s-stack key={account._id} direction="inline" gap="base">
                <s-text>{account.platform}</s-text>
                <s-text>@{account.username}</s-text>
                <s-badge tone={account.isActive ? "success" : "critical"}>
                  {account.isActive ? "Active" : "Disconnected"}
                </s-badge>
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section heading="Connect a platform">
        <s-paragraph>
          Connecting opens the platform's sign-in page in a new browser tab
          and brings you back here when it finishes.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          {CONNECTABLE_PLATFORMS.map((platform) => (
            <s-button
              key={platform.id}
              disabled={connectDisabled || undefined}
              onClick={() =>
                fetcher.submit(
                  { intent: "connect", platform: platform.id },
                  { method: "POST" },
                )
              }
            >
              {platform.label}
            </s-button>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
