/**
 * Client for Zernio's internal Shopify endpoints (app/api/internal/shopify/*
 * in the main repo). Auth is the ZERNIO_INTERNAL_SECRET shared secret, which
 * must equal SHOPIFY_CONNECTOR_SECRET on the Zernio side.
 */

const BASE =
  process.env.ZERNIO_INTERNAL_BASE || "https://zernio.com/api/internal/shopify";

async function internalRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const secret = process.env.ZERNIO_INTERNAL_SECRET;
  if (!secret) throw new Error("ZERNIO_INTERNAL_SECRET is not set");

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `Zernio internal ${method} ${path} failed (${res.status}): ${JSON.stringify(json)}`,
    );
  }
  return json as T;
}

export function provisionMerchant(args: {
  shop: string;
  email?: string | null;
}): Promise<{ userId: string; apiKey?: string }> {
  return internalRequest("POST", "/provision", {
    shop: args.shop,
    ...(args.email ? { email: args.email } : {}),
  });
}

export async function suspendMerchant(args: { shop: string }): Promise<void> {
  await internalRequest("POST", "/suspend", { shop: args.shop });
}

export async function fetchBillableUnits(args: { shop: string }): Promise<
  Array<{ unitId: string; description: string; amountUsd: number }>
> {
  const res = await internalRequest<{
    units: Array<{ unitId: string; description: string; amountUsd: number }>;
  }>("GET", `/billable-units?shop=${encodeURIComponent(args.shop)}`);
  return res.units;
}
