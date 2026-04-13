import { useEffect, useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { decrypt } from "../lib/encryption.server";
import { ZernioClient } from "../lib/zernio-client";
import { PRODUCTS_BY_IDS_QUERY } from "../lib/shopify-products.server";

/**
 * Bulk schedule N selected products as Zernio posts in one go.
 *
 * The merchant picks:
 *   - A template (or "use built-in default")
 *   - Target accounts
 *   - Cadence (immediate, or one post every X minutes/hours)
 *   - Start time
 *
 * We then preview the resulting timeline before committing. Submit goes
 * through XHR to /api/bulk-create-posts which loops over the products
 * and creates one Zernio post per product with staggered scheduledFor.
 */

interface BulkProduct {
  id: string;
  title: string;
  handle: string;
  description: string;
  onlineStoreUrl: string | null;
  featuredImage: { url: string; altText: string | null } | null;
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids") || "";
  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);

  if (ids.length === 0) {
    return { error: "No products selected", products: [], accounts: [], templates: [] };
  }

  const config = await db.shopConfig.findUnique({
    where: { shop: session.shop },
  });
  if (!config?.onboardingComplete) {
    return {
      error: "Please complete setup first",
      products: [],
      accounts: [],
      templates: [],
    };
  }

  // Fetch all selected products in one round-trip
  const resp = await admin.graphql(PRODUCTS_BY_IDS_QUERY, {
    variables: { ids },
  });
  const json = (await resp.json()) as {
    data?: { nodes: Array<BulkProduct | null> };
  };
  const products = (json.data?.nodes ?? []).filter(
    (p): p is BulkProduct => !!p,
  );

  // Templates and accounts so we can populate the pickers
  const templates = await db.postTemplate.findMany({
    where: { shopConfigId: config.id, isActive: true },
    orderBy: { updatedAt: "desc" },
  });

  let accounts: Array<{
    _id: string;
    platform: string;
    username: string;
    isActive: boolean;
  }> = [];
  try {
    const apiKey = decrypt(config.zernioApiKeyEncrypted);
    const client = new ZernioClient(apiKey);
    const fetched = await client.getAccounts(config.defaultProfileId || undefined);
    accounts = fetched.map((a) => ({
      _id: a._id,
      platform: a.platform,
      username: a.username,
      isActive: a.isActive,
    }));
  } catch {
    // non-fatal
  }

  return {
    products,
    accounts,
    templates,
    defaultTimezone: config.defaultTimezone,
    shop: session.shop,
  };
};

const CADENCE_OPTIONS = [
  { value: "now", label: "Publish all now" },
  { value: "15", label: "1 every 15 minutes" },
  { value: "30", label: "1 every 30 minutes" },
  { value: "60", label: "1 every hour" },
  { value: "240", label: "1 every 4 hours" },
  { value: "720", label: "2 per day (every 12h)" },
  { value: "1440", label: "1 per day" },
];

