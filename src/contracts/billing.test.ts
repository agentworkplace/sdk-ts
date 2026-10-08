import { expect, it } from "vitest";
import {
  billingInvoiceListSchema,
  billingInvoiceListRequestSchema,
  billingStatusSchema,
  billingSummarySchema,
  billingCheckoutSchema,
  billingPortalSchema,
  billingCommandSchema,
  billingCommandRequestSchema,
  billingPurchaseSchema,
  billingPurchaseRequestSchema,
  billingPaymentActionSchema,
} from "./billing.js";
const status = {
  workplaceId: "11111111-1111-4111-8111-111111111111",
  plan: "free",
  price: { currency: "usd", monthlyAmount: 2000 },
  subscription: null,
  pendingCommand: null,
};
it("validates narrow payment actions and rejects insecure URLs and extra provider fields", () => {
  for (const value of [
    {
      kind: "checkout",
      url: "https://checkout.stripe.com/synthetic",
      expiresAt: "2026-09-21T01:00:00.000Z",
    },
    { kind: "invoice", url: "https://invoice.stripe.com/i/synthetic" },
    { kind: "pending" },
    { kind: "none" },
    { kind: "support", reference: status.workplaceId },
  ])
    expect(billingPaymentActionSchema.parse(value)).toEqual(value);
  for (const value of [
    { kind: "invoice", url: "http://invoice.stripe.com/i/synthetic" },
    { kind: "invoice", url: "javascript:alert(1)" },
    { kind: "checkout", url: "https://checkout.stripe.com/synthetic" },
    { kind: "pending", payment_method: "pm_private" },
    { kind: "support", reference: "sub_private" },
  ])
    expect(billingPaymentActionSchema.safeParse(value).success).toBe(false);
});
it("accepts purchase progress without provider identifiers or payment links", () => {
  const purchase = {
    id: status.workplaceId,
    state: "pending",
    requestedAt: "2026-09-21T00:00:00.000Z",
    expiresAt: "2026-09-21T01:00:00.000Z",
  };
  expect(billingPurchaseSchema.parse(purchase)).toEqual(purchase);
  expect(billingPurchaseRequestSchema.parse({ id: purchase.id })).toEqual({
    id: purchase.id,
  });
  for (const value of [
    { ...purchase, url: "https://checkout.stripe.com/private" },
    { ...purchase, state: "active" },
    { ...purchase, id: "cs_private" },
    { ...purchase, expiresAt: "tomorrow" },
  ])
    expect(billingPurchaseSchema.safeParse(value).success).toBe(false);
  expect(
    billingPurchaseRequestSchema.safeParse({
      id: purchase.id,
      priceId: "price_other",
    }).success,
  ).toBe(false);
});
it("accepts product billing status but rejects provider payloads and invalid pricing/state", () => {
  expect(billingStatusSchema.parse(status)).toEqual(status);
  for (const value of [
    { ...status, stripeCustomer: "cus_private" },
    { ...status, plan: "active" },
    { ...status, price: { currency: "usd", monthlyAmount: 1000 } },
    { ...status, subscription: { status: "past_due" } },
  ])
    expect(billingStatusSchema.safeParse(value).success).toBe(false);
});

it("keeps management identity explicit and rejects provider-shaped states", () => {
  const id = status.workplaceId;
  const request = { id, expectedRevision: id, action: "cancel" };
  expect(billingCommandRequestSchema.parse(request)).toEqual(request);
  for (const value of [
    { ...request, action: "upgrade" },
    { ...request, id: "sub_private" },
    { ...request, proration: true },
  ])
    expect(billingCommandRequestSchema.safeParse(value).success).toBe(false);
  const command = {
    id,
    action: "resume",
    state: "pending",
    requestedAt: "2026-09-21T00:00:00.000Z",
  };
  expect(billingCommandSchema.parse(command)).toEqual(command);
  expect(
    billingCommandSchema.safeParse({ ...command, state: "active" }).success,
  ).toBe(false);
  expect(
    billingCommandSchema.safeParse({ ...command, credentialId: id }).success,
  ).toBe(false);
});

it("bounds invoice pages and rejects URLs in summaries or cursors", () => {
  expect(billingInvoiceListSchema.parse({ invoices: [], next: null })).toEqual({
    invoices: [],
    next: null,
  });
  expect(
    billingInvoiceListRequestSchema.parse({ after: "in_example" }),
  ).toEqual({ after: "in_example" });
  expect(
    billingInvoiceListRequestSchema.safeParse({
      after: "https://invoice.stripe.com/i/private",
    }).success,
  ).toBe(false);
  expect(
    billingInvoiceListSchema.safeParse({
      invoices: [],
      next: null,
      url: "https://invoice.stripe.com/i/private",
    }).success,
  ).toBe(false);
});

it("adds redirect contracts without extending the released strict status shape", () => {
  const summary = {
    status,
    state: "free",
    renewalAt: null,
    endedAt: null,
    portalEnabled: false,
    canManage: false,
    canUpgrade: true,
  };
  expect(billingSummarySchema.parse(summary)).toEqual(summary);
  expect(
    billingStatusSchema.safeParse({ ...status, canUpgrade: true }).success,
  ).toBe(false);
  expect(
    billingSummarySchema.safeParse({ ...summary, renewalAt: "tomorrow" })
      .success,
  ).toBe(false);
  expect(
    billingPortalSchema.parse({ url: "https://billing.stripe.com/p/session" }),
  ).toEqual({ url: "https://billing.stripe.com/p/session" });
  for (const value of [
    { url: "http://billing.stripe.com/p/session" },
    { url: "javascript:alert(1)" },
    { url: "https://billing.stripe.com/p/session", customer: "cus_private" },
  ])
    expect(billingPortalSchema.safeParse(value).success).toBe(false);
  const checkout = {
    purchase: {
      id: status.workplaceId,
      state: "pending",
      requestedAt: "2026-10-04T00:00:00.000Z",
      expiresAt: "2026-10-04T01:00:00.000Z",
    },
    action: { kind: "pending" },
  };
  expect(billingCheckoutSchema.parse(checkout)).toEqual(checkout);
  expect(
    billingCheckoutSchema.safeParse({
      ...checkout,
      purchase: { ...checkout.purchase, id: "cs_native" },
    }).success,
  ).toBe(false);
});
