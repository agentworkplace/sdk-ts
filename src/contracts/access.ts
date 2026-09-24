import { mailboxSchema, mailboxAddressChoiceSchema } from "./mail.js";
import { z } from "zod";

export const signupRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    nominatedEmail: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase())
      .refine((value) => !value.endsWith(".invalid")),
    bootstrapProof: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    mailboxAddressChoice: mailboxAddressChoiceSchema.optional(),
    expectedChoiceRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export const signupResponseSchema = z.object({
  mailbox: mailboxSchema.optional(),
  workplaceId: z.uuid(),
  accountId: z.uuid(),
  cleanupAt: z.iso.datetime(),
  credential: z.object({ id: z.uuid(), key: z.string().min(1) }),
});
export const acknowledgementResponseSchema = z.object({
  acknowledged: z.literal(true),
});
export const nominationSendResponseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("queued") }),
  z.object({ state: z.literal("throttled"), retryAt: z.iso.datetime() }),
]);
export const nominationCancellationRequestSchema = z
  .object({
    nominationId: z.uuid(),
  })
  .strict();
export const nominationCorrectionRequestSchema =
  nominationCancellationRequestSchema.extend({
    nominatedEmail: signupRequestSchema.shape.nominatedEmail,
  });
export const nominationCorrectionResponseSchema = z.object({
  state: z.literal("queued"),
  nominationId: z.uuid(),
});
export const nominationCancellationResponseSchema = z.object({
  canceled: z.literal(true),
});
export const currentNominationSchema = z
  .object({
    nomination: z
      .object({ id: z.uuid(), agentId: z.uuid(), email: z.email() })
      .strict()
      .nullable(),
    cleanupAt: z.iso.datetime(),
  })
  .strict();
export const nominationAuthorizationRequestSchema = z
  .object({
    expectedNominationId: z.uuid().nullable(),
    nominatedEmail: signupRequestSchema.shape.nominatedEmail,
  })
  .strict();
export type CurrentNomination = z.infer<typeof currentNominationSchema>;
export type NominationAuthorizationRequest = z.infer<
  typeof nominationAuthorizationRequestSchema
>;
/** Legacy field name: confirmed workplace allowances, including Pro. */
export const freeAllowanceSchema = z.object({
  plan: z.enum(["free", "pro"]).optional(),
  confirmedAt: z.iso.datetime(),
  periodStart: z.iso.datetime(),
  periodEnd: z.iso.datetime(),
  outboundLimit: z.union([z.literal(200), z.literal(2000)]),
  inboundLimit: z.union([z.literal(1000), z.literal(5000)]),
  storageLimit: z.enum(["5 GB", "50 GB"]),
  outboundUsed: z.number().int().nonnegative(),
  inboundUsed: z.number().int().nonnegative(),
  storageUsedBytes: z.number().int().nonnegative(),
});

/** Optional on old servers; never infer missing usage as zero. */
export const storageUsageSchema = z.object({
  limitBytes: z.number().int().nonnegative(),
  usedBytes: z.number().int().nonnegative(),
  heldBytes: z.number().int().nonnegative(),
  availableBytes: z.number().int().nonnegative(),
});

