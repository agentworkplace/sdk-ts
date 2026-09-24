import { describe, expect, it } from "vitest";

import { healthResponseSchema } from "./health.js";

describe("healthResponseSchema", () => {
  it("accepts the healthy response", () => {
    expect(healthResponseSchema.parse({ status: "ok" })).toEqual({
      status: "ok",
    });
  });

  it("rejects any other status", () => {
    expect(healthResponseSchema.safeParse({ status: "error" }).success).toBe(
      false,
    );
  });
});
