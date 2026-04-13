import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

// Action handler for /app POST requests (e.g. onboarding form).
// React Router sends POSTs to the layout route, not the index route,
// so this action must live here.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const { ZernioClient } = await import("../lib/zernio-client");
  const { encrypt, apiKeyPreview } = await import("../lib/encryption.server");
  const db = (await import("../db.server")).default;

  const formData = await request.formData();
  const apiKey = formData.get("apiKey") as string;

  if (!apiKey?.startsWith("sk_")) {
    return { error: "API key must start with sk_" };
  }

  try {
    const client = new ZernioClient(apiKey);
    const user = await client.getUser();
    const profiles = await client.getProfiles();

    await db.shopConfig.upsert({
      where: { shop },
      create: {
        shop,
        zernioApiKeyEncrypted: encrypt(apiKey),
        zernioApiKeyPreview: apiKeyPreview(apiKey),
        defaultProfileId: profiles[0]?._id || null,
        onboardingComplete: true,
      },
      update: {
        zernioApiKeyEncrypted: encrypt(apiKey),
        zernioApiKeyPreview: apiKeyPreview(apiKey),
        defaultProfileId: profiles[0]?._id || null,
        onboardingComplete: true,
      },
    });

    return { success: true, plan: user.planName };
  } catch {
    return { error: "Could not connect to Zernio. Check your API key." };
  }
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/products">Products</s-link>
        <s-link href="/app/posts">Posts</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
