import { describe, expect, it } from "vitest";
import { buildUsageIdempotencyKey } from "../billing.server";

describe("buildUsageIdempotencyKey", () => {
  it("is stable for the same shop, unit, and period", () => {
    const args = {
      shop: "test.myshopify.com",
      unitId: "65f000000000000000000001",
      periodStart: "2026-08-01",
    };
    expect(buildUsageIdempotencyKey(args)).toBe(
      "test.myshopify.com:65f000000000000000000001:2026-08-01",
    );
    expect(buildUsageIdempotencyKey(args)).toBe(buildUsageIdempotencyKey(args));
  });

  it("differs across periods so the next cycle re-bills the same account", () => {
    const base = { shop: "test.myshopify.com", unitId: "65f000000000000000000001" };
    expect(buildUsageIdempotencyKey({ ...base, periodStart: "2026-08-01" })).not.toBe(
      buildUsageIdempotencyKey({ ...base, periodStart: "2026-08-31" }),
    );
  });
});
