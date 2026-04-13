import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { decrypt } from "../lib/encryption.server";
import { ZernioClient } from "../lib/zernio-client";

/**
 * Editor for a single PostTemplate. The route id is "new" when creating.
 *
 * Saves and deletes go through XHR to /api/upsert-template and
 * /api/delete-template (avoids the embedded-app POST 410 problem).
 */

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const config = await db.shopConfig.findUnique({
    where: { shop: session.shop },
  });
  if (!config) return { configured: false };

  const id = params.id;
  const isNew = id === "new";

  let template = null;
  if (!isNew) {
    template = await db.postTemplate.findFirst({
      where: { id, shopConfigId: config.id },
    });
  }

  // Fetch accounts so the editor can show platform/account pickers.
  // If the API key is invalid, fall back to empty list — the editor
  // still works for caption/trigger fields.
  let accounts: Array<{ _id: string; platform: string; username: string }> = [];
  try {
    const apiKey = decrypt(config.zernioApiKeyEncrypted);
    const client = new ZernioClient(apiKey);
    const fetched = await client.getAccounts(config.defaultProfileId || undefined);
    accounts = fetched
      .filter((a) => a.isActive)
      .map((a) => ({ _id: a._id, platform: a.platform, username: a.username }));
  } catch {
    // Non-fatal
  }

  return {
    configured: true,
    isNew,
    template,
    accounts,
    defaultTimezone: config.defaultTimezone,
  };
};

const TRIGGERS = [
  { value: "manual", label: "Manual (quick-start in compose)" },
  { value: "new_product", label: "When a product is created" },
  { value: "price_drop", label: "When a product goes on sale" },
  { value: "back_in_stock", label: "When a product is back in stock" },
];

const VARIABLES = [
  { token: "{{title}}", desc: "Product title" },
  { token: "{{price}}", desc: "Lowest variant price" },
  { token: "{{url}}", desc: "Product page URL" },
  { token: "{{description}}", desc: "Product description (first 200 chars)" },
];

