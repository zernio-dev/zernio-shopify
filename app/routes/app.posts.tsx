import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";

// ---------------------------------------------------------------------------
// Loader: Fetch post logs from local DB
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const config = await db.shopConfig.findUnique({
    where: { shop: session.shop },
  });

  if (!config) {
    return { posts: [] };
  }

  const posts = await db.postLog.findMany({
    where: { shopConfigId: config.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return { posts };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Map post status to a Polaris badge tone. */
function statusTone(status: string) {
  switch (status) {
    case "published":
      return "success";
    case "failed":
      return "critical";
    case "partial":
      return "warning";
    case "scheduled":
      return "info";
    default:
      return undefined;
  }
}

export default function Posts() {
  const { posts } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Scheduled posts">
      <s-button slot="primary-action" href="/app/products">
        New post
      </s-button>

      <s-section>
        {posts.length === 0 ? (
          <s-paragraph>
            No posts yet. Go to{" "}
            <s-link href="/app/products">Products</s-link> to schedule your
            first post.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header>
              <s-table-header-cell>Product</s-table-header-cell>
              <s-table-header-cell>Platforms</s-table-header-cell>
              <s-table-header-cell>Status</s-table-header-cell>
              <s-table-header-cell>Trigger</s-table-header-cell>
              <s-table-header-cell>Scheduled</s-table-header-cell>
              <s-table-header-cell>Created</s-table-header-cell>
            </s-table-header>
            <s-table-body>
              {posts.map(
                (post: {
                  id: string;
                  shopifyProductTitle: string | null;
                  platforms: string[];
                  status: string;
                  triggerType: string;
                  scheduledFor: string | null;
                  createdAt: string;
                  errorMessage: string | null;
                }) => (
                  <s-table-row key={post.id}>
                    <s-table-cell>
                      {post.shopifyProductTitle || "Unknown"}
                    </s-table-cell>
                    <s-table-cell>{post.platforms.join(", ")}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={statusTone(post.status)}>
                        {post.status}
                      </s-badge>
                      {post.errorMessage && (
                        <s-tooltip content={post.errorMessage}>
                          <s-icon source="alert" />
                        </s-tooltip>
                      )}
                    </s-table-cell>
                    <s-table-cell>{post.triggerType}</s-table-cell>
                    <s-table-cell>
                      {post.scheduledFor
                        ? new Date(post.scheduledFor).toLocaleString()
                        : "Immediate"}
                    </s-table-cell>
                    <s-table-cell>
                      {new Date(post.createdAt).toLocaleDateString()}
                    </s-table-cell>
                  </s-table-row>
                ),
              )}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
