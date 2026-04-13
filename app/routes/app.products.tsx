import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { PRODUCTS_QUERY } from "../lib/shopify-products.server";

/**
 * Browse products with multi-select for bulk scheduling and per-product
 * post counts pulled from PostLog.
 *
 * URL params:
 *   q        — search query (Shopify product query syntax)
 *   after    — pagination cursor for next page
 *   before   — cursor for previous page (TODO)
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const search = url.searchParams.get("q") || "";
  const after = url.searchParams.get("after") || undefined;

  // Only show active products by default — drafts pollute the grid
  const query = search ? `status:active ${search}` : "status:active";

  const response = await admin.graphql(PRODUCTS_QUERY, {
    variables: { first: 24, after, query },
  });
  const { data } = await response.json();
  const products = data.products.nodes as Array<{
    id: string;
    title: string;
    handle: string;
    status: string;
    featuredImage: { url: string; altText: string | null } | null;
    priceRangeV2: {
      minVariantPrice: { amount: string; currencyCode: string };
    };
  }>;

  // Per-product post counts (only for the products on this page)
  const config = await db.shopConfig.findUnique({
    where: { shop: session.shop },
  });

  let postCounts: Record<string, number> = {};
  if (config && products.length > 0) {
    const counts = await db.postLog.groupBy({
      by: ["shopifyProductId"],
      where: {
        shopConfigId: config.id,
        shopifyProductId: { in: products.map((p) => p.id) },
      },
      _count: { _all: true },
    });
    postCounts = Object.fromEntries(
      counts.map((c) => [c.shopifyProductId, c._count._all]),
    );
  }

  return {
    products,
    pageInfo: data.products.pageInfo,
    search,
    postCounts,
  };
};

export default function Products() {
  const { products, pageInfo, search, postCounts } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchQuery, setSearchQuery] = useState(search);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const handleSearch = () => {
    const q = searchQuery.trim();
    setSearchParams(q ? { q } : {});
    setSelected(new Set()); // clear selection when search changes
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(products.map((p: { id: string }) => p.id)));
  };

  const clearSelection = () => setSelected(new Set());

  const goCompose = (productId: string) => {
    navigate(`/app/compose?productId=${encodeURIComponent(productId)}`);
  };

  const goBulk = () => {
    if (selected.size === 0) return;
    navigate(`/app/bulk-schedule?ids=${Array.from(selected).map(encodeURIComponent).join(",")}`);
  };

  const allSelected = products.length > 0 && selected.size === products.length;

  return (
    <s-page heading="Products">
      {/* Search */}
      <s-section>
        <s-stack direction="inline" gap="base" alignItems="end">
          <s-text-field
            label="Search products"
            labelAccessibilityVisibility="exclusive"
            value={searchQuery}
            placeholder="Search by title, type, vendor, tag…"
            onChange={(e: any) => setSearchQuery(e.currentTarget.value)}
            onKeyDown={(e: any) => {
              if (e.key === "Enter") handleSearch();
            }}
          ></s-text-field>
          <s-button variant="primary" onClick={handleSearch}>
            Search
          </s-button>
          {search && (
            <s-button
              onClick={() => {
                setSearchQuery("");
                setSearchParams({});
              }}
            >
              Clear
            </s-button>
          )}
        </s-stack>
      </s-section>

      {/* Bulk-action bar — appears when any product is selected */}
      {selected.size > 0 && (
        <s-section>
          <s-banner tone="info">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-text fontWeight="bold">
                {selected.size} product{selected.size === 1 ? "" : "s"} selected
              </s-text>
              <s-button variant="primary" onClick={goBulk}>
                Bulk schedule →
              </s-button>
              <s-button onClick={clearSelection}>Clear</s-button>
            </s-stack>
          </s-banner>
        </s-section>
      )}

      {/* Product grid */}
      <s-section
        heading={products.length === 0 ? undefined : `${products.length} on this page`}
      >
        {products.length > 0 && (
          <s-stack direction="inline" gap="small-100" alignItems="center">
            <s-checkbox
              label={allSelected ? "Deselect all" : "Select all on this page"}
              checked={allSelected || undefined}
              onChange={() => (allSelected ? clearSelection() : selectAll())}
            ></s-checkbox>
          </s-stack>
        )}

        {products.length === 0 ? (
          <s-empty-state heading="No products found">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                {search
                  ? "No products match your search. Try a different term or clear the filter."
                  : "Add a product in your Shopify admin to get started."}
              </s-paragraph>
              {search && (
                <s-button
                  onClick={() => {
                    setSearchQuery("");
                    setSearchParams({});
                  }}
                >
                  Clear search
                </s-button>
              )}
            </s-stack>
          </s-empty-state>
        ) : (
          <s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="base">
            {products.map((product: {
              id: string;
              title: string;
              handle: string;
              status: string;
              featuredImage: { url: string; altText: string | null } | null;
              priceRangeV2: {
                minVariantPrice: { amount: string; currencyCode: string };
              };
            }) => {
              const isSelected = selected.has(product.id);
              const count = postCounts[product.id] ?? 0;
              return (
                <s-box
                  key={product.id}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background={isSelected ? "subdued" : undefined}
                >
                  <s-stack direction="block" gap="small-200">
                    <s-stack direction="inline" gap="small-100" alignItems="center">
                      <s-checkbox
                        label=""
                        labelAccessibilityVisibility="exclusive"
                        checked={isSelected || undefined}
                        onChange={() => toggle(product.id)}
                      ></s-checkbox>
                      {count > 0 && (
                        <s-badge tone="success">
                          {count} post{count === 1 ? "" : "s"}
                        </s-badge>
                      )}
                    </s-stack>

                    {product.featuredImage ? (
                      <s-image
                        source={product.featuredImage.url}
                        alt={product.featuredImage.altText || product.title}
                        aspectRatio="1/1"
                        objectFit="cover"
                        borderRadius="base"
                      />
                    ) : (
                      <s-box
                        padding="large-200"
                        borderRadius="base"
                        background="subdued"
                      >
                        <s-text color="subdued" textAlign="center">
                          No image
                        </s-text>
                      </s-box>
                    )}

                    <s-stack direction="block" gap="small-100">
                      <s-text fontWeight="bold">{product.title}</s-text>
                      <s-text color="subdued">
                        {product.priceRangeV2.minVariantPrice.currencyCode}{" "}
                        {product.priceRangeV2.minVariantPrice.amount}
                      </s-text>
                    </s-stack>

                    <s-button
                      variant="primary"
                      onClick={() => goCompose(product.id)}
                    >
                      Share to social
                    </s-button>
                  </s-stack>
                </s-box>
              );
            })}
          </s-grid>
        )}
      </s-section>

      {/* Pagination */}
      {pageInfo.hasNextPage && (
        <s-section>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button
              onClick={() =>
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.set("after", pageInfo.endCursor);
                  return next;
                })
              }
            >
              Next page →
            </s-button>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
