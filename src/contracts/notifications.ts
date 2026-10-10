import { z } from "zod";

/** Account-scoped, lossless PostgreSQL bigint position. Clients treat it as opaque. */
export const notificationPositionSchema = z
  .string()
  .max(60)
  .regex(
    /^np1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(0|[1-9][0-9]{0,18})$/,
  )
  .refine((value) => {
    const sequence = value.split(".")[2];
    return sequence !== undefined && /^(0|[1-9][0-9]{0,18})$/.test(sequence)
      ? BigInt(sequence) <= 9223372036854775807n
      : false;
  });
export type NotificationPosition = z.infer<typeof notificationPositionSchema>;

export const notificationReasonSchema = z.enum([
  "mail_received",
  "mail_omitted",
  "mail_send_failed",
  "mail_send_canceled",
  "mail_send_uncertain",
  "mail_send_accepted",
  "mail_send_bounced",
  "chat_added",
  "chat_message",
]);
export type NotificationReason = z.infer<typeof notificationReasonSchema>;

export const notificationSubjectSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("mail_message"),
      mailboxId: z.uuid(),
      id: z.uuid(),
    })
    .strict(),
  z.object({ kind: z.literal("mailbox"), id: z.uuid() }).strict(),
  z.object({ kind: z.literal("conversation"), id: z.uuid() }).strict(),
  z
    .object({ kind: z.literal("mail_send"), mailboxId: z.uuid(), id: z.uuid() })
    .strict(),
]);
export type NotificationSubject = z.infer<typeof notificationSubjectSchema>;

function validSource(value: {
  subject: NotificationSubject;
  reason: NotificationReason;
}) {
  if (value.subject.kind === "mail_message")
    return value.reason === "mail_received";
  if (value.subject.kind === "mailbox") return value.reason === "mail_omitted";
  if (value.subject.kind === "conversation")
    return value.reason === "chat_added" || value.reason === "chat_message";
  return [
    "mail_send_failed",
    "mail_send_canceled",
    "mail_send_uncertain",
    "mail_send_accepted",
    "mail_send_bounced",
  ].includes(value.reason);
}

export const notificationSchema = z
  .object({
    id: z.uuid(),
    subject: notificationSubjectSchema,
    reason: notificationReasonSchema,
    position: notificationPositionSchema,
    updatedAt: z.iso.datetime(),
    read: z.boolean(),
  })
  .strict()
  .refine(validSource);
export type Notification = z.infer<typeof notificationSchema>;

// Consumers can safely list newer sources, while writers retain the strict
// source contract above. Discard unknown source fields rather than projecting
// unvalidated content, URLs, or resource identifiers into public client output.
const sourceCode = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);
const clientSubjectSchema = z
  .object({ kind: sourceCode })
  .passthrough()
  .refine(
    (value) =>
      !notificationSubjectSchema.options.some(
        (option) => option.shape.kind.safeParse(value.kind).success,
      ) || notificationSubjectSchema.safeParse(value).success,
  )
  .transform((value) => {
    const known = notificationSubjectSchema.safeParse(value);
    return known.success ? known.data : { kind: "unknown" as const };
  });
const clientReasonSchema = sourceCode.transform((value) => {
  const known = notificationReasonSchema.safeParse(value);
  return known.success ? known.data : ("unknown" as const);
});
export const clientNotificationSchema = z
  .object({
    ...notificationSchema.shape,
    subject: clientSubjectSchema,
    reason: clientReasonSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.subject.kind === "unknown" ||
      value.reason === "unknown" ||
      validSource({ subject: value.subject, reason: value.reason }),
  );
export type ClientNotification = z.infer<typeof clientNotificationSchema>;
export type ClientNotificationSubject = ClientNotification["subject"];
export type ClientNotificationReason = ClientNotification["reason"];

export const notificationListRequestSchema = z
  .object({
    accountId: z.uuid().optional(),
    filter: z.enum(["unread", "all"]).default("unread"),
    after: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type NotificationListRequest = z.infer<
  typeof notificationListRequestSchema
>;
export const notificationListSchema = z
  .object({
    notifications: z.array(notificationSchema).max(100),
    nextCursor: z.string().min(1).max(512).nullable(),
  })
  .strict();
export type NotificationList = z.infer<typeof notificationListSchema>;
export const clientNotificationListSchema = notificationListSchema.extend({
  notifications: z.array(clientNotificationSchema).max(100),
});
export type ClientNotificationList = z.infer<
  typeof clientNotificationListSchema
>;

export const notificationStatusRequestSchema = z
  .object({
    accountId: z.uuid().optional(),
  })
  .strict();
export type NotificationStatusRequest = z.infer<
  typeof notificationStatusRequestSchema
>;
export const notificationStatusSchema = z
  .object({
    position: notificationPositionSchema,
    unreadCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    oldestUnreadAt: z.iso.datetime().nullable(),
  })
  .strict();
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

/** Both read operations target the authenticated account, never an administrator's target. */
export const notificationReadRequestSchema = z
  .object({
    through: notificationPositionSchema,
  })
  .strict();
export type NotificationReadRequest = z.infer<
  typeof notificationReadRequestSchema
>;
export const notificationAcknowledgementSchema = z
  .object({
    acknowledged: z.literal(true),
  })
  .strict();
export type NotificationAcknowledgement = z.infer<
  typeof notificationAcknowledgementSchema
>;
