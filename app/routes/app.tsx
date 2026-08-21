import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

// Action handler for /app POST requests. React Router sends POSTs to the
// layout route, not the index route, so this action must live here. The only
// intent is "subscribe" — API keys go to /api/verify-key.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "subscribe") {
    const db = (await import("../db.server")).default;
    const { resolveIsTest, USAGE_PLAN } = await import("../lib/billing.server");
    const shopConfig = await db.shopConfig.findUnique({
      where: { shop },
      select: { shop: true, isTestShop: true },
    });
    const isTest = await resolveIsTest({ admin, shopConfig });
    // Throws a redirect to Shopify's subscription approval page; no code
    // runs after it.
    await billing.request({
      plan: USAGE_PLAN,
      isTest,
      returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing/confirm`,
    });
  }

  return { error: "Unknown intent" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/products">Products</s-link>
        <s-link href="/app/posts">Posts</s-link>
        <s-link href="/app/accounts">Accounts</s-link>
        <s-link href="/app/templates">Templates</s-link>
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
