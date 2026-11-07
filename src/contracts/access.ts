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

export const ownershipPreviewRequestSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export const ownershipPreviewResponseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("confirmed") }).strict(),
  z
    .object({
      state: z.literal("pending"),
      workplaceId: z.uuid(),
      workplaceName: z.string(),
      agentId: z.uuid(),
      agentName: z.string(),
      nominatedEmail: z.email(),
      expiresAt: z.iso.datetime(),
    })
    .strict(),
]);
export const ownershipConfirmationRequestSchema =
  ownershipPreviewRequestSchema.extend({
    acceptOwnership: z.literal(true),
    ownerMailboxAddressChoice: mailboxAddressChoiceSchema.optional(),
  });
export const ownershipConfirmationResponseSchema = z.discriminatedUnion(
  "state",
  [
    z.object({ state: z.literal("confirmed") }).strict(),
    z
      .object({
        state: z.literal("accepted"),
        workplaceId: z.uuid(),
        ownerMailbox: mailboxSchema,
      })
      .strict(),
  ],
);
export type OwnershipPreviewRequest = z.infer<
  typeof ownershipPreviewRequestSchema
>;
export type OwnershipPreviewResponse = z.infer<
  typeof ownershipPreviewResponseSchema
>;
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
export const confirmationDeliverySchema = z
  .enum(["pending", "accepted", "failed", "uncertain"])
  .nullable();
export const deletionStatusRequestSchema = deletionProofSchema.extend({
  includeConfirmation: z.boolean().optional(),
});
export const deletionStatusViewSchema = deletionStatusSchema.extend({
  confirmation: confirmationDeliverySchema,
});
export type DeletionStatusView = z.infer<typeof deletionStatusViewSchema>;

/** Current admitted account, independent of creator enrollment and private profiles. */
const accountIdentitySchema = z.object({
  /** The key authenticating this request; absent for grants and human sessions. */
  currentKeyId: z.uuid().optional(),
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
export const ownerEmailCurrentSchema = z
  .object({
    operation: ownerEmailOperationSchema
      .extend({
        confirmation: confirmationDeliverySchema,
        newEmail: signupRequestSchema.shape.nominatedEmail.nullable(),
        receiptProof: ownerEmailReceiptSchema.shape.receiptProof.nullable(),
      })
      .nullable(),
  })
  .strict();
export type OwnerEmailCurrent = z.infer<typeof ownerEmailCurrentSchema>;
export const ownerEmailStatusRequestSchema = ownerEmailReceiptSchema.extend({
  includeConfirmation: z.boolean().optional(),
});
export const ownerEmailOperationViewSchema = ownerEmailOperationSchema.extend({
  confirmation: confirmationDeliverySchema,
});
export const ownerEmailStatusViewSchema = z
  .object({
    operation: ownerEmailOperationViewSchema.nullable(),
  })
  .strict();
export type OwnerEmailOperationView = z.infer<
  typeof ownerEmailOperationViewSchema
>;
export type OwnerEmailOperation = z.infer<typeof ownerEmailOperationSchema>;
export type OwnerEmailBegin = z.infer<typeof ownerEmailBeginSchema>;
export type OwnerEmailCode = z.infer<typeof ownerEmailCodeSchema>;
export type OwnerEmailResend = z.infer<typeof ownerEmailResendSchema>;
export type OwnerEmailOperationReference = z.infer<
  typeof ownerEmailOperationReferenceSchema
>;

/** A dashboard continuation is local data carried through admission. Google's
 * redirect URI and the dashboard callback URL are always API configuration. */
export const googleDashboardReturnSchema = z
  .string()
  .max(3000)
  .refine((value) => {
    const origin = "https://dashboard.invalid";
    if (!value.startsWith("/") || !URL.canParse(value, origin)) return false;
    const url = new URL(value, origin);
    if (
      url.origin !== origin ||
      url.pathname !== "/" ||
      value !== url.pathname + url.search + url.hash
    )
      return false;
    if (url.hash) return value === "/#owner-email";
    const keys = [...url.searchParams.keys()];
    if (!keys.length) return value === "/";
    if (keys.length === 1 && keys[0] === "next") {
      const next = url.searchParams.get("next")!;
      if (
        [
          // Removed, but a sign-in started before the change may still name it;
          // the dashboard redirects it to Accounts.
          "/overview",
          "/accounts",
          "/mail",
          "/files",
          "/chat",
          "/settings",
          "/settings/workplace",
          "/settings/billing",
          "/settings/usage",
          "/settings/account",
        ].includes(next)
      )
        return true;
      if (
        !next.startsWith("/") ||
        next.startsWith("//") ||
        next.includes("\\") ||
        !URL.canParse(next, origin)
      )
        return false;
      const target = new URL(next, origin);
      return (
        target.origin === origin &&
        !target.hash &&
        ["/oauth/sign-in", "/oauth/device"].includes(target.pathname)
      );
    }
    const receipt = url.searchParams.get("billing_purchase"),
      outcome = url.searchParams.get("billing_return");
    return (
      keys.length === new Set(keys).size &&
      keys.every((k) => k === "billing_purchase" || k === "billing_return") &&
      !!receipt &&
      z.uuidv4().safeParse(receipt).success &&
      (!outcome || outcome === "success" || outcome === "cancel")
    );
  });
export const googleEntryRequestSchema = z.union([
  z
    .object({
      action: z.literal("start"),
      dashboardReturn: googleDashboardReturnSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.enum([
        "status",
        "send",
        "login",
        "link",
        "create",
        "disconnect",
        "cancel",
      ]),
    })
    .strict(),
  z
    .object({ action: z.literal("verify"), code: z.string().regex(/^\d{6}$/) })
    .strict(),
]);
export const googleConnectionRequestSchema = z
  .object({ action: z.enum(["connection", "disconnect-start"]) })
  .strict();
export type GoogleEntryRequest =
  | z.infer<typeof googleEntryRequestSchema>
  | z.infer<typeof googleConnectionRequestSchema>;
export const googleEntryResponseSchema = z.union([
  z
    .object({
      phase: z.literal("redirect"),
      url: z.url().refine((value) => {
        if (!URL.canParse(value)) return false;
        const url = new URL(value);
        return (
          url.origin === "https://accounts.google.com" &&
          url.pathname === "/o/oauth2/v2/auth" &&
          !url.username &&
          !url.password
        );
      }),
    })
    .strict(),
  z
    .object({
      phase: z.enum([
        "code",
        "login",
        "link",
        "create",
        "disconnect",
        "unavailable",
      ]),
      email: z.email(),
      dashboardReturn: googleDashboardReturnSchema,
    })
    .strict(),
  z.object({ phase: z.literal("connection"), linked: z.boolean() }).strict(),
  z
    .object({
      phase: z.literal("done"),
      dashboardReturn: googleDashboardReturnSchema,
    })
    .strict(),
]);
export type GoogleEntryResponse = z.infer<typeof googleEntryResponseSchema>;
export const humanNameSetupRequestSchema = z
  .object({ action: z.enum(["read", "skip"]) })
  .strict();
export const humanNameSetupResponseSchema = z
  .object({ pending: z.boolean(), suggestion: z.string().max(100).nullable() })
  .strict();
