import { describe, expect, it, vi } from "vitest";

describe("package import", () => {
  it("does not require application environment variables", async () => {
    const sdk = await import("../src/index.js");

    expect(
      new sdk.AgentWorkplace({
        baseUrl: "https://api.example.com",
        fetch: vi.fn(),
      }),
    ).toBeInstanceOf(sdk.AgentWorkplace);
  });
});
