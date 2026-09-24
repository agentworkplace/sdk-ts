import { describe, expect, it, vi } from "vitest";
import { AgentWorkplace, AgentWorkplaceError } from "../src/index.js";

const receiptProof = "a".repeat(43);
const operationId = "21e14f1e-f0f1-4e59-8bd5-384bc70ed1c9";
const operation = {
  operationId,
  state: "awaiting_current",
  generation: 1,
  createdAt: "2026-09-18T00:00:00.000Z",
  expiresAt: "2026-09-18T00:10:00.000Z",
  receiptExpiresAt: "2026-10-18T00:00:00.000Z",
  finishedAt: null,
};

describe("owner email transport", () => {
  it("uses browser sessions for mutations and explicitly omits cookies for receipt recovery", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (url) =>
        Response.json(
          url.toString().endsWith("/status") ? { operation } : operation,
        ),
      );
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    const reference = { operationId, receiptProof };
    const code = { ...reference, generation: 1, code: "123456" };
    const inputs = [
      { receiptProof, newEmail: "new@example.test" },
      code,
      code,
      { ...reference, generation: 1 },
      reference,
      { receiptProof },
    ];
    await client.beginOwnerEmailChange(
      inputs[0] as { receiptProof: string; newEmail: string },
    );
    await client.confirmOwnerCurrentEmail(code);
    await client.confirmOwnerNewEmail(code);
    await client.resendOwnerEmailProof({ ...reference, generation: 1 });
    await client.cancelOwnerEmailChange(reference);
    expect(await client.ownerEmailChangeStatus(receiptProof)).toEqual({
      operation,
    });
    expect(
      fetch.mock.calls.map(([url]) => new URL(url.toString()).pathname),
    ).toEqual(
      ["begin", "current-proof", "new-proof", "resend", "cancel", "status"].map(
        (action) => `/v1/access/email-change/${action}`,
      ),
    );
    expect(fetch.mock.calls.map(([, request]) => request?.credentials)).toEqual(
      ["include", "include", "include", "include", "include", "omit"],
    );
    for (const [index, [url, request]] of fetch.mock.calls.entries()) {
      expect(url.toString()).not.toContain(receiptProof);
      expect(request?.method).toBe("POST");
      expect(request?.redirect).toBe("error");
      expect(JSON.parse(request?.body as string)).toEqual(inputs[index]);
      const headers = new Headers(request?.headers);
      expect(headers.get("Authorization")).toBeNull();
      expect(headers.get("Cookie")).toBeNull();
      expect(headers.get("Origin")).toBeNull(); // The browser supplies Origin.
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("X-Request-ID")).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("returns unavailable status without starting another operation", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ operation: null }));
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    expect(await client.ownerEmailChangeStatus(receiptProof)).toEqual({
      operation: null,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { operation: { ...operation, email: "private@example.test" } },
    { operation: { ...operation, state: "failed" } },
    { operation: { ...operation, generation: 0 } },
    { operation: null, receiptProof },
  ])("rejects malformed or private receipt responses", async (response) => {
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch: vi.fn().mockResolvedValue(Response.json(response)),
    });
    await expect(client.ownerEmailChangeStatus(receiptProof)).rejects.toThrow(
      "invalid response",
    );
  });

  it("preserves safe operation errors and echoed request IDs without retrying", async () => {
    const requestId = "b705ad1b-6306-45e3-815a-77aa7123ce08";
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "owner_email_conflict",
            message: "Owner email operation unavailable",
          },
        },
        { status: 409, headers: { "X-Request-ID": requestId } },
      ),
    );
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    await expect(
      client.beginOwnerEmailChange({
        receiptProof,
        newEmail: "new@example.test",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "owner_email_conflict",
      requestId,
    } satisfies Partial<AgentWorkplaceError>);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not send private proofs over insecure remote HTTP", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new AgentWorkplace({
      baseUrl: "http://remote.example.test",
      fetch,
    });
    await expect(client.ownerEmailChangeStatus(receiptProof)).rejects.toThrow(
      "HTTPS",
    );
    await expect(
      client.beginOwnerEmailChange({
        receiptProof,
        newEmail: "new@example.test",
      }),
    ).rejects.toThrow("HTTPS");
    expect(fetch).not.toHaveBeenCalled();
  });
});