export default function BulkSchedule() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  // ── State ───────────────────────────────────────────────────────────
  const [templateId, setTemplateId] = useState<string>("");
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [cadence, setCadence] = useState<string>("60");
  // Initialize empty so SSR and first client render match — set to "now"
  // after hydration via useEffect (Date.now() differs server vs client).
  const [startAt, setStartAt] = useState<string>("");
  useEffect(() => {
    if (!startAt) setStartAt(isoLocalNow());
    // run once on mount; intentionally no startAt dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [submitState, setSubmitState] = useState<
    "idle" | "sending" | "done" | "error"
  >("idle");
  const [submitError, setSubmitError] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });

  // Compute the preview timeline so the merchant sees what will happen.
  // If startAt isn't set yet (initial render before hydration), fall back
  // to "Immediately" so we don't generate non-deterministic dates server-side.
  const timeline = useMemo(() => {
    if (!data.products.length) return [];
    const intervalMin = cadence === "now" ? 0 : parseInt(cadence, 10);
    const start = startAt ? new Date(startAt) : null;
    return data.products.map((p, i) => ({
      product: p,
      when: cadence === "now" || !start
        ? null
        : new Date(start.getTime() + i * intervalMin * 60_000),
    }));
  }, [data.products, cadence, startAt]);

  // ── Early returns ──────────────────────────────────────────────────
  if (data.error) {
    return (
      <s-page heading="Bulk schedule">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-banner tone="critical">{data.error}</s-banner>
            <s-button onClick={() => navigate("/app/products")}>
              Back to products
            </s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  if (submitState === "done") {
    return (
      <s-page heading="Done">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-banner tone="success">
              Created {progress.done} of {progress.total} posts. Track
              them in the Posts page.
            </s-banner>
            <s-stack direction="inline" gap="base">
              <s-button variant="primary" onClick={() => navigate("/app/posts")}>
                View posts
              </s-button>
              <s-button onClick={() => navigate("/app/products")}>
                Back to products
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────
  const toggleAccount = (key: string) => {
    setSelectedAccounts((prev) =>
      prev.includes(key) ? prev.filter((v) => v !== key) : [...prev, key],
    );
  };

  const handleSubmit = () => {
    if (selectedAccounts.length === 0 && !templateId) {
      setSubmitError("Pick a template or at least one account");
      setSubmitState("error");
      return;
    }
    if (cadence !== "now" && !startAt) {
      setSubmitError("Pick a start time");
      setSubmitState("error");
      return;
    }

    setSubmitState("sending");
    setSubmitError("");
    setProgress({ done: 0, total: data.products.length });

    const body = new URLSearchParams();
    body.append("productIds", data.products.map((p) => p.id).join(","));
    if (templateId) body.append("templateId", templateId);
    if (selectedAccounts.length > 0) {
      body.append("accounts", selectedAccounts.join(","));
    }
    body.append("cadenceMinutes", cadence === "now" ? "0" : cadence);
    body.append(
      "startAt",
      cadence === "now" ? new Date().toISOString() : new Date(startAt).toISOString(),
    );

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/bulk-create-posts", true);
    xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        if (result.success) {
          setProgress({ done: result.created, total: result.total });
          setSubmitState("done");
          shopify.toast.show(
            `Bulk schedule created ${result.created} post(s)`,
          );
        } else {
          setSubmitState("error");
          setSubmitError(result.error || "Bulk create failed");
        }
      } catch {
        setSubmitState("error");
        setSubmitError("Bad response from server");
      }
    };
    xhr.onerror = () => {
      setSubmitState("error");
      setSubmitError("Network error. Try again.");
    };
    xhr.send(body.toString());
  };

  // ── Render ──────────────────────────────────────────────────────────
  const grouped: Record<string, typeof data.accounts> = {};
  for (const a of data.accounts) (grouped[a.platform] ||= []).push(a);

  return (
    <s-page heading="Bulk schedule" subtitle={`${data.products.length} product${data.products.length === 1 ? "" : "s"} selected`}>
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={submitState === "sending" || undefined}
        onClick={handleSubmit}
      >
        {submitState === "sending"
          ? `Creating ${progress.done}/${progress.total}...`
          : `Create ${data.products.length} post${data.products.length === 1 ? "" : "s"}`}
      </s-button>
      <s-button slot="secondary-actions" onClick={() => navigate("/app/products")}>
        Cancel
      </s-button>

      {submitError && <s-banner tone="critical">{submitError}</s-banner>}

      {/* Template */}
      {data.templates.length > 0 && (
        <s-section heading="Template">
          <s-select
            label="Caption template"
            details="Used for every post. Defaults to 'title + description + url' when blank."
            value={templateId}
            onChange={(e: any) => setTemplateId(e.currentTarget.value)}
          >
            <s-option value="">Built-in default (title + description + url)</s-option>
            {data.templates.map((t: { id: string; name: string; triggerType: string }) => (
              <s-option key={t.id} value={t.id}>
                {t.name} ({t.triggerType})
              </s-option>
            ))}
          </s-select>
        </s-section>
      )}

      {/* Accounts */}
      <s-section heading="Post to">
        {data.accounts.length === 0 ? (
          <s-banner tone="warning">
            No social accounts found. Connect them at zernio.com.
          </s-banner>
        ) : (
          <s-stack direction="block" gap="small-200">
            <s-paragraph>
              Pick one or more accounts. If you also chose a template,
              the template's accounts will be used unless you select some here.
            </s-paragraph>
            {Object.entries(grouped).map(([platform, accs]) => (
              <s-box
                key={platform}
                padding="small-200"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small-100">
                  <s-text fontWeight="bold">{platform}</s-text>
                  {accs.map((a) => (
                    <s-checkbox
                      key={a._id}
                      label={`@${a.username}`}
                      checked={selectedAccounts.includes(`${platform}:${a._id}`) || undefined}
                      disabled={!a.isActive || undefined}
                      onChange={() => toggleAccount(`${platform}:${a._id}`)}
                    ></s-checkbox>
                  ))}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      {/* Cadence */}
      <s-section heading="Cadence">
        <s-select
          label="Posting frequency"
          value={cadence}
          onChange={(e: any) => setCadence(e.currentTarget.value)}
        >
          {CADENCE_OPTIONS.map((c) => (
            <s-option key={c.value} value={c.value}>
              {c.label}
            </s-option>
          ))}
        </s-select>

        {cadence !== "now" && (
          <s-text-field
            label="Start at"
            type="datetime-local"
            value={startAt}
            onChange={(e: any) => setStartAt(e.currentTarget.value)}
            details={`Times use ${data.defaultTimezone || "UTC"}.`}
          ></s-text-field>
        )}
      </s-section>

      {/* Preview */}
      <s-section heading="Preview">
        <s-paragraph>
          Below is the order in which posts will be created.
        </s-paragraph>
        <s-stack direction="block" gap="small-100">
          {timeline.map((item, i) => (
            <s-box
              key={item.product.id}
              padding="small-200"
              borderWidth="base"
              borderRadius="base"
            >
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text color="subdued">{String(i + 1).padStart(2, "0")}.</s-text>
                {item.product.featuredImage && (
                  <s-thumbnail
                    source={item.product.featuredImage.url}
                    alt={item.product.featuredImage.altText || item.product.title}
                    size="small"
                  />
                )}
                <s-text fontWeight="bold">{item.product.title}</s-text>
                <s-badge>
                  {item.when
                    ? item.when.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: "UTC",
                      })
                    : "Immediately"}
                </s-badge>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

/** Format current time as YYYY-MM-DDTHH:MM for a <input type="datetime-local">. */
function isoLocalNow(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
