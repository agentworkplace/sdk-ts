import { z } from "zod";

export const billingCommandRequestSchema = z
  .object({
    id: z.uuid(),
    expectedRevision: z.uuid(),
    action: z.enum(["cancel", "resume"]),
  })
  .strict();
export const billingCommandSchema = z
  .object({
    id: z.uuid(),
    action: z.enum(["cancel", "resume"]),
    state: z.enum(["pending", "completed", "superseded", "failed"]),
    requestedAt: z.iso.datetime(),
  })
  .strict();
export type BillingCommand = z.infer<typeof billingCommandSchema>;
export type BillingCommandRequest = z.infer<typeof billingCommandRequestSchema>;

/** Product status, never raw provider objects or reusable financial links. */
export const billingStatusSchema = z
  .object({
    workplaceId: z.uuid(),
    plan: z.enum(["starter", "free", "pro"]),
    pendingCommand: billingCommandSchema.nullable(),
    price: z
      .object({ currency: z.literal("usd"), monthlyAmount: z.literal(2000) })
      .strict(),
    subscription: z
      .object({
        revision: z.uuid(),
        health: z.enum([
          "current",
          "verification_pending",
          "payment_required",
          "stopping",
          "ended",
        ]),
        paidThrough: z.iso.datetime().nullable(),
        recoveryEndsAt: z.iso.datetime().nullable(),
        cancellationScheduled: z.boolean(),
        lastVerifiedAt: z.iso.datetime().nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type BillingStatus = z.infer<typeof billingStatusSchema>;

export const billingPurchaseRequestSchema = z.object({ id: z.uuid() }).strict();
export const billingPaymentRequestSchema = z
  .object({ purchaseId: z.uuid().optional() })
  .strict();
export type BillingPaymentRequest = z.infer<typeof billingPaymentRequestSchema>;
export type BillingPurchaseRequest = z.infer<
  typeof billingPurchaseRequestSchema
>;

/** Inspectable progress deliberately excludes reusable payment capabilities. */
export const billingPurchaseSchema = z
  .object({
    id: z.uuid(),
    state: z.enum([
      "pending",
      "ready",
      "processing",
      "succeeded",
      "expired",
      "superseded",
      "failed",
    ]),
    requestedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type BillingPurchase = z.infer<typeof billingPurchaseSchema>;

/** Sensitive links are issued separately from ordinary status responses. */
const paymentUrl = z.url({ protocol: /^https$/ });
export const billingPaymentActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("checkout"),
      url: paymentUrl,
      expiresAt: z.iso.datetime(),
    })
    .strict(),
  z.object({ kind: z.literal("invoice"), url: paymentUrl }).strict(),
  z.object({ kind: z.literal("pending") }).strict(),
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("support"), reference: z.uuid() }).strict(),
]);
export type BillingPaymentAction = z.infer<typeof billingPaymentActionSchema>;

/** Invoice references are identifiers, never native hosted capabilities. */
export const billingInvoiceReferenceSchema = z
  .string()
  .regex(/^in_[A-Za-z0-9_]+$/)
  .max(255);
export const billingInvoiceListRequestSchema = z
  .object({
    after: billingInvoiceReferenceSchema.optional(),
  })
  .strict();
export const billingInvoiceSummarySchema = z
  .object({
    reference: billingInvoiceReferenceSchema,
    number: z.string().nullable(),
    createdAt: z.iso.datetime(),
    status: z.enum(["draft", "open", "paid", "uncollectible", "void"]),
    currency: z.string().regex(/^[a-z]{3}$/),
    total: z.number().int().safe(),
    amountPaid: z.number().int().safe(),
    amountRemaining: z.number().int().safe(),
  })
  .strict();
export const billingInvoiceListSchema = z
  .object({
    invoices: z.array(billingInvoiceSummarySchema).max(20),
    next: billingInvoiceReferenceSchema.nullable(),
  })
  .strict();
export type BillingInvoiceListRequest = z.infer<
  typeof billingInvoiceListRequestSchema
>;
export type BillingInvoiceSummary = z.infer<typeof billingInvoiceSummarySchema>;
export type BillingInvoiceList = z.infer<typeof billingInvoiceListSchema>;
