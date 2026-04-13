import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * List of post templates for the current shop.
 *
 * Templates drive auto-publish (the trigger handlers look for an active
 * template matching the trigger type) and can be applied manually from
 * the compose page. Manual templates are user-curated starting points.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const config = await db.shopConfig.findUnique({
    where: { shop: session.shop },
  });
  if (!config) return { configured: false, templates: [] };

  const templates = await db.postTemplate.findMany({
    where: { shopConfigId: config.id },
    orderBy: { updatedAt: "desc" },
  });

  return { configured: true, templates };
};

const TRIGGER_LABELS: Record<string, { label: string; tone?: string }> = {
  manual: { label: "Manual" },
  new_product: { label: "New product" },
  price_drop: { label: "Price drop" },
  back_in_stock: { label: "Back in stock" },
};

export default function TemplatesIndex() {
  const { configured, templates } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!configured) {
    return (
      <s-page heading="Templates">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-banner tone="warning">Please complete setup first.</s-banner>
            <s-button href="/app">Go to setup</s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Templates">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/templates/new")}
      >
        New template
      </s-button>

      {templates.length === 0 ? (
        <s-section>
          <s-empty-state heading="No templates yet">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Templates let you reuse a caption format across posts, and
                power the auto-publish triggers in Settings. Use mustache
                variables like {`{{title}}`}, {`{{price}}`}, {`{{url}}`},
                and {`{{description}}`} — they get filled in automatically.
              </s-paragraph>
              <s-button
                variant="primary"
                onClick={() => navigate("/app/templates/new")}
              >
                Create your first template
              </s-button>
            </s-stack>
          </s-empty-state>
        </s-section>
      ) : (
        <s-section heading={`${templates.length} template${templates.length === 1 ? "" : "s"}`}>
          <s-stack direction="block" gap="base">
            {templates.map((t: {
              id: string;
              name: string;
              triggerType: string;
              contentTemplate: string;
              isActive: boolean;
              platforms: string[];
            }) => (
              <s-clickable
                key={t.id}
                onClick={() => navigate(`/app/templates/${t.id}`)}
              >
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack direction="block" gap="small-100">
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-text fontWeight="bold">{t.name}</s-text>
                      <s-badge tone={t.isActive ? "success" : undefined}>
                        {t.isActive ? "Active" : "Off"}
                      </s-badge>
                      <s-badge>
                        {TRIGGER_LABELS[t.triggerType]?.label ?? t.triggerType}
                      </s-badge>
                      {t.platforms.length > 0 && (
                        <s-text color="subdued">
                          {t.platforms.length} platform{t.platforms.length === 1 ? "" : "s"}
                        </s-text>
                      )}
                    </s-stack>
                    <s-text color="subdued">
                      {truncate(t.contentTemplate, 140)}
                    </s-text>
                  </s-stack>
                </s-box>
              </s-clickable>
            ))}
          </s-stack>
        </s-section>
      )}

      <s-section slot="aside" heading="How templates work">
        <s-stack direction="block" gap="small-200">
          <s-paragraph>
            <s-text fontWeight="bold">Auto-publish triggers</s-text> use the
            first active template matching their trigger type
            (new_product, price_drop, back_in_stock).
          </s-paragraph>
          <s-paragraph>
            <s-text fontWeight="bold">Manual templates</s-text> appear as
            quick starts in the compose page so you can begin from a
            consistent format instead of a blank textarea.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
