import { describe, expect, it } from "vitest";

import {
  apiErrorCodeSchema,
  apiErrorResponseSchema,
  apiErrorSchema,
  commonApiErrorCodes,
} from "./errors.js";

describe("apiErrorCodeSchema", () => {
  it.each(["not_found", "internal_error", "agent2_unavailable"])(
    "accepts the lowercase snake-case code %s",
    (code) => {
      expect(apiErrorCodeSchema.parse(code)).toBe(code);
    },
  );

  it.each([
    "",
    "NotFound",
    "not-found",
    "not.found",
    "not__found",
    "2fa_required",
  ])("rejects the malformed code %s", (code) => {
    expect(apiErrorCodeSchema.safeParse(code).success).toBe(false);
  });

  it("defines only the established common codes", () => {
    expect(commonApiErrorCodes).toEqual({
      internalError: "internal_error",
      notFound: "not_found",
    });
  });
});

describe("apiErrorSchema", () => {
  it("accepts the required fields", () => {
    expect(
      apiErrorSchema.parse({ code: "not_found", message: "Not found" }),
    ).toEqual({ code: "not_found", message: "Not found" });
  });

  it("rejects malformed codes and empty messages", () => {
    expect(
      apiErrorSchema.safeParse({ code: "NotFound", message: "" }).success,
    ).toBe(false);
  });
});

describe("apiErrorResponseSchema", () => {
  it("requires the error envelope", () => {
    expect(
      apiErrorResponseSchema.safeParse({
        code: "not_found",
        message: "Not found",
      }).success,
    ).toBe(false);
  });
});
