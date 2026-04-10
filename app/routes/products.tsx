// Redirect /products to /app/products for Shopify sidebar navigation
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  throw redirect(`/app/products${url.search}`);
};
