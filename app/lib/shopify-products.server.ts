/**
 * GraphQL queries for fetching Shopify product data.
 *
 * Uses the Shopify Admin GraphQL API through the authenticated admin client
 * provided by @shopify/shopify-app-react-router.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  descriptionHtml: string;
  onlineStoreUrl: string | null;
  tags: string[];
  featuredImage: {
    url: string;
    altText: string | null;
  } | null;
  priceRangeV2: {
    minVariantPrice: { amount: string; currencyCode: string };
    maxVariantPrice: { amount: string; currencyCode: string };
  };
}

export interface ShopifyProductDetail extends ShopifyProduct {
  description: string;
  vendor: string;
  productType: string;
  images: {
    nodes: Array<{
      id: string;
      url: string;
      altText: string | null;
      width: number;
      height: number;
    }>;
  };
  variants: {
    nodes: Array<{
      id: string;
      title: string;
      price: string;
      sku: string | null;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** List products with search and pagination. */
export const PRODUCTS_QUERY = `#graphql
  query GetProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        status
        descriptionHtml
        onlineStoreUrl
        tags
        featuredImage {
          url
          altText
        }
        priceRangeV2 {
          minVariantPrice {
            amount
            currencyCode
          }
          maxVariantPrice {
            amount
            currencyCode
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/** Fetch a single product with full detail (images, variants, description). */
export const PRODUCT_DETAIL_QUERY = `#graphql
  query GetProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      description
      descriptionHtml
      onlineStoreUrl
      tags
      vendor
      productType
      featuredImage {
        url
        altText
      }
      priceRangeV2 {
        minVariantPrice {
          amount
          currencyCode
        }
        maxVariantPrice {
          amount
          currencyCode
        }
      }
      images(first: 10) {
        nodes {
          id
          url
          altText
          width
          height
        }
      }
      variants(first: 10) {
        nodes {
          id
          title
          price
          sku
        }
      }
    }
  }
`;
