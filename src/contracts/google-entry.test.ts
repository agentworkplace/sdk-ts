import { it, expect } from "vitest";
import {
  googleEntryRequestSchema,
  googleDashboardReturnSchema,
  googleConnectionRequestSchema,
  googleEntryResponseSchema,
} from "./access.js";
it("separates signed-in settings and browser proof operations", () => {
  expect(
    googleEntryRequestSchema.safeParse({ action: "verify", code: "000123" })
      .success,
  ).toBe(true);
  for (const input of [
    { action: "connection" },
    { action: "start", callbackURL: "https://other.test" },
    { action: "verify", code: "12345" },
  ])
    expect(googleEntryRequestSchema.safeParse(input).success).toBe(false);
  expect(
    googleConnectionRequestSchema.safeParse({ action: "connection" }).success,
  ).toBe(true);
});
it("only allows a redirect to the Google authorization endpoint", () => {
  for (const url of [
    "https://other.test/o/oauth2/v2/auth",
    "https://accounts.google.com/other",
    "https://someone@accounts.google.com/o/oauth2/v2/auth",
  ])
    expect(
      googleEntryResponseSchema.safeParse({ phase: "redirect", url }).success,
    ).toBe(false);
});

it("allows dashboard sections and signed MCP handoffs only as local root continuations", () => {
  const next = "/oauth/device?user_code=synthetic";
  expect(
    googleDashboardReturnSchema.safeParse("/?" + new URLSearchParams({ next }))
      .success,
  ).toBe(true);
  for (const path of [
    "https://other.test",
    "//dashboard.invalid/?next=/overview",
    "/other",
    "/?next=//other.test",
    "/?next=/unknown",
    "/?token=value",
    "/#private",
  ])
    expect(googleDashboardReturnSchema.safeParse(path).success).toBe(false);
});
