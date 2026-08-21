import { describe, expect, it } from "vitest";
import { buildUsageIdempotencyKey, derivePeriodStart } from "../billing.server";

describe("derivePeriodStart", () => {
  it("is currentPeriodEnd minus 30 days, day precision", () => {
    expect(derivePeriodStart("2026-08-31T10:30:00Z")).toBe("2026-08-01");
  });

  it("is stable across times within the same cycle", () => {
    expect(derivePeriodStart("2026-08-31T00:00:01Z")).toBe(
      derivePeriodStart("2026-08-31T23:59:59Z"),
    );
  });
});

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