export const accessStatusSchema = z.object({
  mailbox: mailboxSchema.optional(),
  storage: storageUsageSchema.optional(),
  cleanupWarning: z
    .object({ cleanupAt: z.iso.datetime() })
    .nullable()
    .default(null),
  workplaceId: z.uuid(),
  accountId: z.uuid(),
  role: z.enum(["owner", "admin", "member"]),
  workplaceState: z.enum(["unconfirmed", "confirmed"]),
  cleanupAt: z.iso.datetime(),
  acknowledged: z.boolean(),
  nomination: z
    .object({
      id: z.uuid(),
      email: z.email(),
      deliveryState: z.enum([
        "unsent",
        "queued",
        "accepted",
        "failed",
        "uncertain",
        "superseded",
        "expired",
      ]),
      expiresAt: z.iso.datetime().nullable(),
    })
    .nullable(),
  free: freeAllowanceSchema.nullable(),
  starter: z.object({
    outboundLimit: z.literal(2),
    inboundLimit: z.literal(20),
    storageLimit: z.literal("100 MB"),
    outboundUsed: z.number().int().nonnegative(),
    inboundUsed: z.number().int().nonnegative(),
    storageUsedBytes: z.number().int().nonnegative(),
  }),
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;
export type SignupResponse = z.infer<typeof signupResponseSchema>;
export type AcknowledgementResponse = z.infer<
  typeof acknowledgementResponseSchema
>;
export type NominationSendResponse = z.infer<
  typeof nominationSendResponseSchema
>;
export type AccessStatus = z.infer<typeof accessStatusSchema>;
export type NominationCorrectionRequest = z.infer<
  typeof nominationCorrectionRequestSchema
>;
export type NominationCancellationRequest = z.infer<
  typeof nominationCancellationRequestSchema
>;
export type NominationCorrectionResponse = z.infer<
  typeof nominationCorrectionResponseSchema
>;
export type NominationCancellationResponse = z.infer<
  typeof nominationCancellationResponseSchema
>;

export const ownershipConfirmationRequestSchema = z
  .object({
    nominationId: z.uuid(),
    code: z.string().regex(/^\d{6}$/),
    ownerMailboxAddressChoice: mailboxAddressChoiceSchema.optional(),
  })
  .strict();
export const ownershipConfirmationResponseSchema = z.object({
  ownerMailbox: mailboxSchema.optional(),
  confirmed: z.literal(true),
  workplaceId: z.uuid(),
});
export type OwnershipConfirmationRequest = z.infer<
  typeof ownershipConfirmationRequestSchema
>;
export type OwnershipConfirmationResponse = z.infer<
  typeof ownershipConfirmationResponseSchema
>;

export const humanAccessStatusSchema = z.object({
  storage: storageUsageSchema.optional(),
  accountId: z.uuid(),
  workplaceId: z.uuid(),
  role: z.enum(["owner", "admin", "member"]),
  workplaceState: z.literal("confirmed"),
  free: freeAllowanceSchema,
});
export type HumanAccessStatus = z.infer<typeof humanAccessStatusSchema>;

export const deletionProofSchema = z
  .object({ receiptProof: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export const deletionRequestResponseSchema = z
  .object({ challengeId: z.uuid(), expiresAt: z.iso.datetime() })
  .strict();
export const deletionConfirmationSchema = deletionProofSchema.extend({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
});
export const deletionStatusSchema = z
  .object({
    state: z.enum(["deleting", "deleted"]),
    initiatedAt: z.iso.datetime(),
    receiptExpiresAt: z.iso.datetime(),
  })
  .strict();
export type DeletionStatus = z.infer<typeof deletionStatusSchema>;

/** Current admitted account, independent of creator enrollment and private profiles. */
const accountIdentitySchema = z.object({
  mailbox: mailboxSchema.optional(),
  storage: storageUsageSchema.optional(),
  accountId: z.uuid(),
  workplaceId: z.uuid(),
  kind: z.enum(["agent", "human"]),
  role: z.enum(["owner", "admin", "member"]),
  state: z.literal("active"),
});
export const accountAccessStatusSchema = z.discriminatedUnion(
  "workplaceState",
  [
    accountIdentitySchema.extend({
      workplaceState: z.literal("unconfirmed"),
      cleanupAt: z.iso.datetime(),
      cleanupWarning: z.object({ cleanupAt: z.iso.datetime() }).nullable(),
      starter: accessStatusSchema.shape.starter,
      free: z.null(),
    }),
    accountIdentitySchema.extend({
      workplaceState: z.literal("confirmed"),
      cleanupAt: z.null(),
      cleanupWarning: z.null(),
      starter: z.null(),
      free: freeAllowanceSchema,
    }),
  ],
);
export type AccountAccessStatus = z.infer<typeof accountAccessStatusSchema>;

export const ownerEmailReceiptSchema = z
  .object({
    receiptProof: z
      .string()
      .length(43)
      .regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export const ownerEmailBeginSchema = ownerEmailReceiptSchema.extend({
  newEmail: signupRequestSchema.shape.nominatedEmail,
});
export const ownerEmailOperationReferenceSchema =
  ownerEmailReceiptSchema.extend({ operationId: z.uuid() });
export const ownerEmailCodeSchema = ownerEmailOperationReferenceSchema.extend({
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  code: z
    .string()
    .length(6)
    .regex(/^[0-9]{6}$/),
});
export const ownerEmailResendSchema = ownerEmailOperationReferenceSchema.extend(
  { generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) },
);
export const ownerEmailOperationSchema = z
  .object({
    operationId: z.uuid(),
    state: z.enum([
      "awaiting_current",
      "awaiting_new",
      "completed",
      "canceled",
      "expired",
    ]),
    generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    receiptExpiresAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
  })
  .strict();
export const ownerEmailStatusSchema = z
  .object({ operation: ownerEmailOperationSchema.nullable() })
  .strict();
export type OwnerEmailOperation = z.infer<typeof ownerEmailOperationSchema>;
export type OwnerEmailBegin = z.infer<typeof ownerEmailBeginSchema>;
export type OwnerEmailCode = z.infer<typeof ownerEmailCodeSchema>;
export type OwnerEmailResend = z.infer<typeof ownerEmailResendSchema>;
export type OwnerEmailOperationReference = z.infer<
  typeof ownerEmailOperationReferenceSchema
>;
