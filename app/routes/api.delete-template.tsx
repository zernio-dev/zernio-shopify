import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";

/**
 * Delete a PostTemplate. Scoped by shopConfigId so an id from another
 * shop is silently ignored.
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
  const id = formData.get("id") as string;
  if (!id) return Response.json({ error: "id is required" });

  const existing = await db.postTemplate.findFirst({
    where: { id, shopConfigId: config.id },
  });
  if (!existing) return Response.json({ error: "Template not found" });

  await db.postTemplate.delete({ where: { id } });
  return Response.json({ success: true });
};
