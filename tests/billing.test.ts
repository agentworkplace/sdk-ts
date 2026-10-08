import { expect, it, vi } from "vitest";
import { AgentWorkplace } from "../src/client.js";
const status = {
  workplaceId: "11111111-1111-4111-8111-111111111111",
  plan: "free",
  price: { currency: "usd", monthlyAmount: 2000 },
  subscription: null,
  pendingCommand: null,
};
it.each([{ apiKey: "fixture-key" }, { humanSession: true as const }])(
  "reads display capabilities without changing the legacy status contract: %j",
  async (authority) => {
    const summary = {
      status,
      state: "free",
      renewalAt: null,
      endedAt: null,
      portalEnabled: true,
      canManage: false,
      canUpgrade: true,
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(summary))
      .mockResolvedValueOnce(Response.json(status))
      .mockResolvedValueOnce(
        Response.json({ ...summary, renewalAt: "unknown" }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ...summary,
          status: { ...status, customerId: "cus_private" },
        }),
      );
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    expect(await client.getBillingSummary(authority)).toEqual(summary);
    expect(await client.getBillingStatus(authority)).toEqual(status);
    await expect(client.getBillingSummary(authority)).rejects.toThrow();
    await expect(client.getBillingSummary(authority)).rejects.toThrow();
    expect(new URL(String(fetch.mock.calls[0]![0])).pathname).toBe(
      "/v1/workplace/billing/summary",
    );
    for (const [, init] of fetch.mock.calls) {
      if ("apiKey" in authority)
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer fixture-key",
        );
      else expect(init?.credentials).toBe("include");
    }
  },
);
it.each([{ apiKey: "fixture-key" }, { humanSession: true as const }])(
  "reads validated billing status with explicit authority %j",
  async (authority) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(status));
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    expect(await client.getBillingStatus(authority)).toEqual(status);
    const [url, init] = fetch.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe("/v1/workplace/billing");
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Request-ID")).toMatch(/^[a-f0-9-]{36}$/i);
    if ("apiKey" in authority)
      expect(headers.get("Authorization")).toBe("Bearer fixture-key");
    else {
      expect(init?.credentials).toBe("include");
      expect(headers.has("Authorization")).toBe(false);
    }
  },
);
it("preserves role denial and rejects malformed billing responses", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json(
        { error: { code: "access_denied", message: "Denied" } },
        { status: 401 },
      ),
    )
    .mockResolvedValueOnce(
      Response.json({ ...status, stripeCustomer: "cus_private" }),
    );
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  await expect(
    client.getBillingStatus({ apiKey: "fixture-key" }),
  ).rejects.toMatchObject({ status: 401, code: "access_denied" });
  await expect(
    client.getBillingStatus({ apiKey: "fixture-key" }),
  ).rejects.toThrow();
});

it.each([{ apiKey: "fixture-key" }, { humanSession: true as const }])(
  "submits a stable command and polls it with explicit authority %j",
  async (authority) => {
    const id = status.workplaceId;
    const command = {
      id,
      action: "cancel",
      state: "pending",
      requestedAt: "2026-09-21T00:00:00.000Z",
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(command),
    );
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    const input = { id, expectedRevision: id, action: "cancel" as const };
    expect(await client.requestBillingCommand(authority, input)).toEqual(
      command,
    );
    expect(await client.requestBillingCommand(authority, input)).toEqual(
      command,
    );
    expect(await client.getBillingCommand(authority, id)).toEqual(command);
    const [url, init] = fetch.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe(
      "/v1/workplace/billing/commands",
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(input);
    expect(fetch.mock.calls[1]![1]?.body).toBe(init?.body);
    expect(new URL(String(fetch.mock.calls[2]![0])).pathname).toBe(
      `/v1/workplace/billing/commands/${id}`,
    );
    if ("apiKey" in authority)
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer fixture-key",
      );
    else expect(init?.credentials).toBe("include");
  },
);