export default function TemplateEditor() {
  const data = useLoaderData<typeof loader>();
  const params = useParams();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  // ALL hooks before any early return
  const t = data.template;
  const [name, setName] = useState(t?.name ?? "");
  const [triggerType, setTriggerType] = useState(t?.triggerType ?? "manual");
  const [contentTemplate, setContentTemplate] = useState(t?.contentTemplate ?? "");
  const [platforms, setPlatforms] = useState<string[]>(t?.platforms ?? []);
  const [accountIds, setAccountIds] = useState<string[]>(t?.accountIds ?? []);
  const [isActive, setIsActive] = useState<boolean>(t?.isActive ?? true);
  const [autoPublishDelay, setAutoPublishDelay] = useState<string>(
    t?.autoPublishDelay != null ? String(t.autoPublishDelay) : "",
  );
  const [autoPublishTime, setAutoPublishTime] = useState<string>(
    t?.autoPublishTime ?? "",
  );
  const [submitState, setSubmitState] = useState<"idle" | "saving" | "deleting" | "error">("idle");
  const [submitError, setSubmitError] = useState("");

  if (!data.configured) {
    return (
      <s-page heading="Template">
        <s-section>
          <s-banner tone="warning">Please complete setup first.</s-banner>
        </s-section>
      </s-page>
    );
  }

  if (!data.isNew && !t) {
    return (
      <s-page heading="Template not found">
        <s-section>
          <s-banner tone="critical">
            We could not find that template. It may have been deleted.
          </s-banner>
          <s-button onClick={() => navigate("/app/templates")}>
            Back to templates
          </s-button>
        </s-section>
      </s-page>
    );
  }

  // Group accounts by platform for the picker
  const grouped: Record<string, typeof data.accounts> = {};
  for (const a of data.accounts) (grouped[a.platform] ||= []).push(a);

  const togglePlatform = (p: string) => {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
    // Auto-deselect any accounts on a platform we just removed
    if (platforms.includes(p)) {
      setAccountIds((prev) =>
        prev.filter((id) => {
          const acc = data.accounts.find((a) => a._id === id);
          return acc?.platform !== p;
        }),
      );
    }
  };

  const toggleAccount = (id: string) => {
    setAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const insertVariable = (token: string) => {
    setContentTemplate((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${token}`);
  };

  const handleSave = () => {
    if (!name.trim()) {
      setSubmitError("Name is required");
      setSubmitState("error");
      return;
    }
    if (!contentTemplate.trim()) {
      setSubmitError("Content is required");
      setSubmitState("error");
      return;
    }

    setSubmitState("saving");
    setSubmitError("");

    const body = new URLSearchParams();
    if (params.id && params.id !== "new") body.append("id", params.id);
    body.append("name", name.trim());
    body.append("triggerType", triggerType);
    body.append("contentTemplate", contentTemplate.trim());
    body.append("platforms", platforms.join(","));
    body.append("accountIds", accountIds.join(","));
    body.append("isActive", isActive ? "true" : "false");
    if (autoPublishDelay && /^\d+$/.test(autoPublishDelay)) {
      body.append("autoPublishDelay", autoPublishDelay);
    }
    if (autoPublishTime && /^\d{2}:\d{2}$/.test(autoPublishTime)) {
      body.append("autoPublishTime", autoPublishTime);
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upsert-template", true);
    xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText);
        if (res.success) {
          shopify.toast.show("Template saved");
          navigate("/app/templates");
        } else {
          setSubmitState("error");
          setSubmitError(res.error || "Save failed");
        }
      } catch {
        setSubmitState("error");
        setSubmitError("Bad response from server");
      }
    };
    xhr.onerror = () => {
      setSubmitState("error");
      setSubmitError("Network error");
    };
    xhr.send(body.toString());
  };

  const handleDelete = () => {
    if (!t || !confirm(`Delete template "${t.name}"? This cannot be undone.`)) {
      return;
    }
    setSubmitState("deleting");

    const body = new URLSearchParams();
    body.append("id", t.id);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/delete-template", true);
    xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText);
        if (res.success) {
          shopify.toast.show("Template deleted");
          navigate("/app/templates");
        } else {
          setSubmitState("error");
          setSubmitError(res.error || "Delete failed");
        }
      } catch {
        setSubmitState("error");
        setSubmitError("Bad response from server");
      }
    };
    xhr.onerror = () => {
      setSubmitState("error");
      setSubmitError("Network error");
    };
    xhr.send(body.toString());
  };

  const showSchedule = triggerType !== "manual";

  return (
    <s-page heading={data.isNew ? "New template" : `Edit: ${t?.name ?? "Template"}`}>
      <s-button slot="primary-action" variant="primary" onClick={handleSave}>
        {submitState === "saving" ? "Saving..." : "Save template"}
      </s-button>
      <s-button slot="secondary-actions" onClick={() => navigate("/app/templates")}>
        Cancel
      </s-button>

      {submitError && (
        <s-banner tone="critical">{submitError}</s-banner>
      )}

      <s-section heading="Basics">
        <s-text-field
          label="Template name"
          value={name}
          placeholder="e.g. New product launch"
          onChange={(e: any) => setName(e.currentTarget.value)}
        ></s-text-field>

        <s-select
          label="Trigger"
          details="When this template is used"
          value={triggerType}
          onChange={(e: any) => setTriggerType(e.currentTarget.value)}
        >
          {TRIGGERS.map((tt) => (
            <s-option key={tt.value} value={tt.value}>
              {tt.label}
            </s-option>
          ))}
        </s-select>

        <s-checkbox
          label="Active"
          details="Inactive templates are ignored by triggers and hidden from the compose quick-start"
          checked={isActive || undefined}
          onChange={() => setIsActive((prev) => !prev)}
        ></s-checkbox>
      </s-section>

      <s-section heading="Content">
        <s-text-area
          label="Caption"
          rows={6}
          value={contentTemplate}
          placeholder="Now in stock: {{title}} for {{price}} → {{url}}"
          onChange={(e: any) => setContentTemplate(e.currentTarget.value)}
        ></s-text-area>

        <s-stack direction="block" gap="small-100">
          <s-text color="subdued">Insert variable:</s-text>
          <s-stack direction="inline" gap="small-100">
            {VARIABLES.map((v) => (
              <s-button
                key={v.token}
                size="slim"
                onClick={() => insertVariable(v.token)}
              >
                {v.token}
              </s-button>
            ))}
          </s-stack>
        </s-stack>
      </s-section>

      {data.accounts.length > 0 && (
        <s-section heading="Where to post">
          <s-paragraph>
            Pick at least one account this template publishes to.
            {triggerType !== "manual" && (
              <s-text fontWeight="bold">
                {" "}Required for auto-publish — if left blank, this trigger
                will skip every fire (safer than accidentally broadcasting
                to every connected account).
              </s-text>
            )}
          </s-paragraph>
          <s-stack direction="block" gap="small-200">
            {Object.entries(grouped).map(([platform, accs]) => (
              <s-box
                key={platform}
                padding="small-200"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small-100">
                  <s-checkbox
                    label={platform}
                    checked={platforms.includes(platform) || undefined}
                    onChange={() => togglePlatform(platform)}
                  ></s-checkbox>
                  {platforms.includes(platform) && (
                    <s-stack direction="block" gap="small-100">
                      {accs.map((a) => (
                        <s-checkbox
                          key={a._id}
                          label={`@${a.username}`}
                          checked={accountIds.includes(a._id) || undefined}
                          onChange={() => toggleAccount(a._id)}
                        ></s-checkbox>
                      ))}
                    </s-stack>
                  )}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      )}

      {showSchedule && (
        <s-section heading="Scheduling">
          <s-paragraph>
            Posts trigger immediately by default. Add a delay or fix a
            time-of-day if you want them to land at a specific moment.
          </s-paragraph>

          <s-text-field
            label="Delay (minutes)"
            details="Wait this many minutes after the trigger fires"
            value={autoPublishDelay}
            placeholder="0"
            onChange={(e: any) => setAutoPublishDelay(e.currentTarget.value)}
          ></s-text-field>

          <s-text-field
            label="Or fix a time-of-day (HH:mm)"
            details={`Schedules for the next occurrence of this time in ${data.defaultTimezone}. Overrides delay.`}
            value={autoPublishTime}
            placeholder="09:00"
            onChange={(e: any) => setAutoPublishTime(e.currentTarget.value)}
          ></s-text-field>
        </s-section>
      )}

      {!data.isNew && (
        <s-section heading="Danger zone">
          <s-button
            tone="critical"
            onClick={handleDelete}
            disabled={submitState === "deleting" || undefined}
          >
            {submitState === "deleting" ? "Deleting..." : "Delete template"}
          </s-button>
        </s-section>
      )}

      <s-section slot="aside" heading="Preview">
        <s-paragraph>
          When this template runs against a product titled
          <s-text fontWeight="bold"> "Sample Product"</s-text> at
          <s-text fontWeight="bold"> $19.99</s-text>, it will produce:
        </s-paragraph>
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-text>
            {previewContent(contentTemplate)}
          </s-text>
        </s-box>
      </s-section>
    </s-page>
  );
}

/** Render a quick preview by substituting placeholder values. */
function previewContent(tpl: string): string {
  if (!tpl) return "(empty)";
  return tpl
    .replace(/\{\{title\}\}/g, "Sample Product")
    .replace(/\{\{price\}\}/g, "19.99")
    .replace(/\{\{url\}\}/g, "https://your-store.myshopify.com/products/sample")
    .replace(/\{\{description\}\}/g, "A short product description for preview…");
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
