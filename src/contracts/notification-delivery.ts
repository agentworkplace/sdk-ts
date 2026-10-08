import { z } from "zod";
import {
  notificationPositionSchema,
  notificationStatusSchema,
} from "./notifications.js";

export const notificationProfileSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("standard") }).strict(),
  z.object({ kind: z.literal("bearer") }).strict(),
  z
    .object({
      kind: z.literal("openclaw"),
      agentId: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
    })
    .strict(),
  z.object({ kind: z.literal("claude-routine") }).strict(),
]);
export type NotificationProfile = z.infer<typeof notificationProfileSchema>;

export const notificationDeliveryErrorCategorySchema = z.enum([
  "invalid_target",
  "connection",
  "tls",
  "timeout",
  "rejected",
  "receiver_error",
  "rate_limited",
]);
export type NotificationDeliveryErrorCategory = z.infer<
  typeof notificationDeliveryErrorCategorySchema
>;

// Syntax/size only. Public DNS, own-host denial and TLS are backend concerns.
const endpointUrl = z.string().min(1).max(2048);
const token = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[A-Za-z0-9._~+/-]+=*$/);

export const notificationEndpointRegisterRequestSchema = z
  .object({
    accountId: z.uuid().optional(),
    url: endpointUrl,
    profile: notificationProfileSchema,
    token: token.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.profile.kind === "standard"
        ? value.token === undefined
        : value.token !== undefined,
    "Standard generates its own secret; other profiles require a token",
  );
export type NotificationEndpointRegisterRequest = z.infer<
  typeof notificationEndpointRegisterRequestSchema
>;

/** Authorized management projection. The URL is sensitive; never log it. */
export const notificationEndpointSchema = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    url: endpointUrl,
    profile: notificationProfileSchema,
    createdBy: z.uuid(),
    createdAt: z.iso.datetime(),
    disabledAt: z.iso.datetime().nullable(),
    lastAttemptAt: z.iso.datetime().nullable(),
    lastSuccessAt: z.iso.datetime().nullable(),
    lastError: notificationDeliveryErrorCategorySchema.nullable(),
  })
  .strict();
export type NotificationEndpoint = z.infer<typeof notificationEndpointSchema>;

/** Only registration may disclose the newly generated Standard secret. */
export const notificationEndpointRegistrationSchema = z
  .object({
    endpoint: notificationEndpointSchema,
    secret: z
      .string()
      .regex(/^whsec_[A-Za-z0-9+/]{43}=$/)
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.endpoint.profile.kind === "standard"
        ? value.secret !== undefined
        : value.secret === undefined,
    "Only Standard registration discloses a generated secret",
  );
export type NotificationEndpointRegistration = z.infer<
  typeof notificationEndpointRegistrationSchema
>;

export const notificationEndpointInspectionSchema = z
  .object({
    endpoint: notificationEndpointSchema,
    status: notificationStatusSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.status.position.startsWith(`np1.${value.endpoint.accountId}.`),
    "Status belongs to another account",
  );
export type NotificationEndpointInspection = z.infer<
  typeof notificationEndpointInspectionSchema
>;

export const notificationEndpointListSchema = z
  .object({
    endpoints: z.array(notificationEndpointSchema).max(3),
    status: notificationStatusSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.endpoints.every((endpoint) =>
        value.status.position.startsWith(`np1.${endpoint.accountId}.`),
      ) &&
      new Set(value.endpoints.map((endpoint) => endpoint.id)).size ===
        value.endpoints.length,
    "Endpoints must be distinct and belong to the status account",
  );
export type NotificationEndpointList = z.infer<
  typeof notificationEndpointListSchema
>;

/** A durable test request was accepted, not necessarily delivered. */
export const notificationEndpointTestAcceptanceSchema = z
  .object({ accepted: z.literal(true), testId: z.uuid() })
  .strict();
export type NotificationEndpointTestAcceptance = z.infer<
  typeof notificationEndpointTestAcceptanceSchema
>;

/** Fixed ID-only payload. The frozen body and ID survive every automatic retry. */
export const notificationPushSchema = z
  .object({
    type: z.literal("notifications.wake"),
    id: z.uuid(),
    workplaceId: z.uuid(),
    accountId: z.uuid(),
    position: notificationPositionSchema,
    unreadCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    createdAt: z.iso.datetime(),
    test: z.boolean(),
  })
  .strict()
  .refine(
    (value) => value.position.startsWith(`np1.${value.accountId}.`),
    "Position belongs to another account",
  );
export type NotificationPush = z.infer<typeof notificationPushSchema>;