it.each([{ apiKey: "fixture-key" }, { humanSession: true as const }])(
  "keeps purchase identity stable and retrieves payment separately with authority %j",
  async (authority) => {
    const id = status.workplaceId;
    const purchase = {
      id,
      state: "pending",
      requestedAt: "2026-09-21T00:00:00.000Z",
      expiresAt: "2026-09-21T01:00:00.000Z",
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
      Response.json(
        String(url).endsWith("/payment") ? { kind: "pending" } : purchase,
      ),
    );
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    expect(await client.requestBillingPurchase(authority, { id })).toEqual(
      purchase,
    );
    await client.requestBillingPurchase(authority, { id });
    expect(fetch.mock.calls[0]![1]?.body).toBe(fetch.mock.calls[1]![1]?.body);
    expect(await client.getBillingPurchase(authority, id)).toEqual(purchase);
    expect(
      await client.getBillingPaymentAction(authority, { purchaseId: id }),
    ).toEqual({ kind: "pending" });
    expect(
      fetch.mock.calls.map(([url]) => new URL(String(url)).pathname),
    ).toEqual([
      "/v1/workplace/billing/purchases",
      "/v1/workplace/billing/purchases",
      `/v1/workplace/billing/purchases/${id}`,
      "/v1/workplace/billing/payment",
    ]);
    expect(JSON.parse(String(fetch.mock.calls[3]![1]?.body))).toEqual({
      purchaseId: id,
    });
    for (const [, init] of fetch.mock.calls) {
      if ("apiKey" in authority)
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer fixture-key",
        );
      else expect(init?.credentials).toBe("include");
    }
  },
);

it("lists bounded invoice pages and requests private documents through HTTP only", async () => {
  const page = { invoices: [], next: "in_next" };
  const link = { kind: "invoice", url: "https://invoice.stripe.com/i/private" };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json(page))
    .mockResolvedValueOnce(Response.json(link));
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  expect(
    await client.listBillingInvoices(
      { apiKey: "fixture-key" },
      { after: "in_cursor" },
    ),
  ).toEqual(page);
  expect(String(fetch.mock.calls[0]![0])).toBe(
    "https://api.example.test/v1/workplace/billing/invoices?after=in_cursor",
  );
  expect(
    await client.getBillingInvoiceLink({ humanSession: true }, "in_example"),
  ).toEqual(link);
  const [url, init] = fetch.mock.calls[1]!;
  expect(String(url)).toBe(
    "https://api.example.test/v1/workplace/billing/invoices/in_example/link",
  );
  expect(init?.method).toBe("POST");
  expect(init?.credentials).toBe("include");
});

it.each([{ apiKey: "fixture-key" }, { humanSession: true as const }])(
  "opens Checkout and the portal through validated API responses with %j",
  async (authority) => {
    const purchase = {
      id: status.workplaceId,
      state: "ready",
      requestedAt: "2026-10-04T00:00:00.000Z",
      expiresAt: "2026-10-04T01:00:00.000Z",
    };
    const checkout = {
      purchase,
      action: {
        kind: "checkout",
        url: "https://checkout.stripe.com/c/session",
        expiresAt: purchase.expiresAt,
      },
    };
    const portal = { url: "https://billing.stripe.com/p/session" };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(checkout))
      .mockResolvedValueOnce(Response.json(portal))
      .mockResolvedValueOnce(Response.json({ url: "javascript:alert(1)" }));
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    expect(
      await client.openBillingCheckout(authority, { id: purchase.id }),
    ).toEqual(checkout);
    expect(await client.openBillingPortal(authority)).toEqual(portal);
    await expect(client.openBillingPortal(authority)).rejects.toThrow();
    expect(new URL(String(fetch.mock.calls[0]![0])).pathname).toBe(
      "/v1/workplace/billing/checkout",
    );
    expect(fetch.mock.calls[0]![1]?.body).toBe(
      JSON.stringify({ id: purchase.id }),
    );
    expect(new URL(String(fetch.mock.calls[1]![0])).pathname).toBe(
      "/v1/workplace/billing/portal",
    );
    expect(fetch.mock.calls[1]![1]?.body).toBe("{}");
  },
);
