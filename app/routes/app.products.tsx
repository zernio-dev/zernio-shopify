import { useState } from "react";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { PRODUCTS_QUERY } from "../lib/shopify-products.server";

// ---------------------------------------------------------------------------
// Loader: Fetch products from Shopify GraphQL Admin API
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const search = url.searchParams.get("q") || "";
  const after = url.searchParams.get("after") || undefined;

  // Build query string: only show active products, optionally filtered by search
  const query = search ? `status:active ${search}` : "status:active";

  const response = await admin.graphql(PRODUCTS_QUERY, {
    variables: { first: 25, after, query },
  });

  const { data } = await response.json();

  return {
    products: data.products.nodes,
    pageInfo: data.products.pageInfo,
    search,
  };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Products() {
  const { products, pageInfo, search } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();

  // Track search query in React state for Polaris web component
  const [searchQuery, setSearchQuery] = useState(search);

  const handleSearch = () => {
    const q = searchQuery.trim();
    setSearchParams(q ? { q } : {});
  };

  return (
    <s-page heading="Products">
      <s-section>
        <s-stack direction="inline" gap="base">
          <s-text-field
            label="Search products"
            labelHidden
            name="q"
            value={searchQuery}
            placeholder="Search by title, type, vendor..."
            onChange={(e: any) => setSearchQuery(e.currentTarget.value)}
            onKeyDown={(e: any) => { if (e.key === "Enter") handleSearch(); }}
          ></s-text-field>
          <s-button variant="primary" onClick={handleSearch}>Search</s-button>
        </s-stack>
      </s-section>

      <s-section>
        {products.length === 0 ? (
          <s-paragraph>
            No products found.{" "}
            {search && "Try a different search term."}
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {products.map(
              (product: {
                id: string;
                title: string;
                handle: string;
                status: string;
                featuredImage: { url: string; altText: string | null } | null;
                priceRangeV2: {
                  minVariantPrice: { amount: string; currencyCode: string };
                };
              }) => (
                <s-box
                  key={product.id}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                >
                  <s-stack direction="inline" gap="base">
                    {product.featuredImage && (
                      <s-thumbnail
                        source={product.featuredImage.url}
                        alt={product.featuredImage.altText || product.title}
                      />
                    )}
                    <s-stack direction="block" gap="small-200">
                      <s-text fontWeight="bold">{product.title}</s-text>
                      <s-text>
                        {product.priceRangeV2.minVariantPrice.currencyCode}{" "}
                        {product.priceRangeV2.minVariantPrice.amount}
                      </s-text>
                    </s-stack>
                    <s-button
                      size="slim"
                      variant="primary"
                      // In-iframe navigation via React Router. App Bridge keeps
                      // the top-level admin URL in sync; we must NOT touch
                      // window.top.location (that tries to load a non-existent
                      // /apps/zernio/* route on the admin and 404s).
                      onClick={() =>
                        navigate(`/app/compose?productId=${encodeURIComponent(product.id)}`)
                      }
                    >
                      Share to social
                    </s-button>
                  </s-stack>
                </s-box>
              ),
            )}
          </s-stack>
        )}
      </s-section>

      {pageInfo.hasNextPage && (
        <s-section>
          <s-button
            onClick={() =>
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set("after", pageInfo.endCursor);
                return next;
              })
            }
          >
            Load more
          </s-button>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
