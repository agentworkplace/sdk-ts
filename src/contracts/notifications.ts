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
  z
    .object({ kind: z.literal("mail_send"), mailboxId: z.uuid(), id: z.uuid() })
    .strict(),
]);
export type NotificationSubject = z.infer<typeof notificationSubjectSchema>;

export const notificationSchema = z
  .object({
    id: z.uuid(),
    subject: notificationSubjectSchema,
    reason: notificationReasonSchema,
    position: notificationPositionSchema,
    updatedAt: z.iso.datetime(),
    read: z.boolean(),
  })
  .strict();
export type Notification = z.infer<typeof notificationSchema>;

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
