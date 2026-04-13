import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";

/**
 * Create or update a PostTemplate.
 *
 * Skips authenticate.admin() for the same POST/410 reason as our other
 * /api/* endpoints. Shop is resolved from the most recent offline session.
 *
 * Form fields:
 *   id?              — when present, update; otherwise create
 *   name             — required
 *   triggerType      — manual | new_product | price_drop | back_in_stock
 *   contentTemplate  — required, mustache-style content
 *   platforms        — comma-separated platform names
 *   accountIds       — comma-separated Zernio account ids
 *   isActive         — "true" | "false"
 *   autoPublishDelay — optional minutes (positive integer)
 *   autoPublishTime  — optional HH:mm string
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const recentSession = await db.session.findFirst({
    orderBy: { id: "desc" },
    where: { isOnline: false },
  });
  const shop = recentSession?.shop;
  if (!shop) return Response.json({ error: "Session not found" }, { status: 400 });

  const config = await db.shopConfig.findUnique({ where: { shop } });
  if (!config) return Response.json({ error: "Not configured" }, { status: 400 });

  const formData = await request.formData();

  const id = formData.get("id") as string | null;
  const name = ((formData.get("name") as string) || "").trim();
  const triggerType = (formData.get("triggerType") as string) || "manual";
  const contentTemplate = ((formData.get("contentTemplate") as string) || "").trim();
  const platforms = parseCsv(formData.get("platforms") as string);
  const accountIds = parseCsv(formData.get("accountIds") as string);
  const isActive = (formData.get("isActive") as string) === "true";

  const delayRaw = formData.get("autoPublishDelay") as string | null;
  const timeRaw = formData.get("autoPublishTime") as string | null;
  const autoPublishDelay = delayRaw && /^\d+$/.test(delayRaw) ? parseInt(delayRaw, 10) : null;
  const autoPublishTime = timeRaw && /^\d{2}:\d{2}$/.test(timeRaw) ? timeRaw : null;

  if (!name) return Response.json({ error: "Name is required" });
  if (!contentTemplate) return Response.json({ error: "Content is required" });
  if (!["manual", "new_product", "price_drop", "back_in_stock"].includes(triggerType)) {
    return Response.json({ error: "Invalid trigger type" });
  }

  try {
    if (id) {
      // Update — scope by shopConfigId so a forged id can't touch another shop's templates
      const existing = await db.postTemplate.findFirst({
        where: { id, shopConfigId: config.id },
      });
      if (!existing) return Response.json({ error: "Template not found" });

      await db.postTemplate.update({
        where: { id },
        data: {
          name,
          triggerType,
          contentTemplate,
          platforms,
          accountIds,
          isActive,
          autoPublishDelay,
          autoPublishTime,
        },
      });
      return Response.json({ success: true, id });
    }

    const created = await db.postTemplate.create({
      data: {
        shopConfigId: config.id,
        name,
        triggerType,
        contentTemplate,
        platforms,
        accountIds,
        isActive,
        autoPublishDelay,
        autoPublishTime,
      },
    });
    return Response.json({ success: true, id: created.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    return Response.json({ error: message });
  }
};

function parseCsv(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
