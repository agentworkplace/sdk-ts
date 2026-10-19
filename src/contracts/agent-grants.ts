import { z } from "zod";

/** One scope per MCP tool group; no scope implies another. */
export const agentGrantScopes = [
  "account",
  "workplace",
  "invitations",
  "mail",
  "files",
  "notifications",
  "billing",
  "feedback",
  "chat",
] as const;
export const agentGrantScopeSchema = z.enum(agentGrantScopes);
export type AgentGrantScope = z.infer<typeof agentGrantScopeSchema>;
/** Scopes that change who belongs to the workplace or what they may do. */
export const administrativeAgentGrantScopes = [
  "invitations",
  "workplace",
  "billing",
] as const satisfies readonly AgentGrantScope[];

const grantScopesSchema = z
  .array(agentGrantScopeSchema)
  .min(1)
  .max(agentGrantScopes.length)
  .refine((scopes) => new Set(scopes).size === scopes.length);

export const agentGrantMetadataSchema = z
  .object({
    id: z.uuid(),
    clientName: z.string().min(1).max(100),
    clientHost: z.string().min(1).max(256),
    method: z.enum(["authorization_code", "device"]),
    scopes: grantScopesSchema,
    authorizedBy: z
      .object({ id: z.uuid(), name: z.string().nullable() })
      .strict()
      .nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const agentGrantListSchema = z
  .object({ grants: z.array(agentGrantMetadataSchema) })
  .strict();
export const agentGrantIdSchema = z
  .object({ accountId: z.uuid(), grantId: z.uuid() })
  .strict();
export const agentGrantRevokedSchema = z
  .object({ revoked: z.literal(true) })
  .strict();
export type AgentGrantMetadata = z.infer<typeof agentGrantMetadataSchema>;
export type AgentGrantList = z.infer<typeof agentGrantListSchema>;

const consentClientSchema = z
  .object({
    name: z.string().min(1).max(100),
    host: z.string().min(1).max(256),
  })
  .strict();
const consentAgentSchema = z
  .object({ id: z.uuid(), name: z.string().nullable() })
  .strict();
const consentWorkplaceSchema = z
  .object({ id: z.uuid(), name: z.string() })
  .strict();

/** The signed authorization query the API issued; verified only by the API. */
export const oauthConsentQuerySchema = z
  .object({ query: z.string().min(1).max(8192) })
  .strict();
export const oauthConsentDetailsSchema = z
  .object({
    client: consentClientSchema,
    redirect: z
      .object({ host: z.string().min(1), loopback: z.boolean() })
      .strict(),
    scopes: grantScopesSchema,
    workplace: consentWorkplaceSchema,
    agents: z.array(consentAgentSchema),
  })
  .strict();
export const oauthConsentDecisionSchema = z.discriminatedUnion("accept", [
  oauthConsentQuerySchema.extend({
    accept: z.literal(true),
    accountId: z.uuid(),
    scopes: grantScopesSchema,
  }),
  oauthConsentQuerySchema.extend({ accept: z.literal(false) }),
]);
export const oauthConsentResultSchema = z
  .object({ redirectTo: z.url() })
  .strict();
export type OAuthConsentDetails = z.infer<typeof oauthConsentDetailsSchema>;
export type OAuthConsentDecision = z.infer<typeof oauthConsentDecisionSchema>;

/** User codes are eight characters; separators and case are ignored. */
export const oauthUserCodeSchema = z
  .string()
  .max(32)
  .transform((value) => value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())
  .pipe(z.string().length(8));
export const oauthDeviceLookupSchema = z
  .object({ userCode: oauthUserCodeSchema })
  .strict();
export const oauthDeviceDetailsSchema = z
  .object({
    client: consentClientSchema,
    scopes: grantScopesSchema,
    workplace: consentWorkplaceSchema,
    agents: z.array(consentAgentSchema),
  })
  .strict();
export const oauthDeviceDecisionSchema = z.discriminatedUnion("accept", [
  oauthDeviceLookupSchema.extend({
    accept: z.literal(true),
    accountId: z.uuid(),
    scopes: grantScopesSchema,
  }),
  oauthDeviceLookupSchema.extend({ accept: z.literal(false) }),
]);
export const oauthDeviceResultSchema = z
  .object({ approved: z.boolean() })
  .strict();
export type OAuthDeviceDetails = z.infer<typeof oauthDeviceDetailsSchema>;
export type OAuthDeviceDecision = z.infer<typeof oauthDeviceDecisionSchema>;
