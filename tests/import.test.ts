import { describe, expect, it, vi } from "vitest";
import type {
  AgentWorkplaceOptions,
  DocumentationClientOptions,
} from "../src/index.js";

describe("package import", () => {
  it("does not require application environment variables", async () => {
    const sdk = await import("../src/index.js");

    const transport = vi.fn<typeof fetch>();
    const productOptions = {} satisfies AgentWorkplaceOptions;
    const docsOptions = {} satisfies DocumentationClientOptions;
    for (const client of [
      new sdk.AgentWorkplace(),
      new sdk.AgentWorkplace(productOptions),
      new sdk.AgentWorkplace({ fetch: transport, transferFetch: transport }),
    ])
      expect(client).toBeInstanceOf(sdk.AgentWorkplace);
    for (const docs of [
      new sdk.DocumentationClient(),
      new sdk.DocumentationClient(docsOptions),
      new sdk.DocumentationClient({ fetch: transport }),
    ])
      expect(docs).toBeInstanceOf(sdk.DocumentationClient);
    expect(transport).not.toHaveBeenCalled();
  });
});
