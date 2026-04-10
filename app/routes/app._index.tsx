import { useEffect, useState } from "react";
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
import { ZernioClient, ZernioApiError } from "../lib/zernio-client";
import { encrypt, apiKeyPreview } from "../lib/encryption.server";

// ---------------------------------------------------------------------------
// Loader: Check if onboarding is complete
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const config = await db.shopConfig.findUnique({ where: { shop } });

  if (!config?.onboardingComplete) {
    return {
      onboarded: false,
      profiles: [] as Array<{ _id: string; name: string }>,
      recentPosts: [],
      accountCount: 0,
    };
  }

  // Fetch recent posts for the dashboard
  const recentPosts = await db.postLog.findMany({
    where: { shopConfigId: config.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  return {
    onboarded: true,
    profiles: [],
    recentPosts,
    accountCount: 0,
  };
};

// ---------------------------------------------------------------------------
// Action: Handle onboarding form submission
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // Step 1: Verify the API key
  if (intent === "verify-key") {
    const apiKey = formData.get("apiKey") as string;
    if (!apiKey?.startsWith("sk_")) {
      return { error: "API key must start with sk_", step: "key" };
    }

    try {
      const client = new ZernioClient(apiKey);
      const user = await client.getUser();
      const profiles = await client.getProfiles();

      // Store the encrypted key
      await db.shopConfig.upsert({
        where: { shop },
        create: {
          shop,
          zernioApiKeyEncrypted: encrypt(apiKey),
          zernioApiKeyPreview: apiKeyPreview(apiKey),
        },
        update: {
          zernioApiKeyEncrypted: encrypt(apiKey),
          zernioApiKeyPreview: apiKeyPreview(apiKey),
        },
      });

      return {
        step: "profile",
        user: { name: user.name, plan: user.planName },
        profiles: profiles.map((p) => ({ _id: p._id, name: p.name })),
      };
    } catch (err) {
      if (err instanceof ZernioApiError && err.status === 401) {
        return { error: "Invalid API key. Please check and try again.", step: "key" };
      }
      return { error: "Could not connect to Zernio. Please try again.", step: "key" };
    }
  }

  // Step 2: Select a default profile and complete onboarding
  if (intent === "select-profile") {
    const profileId = formData.get("profileId") as string;
    const timezone = formData.get("timezone") as string;

    await db.shopConfig.update({
      where: { shop },
      data: {
        defaultProfileId: profileId || null,
        defaultTimezone: timezone || "UTC",
        onboardingComplete: true,
      },
    });

    return { step: "done" };
  }

  return null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AppIndex() {
  const { onboarded, recentPosts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const actionData = fetcher.data;
  const isSubmitting = fetcher.state !== "idle";

  // After onboarding completes, show a toast and reload
  useEffect(() => {
    if (actionData?.step === "done") {
      shopify.toast.show("Connected to Zernio!");
      // Small delay so the toast is visible, then reload to show dashboard
      setTimeout(() => window.location.reload(), 500);
    }
  }, [actionData, shopify]);

  // ---- Onboarding ---------------------------------------------------------

  if (!onboarded && actionData?.step !== "done") {
    // Show profile selection step
    if (actionData?.step === "profile" && actionData.profiles) {
      return (
        <s-page heading="Connect to Zernio" subtitle="Step 2: Select a profile">
          <s-section heading={`Welcome, ${actionData.user?.name}!`}>
            <s-paragraph>
              You&apos;re on the <s-text fontWeight="bold">{actionData.user?.plan}</s-text> plan.
              Select a default profile for posting.
            </s-paragraph>
          </s-section>

          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="select-profile" />
            <input type="hidden" name="timezone" value={Intl.DateTimeFormat().resolvedOptions().timeZone} />
            <s-section heading="Default profile">
              <s-select name="profileId" label="Profile">
                {(actionData.profiles as Array<{ _id: string; name: string }>).map(
                  (p) => (
                    <option key={p._id} value={p._id}>
                      {p.name}
                    </option>
                  ),
                )}
              </s-select>
              <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>
                Complete setup
              </s-button>
            </s-section>
          </fetcher.Form>
        </s-page>
      );
    }

    // Default: API key entry step
    return (
      <s-page heading="Connect to Zernio" subtitle="Step 1: Enter your API key">
        <s-section heading="Get started">
          <s-paragraph>
            Connect your Zernio account to start scheduling social media posts
            for your Shopify products. You&apos;ll need a Zernio API key.
          </s-paragraph>
          <s-paragraph>
            Don&apos;t have one?{" "}
            <s-link href="https://zernio.com/dashboard/api-keys" target="_blank">
              Get your API key at zernio.com
            </s-link>
          </s-paragraph>
        </s-section>

        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="verify-key" />
          <s-section heading="API key">
            <s-text-field
              name="apiKey"
              label="Zernio API key"
              type="password"
              placeholder="sk_..."
              autoComplete="off"
              error={actionData?.error || undefined}
            />
            <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>
              Connect
            </s-button>
          </s-section>
        </fetcher.Form>
      </s-page>
    );
  }

  // ---- Dashboard ----------------------------------------------------------

  return (
    <s-page heading="Zernio">
      <s-button slot="primary-action" href="/app/products">
        Share a product
      </s-button>

      <s-section heading="Quick actions">
        <s-stack direction="inline" gap="base">
          <s-button href="/app/products">Browse products</s-button>
          <s-button href="/app/posts">View scheduled posts</s-button>
          <s-button href="/app/settings" variant="tertiary">Settings</s-button>
        </s-stack>
      </s-section>

      <s-section heading="Recent posts">
        {recentPosts.length === 0 ? (
          <s-paragraph>
            No posts yet. Go to{" "}
            <s-link href="/app/products">Products</s-link> to schedule your
            first social media post.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header>
              <s-table-header-cell>Product</s-table-header-cell>
              <s-table-header-cell>Platforms</s-table-header-cell>
              <s-table-header-cell>Status</s-table-header-cell>
              <s-table-header-cell>Scheduled</s-table-header-cell>
            </s-table-header>
            <s-table-body>
              {recentPosts.map((post) => (
                <s-table-row key={post.id}>
                  <s-table-cell>
                    {post.shopifyProductTitle || "Unknown product"}
                  </s-table-cell>
                  <s-table-cell>{post.platforms.join(", ")}</s-table-cell>
                  <s-table-cell>
                    <s-badge
                      tone={
                        post.status === "published"
                          ? "success"
                          : post.status === "failed"
                            ? "critical"
                            : post.status === "scheduled"
                              ? "info"
                              : undefined
                      }
                    >
                      {post.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {post.scheduledFor
                      ? new Date(post.scheduledFor).toLocaleString()
                      : "-"}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="About">
        <s-paragraph>
          Zernio lets you schedule social media posts to 14+ platforms from a
          single API. This app connects your Shopify product catalog to your
          Zernio account.
        </s-paragraph>
        <s-paragraph>
          <s-link href="https://zernio.com" target="_blank">
            zernio.com
          </s-link>{" "}
          |{" "}
          <s-link href="https://docs.zernio.com" target="_blank">
            API docs
          </s-link>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
