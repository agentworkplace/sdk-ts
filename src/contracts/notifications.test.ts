import { expect, test } from "vitest";
import {
  notificationListRequestSchema,
  notificationPositionSchema,
  notificationReadRequestSchema,
  notificationSchema,
  notificationStatusSchema,
} from "./notifications.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const position = `np1.${accountId}.9007199254740993`;

test("positions preserve exact values beyond JavaScript's integer range", () => {
  expect(notificationPositionSchema.parse(position)).toBe(position);
  expect(
    notificationPositionSchema.parse(`np1.${accountId}.9223372036854775807`),
  ).toBe(`np1.${accountId}.9223372036854775807`);
  expect(notificationPositionSchema.parse(`np1.${accountId}.0`)).toBe(
    `np1.${accountId}.0`,
  );
});

test.each(["-1", "01", "1.0", "1e3", "9223372036854775808", "", " 1", "1\n"])(
  "rejects noncanonical or out-of-range sequence %j",
  (sequence) =>
    expect(
      notificationPositionSchema.safeParse(`np1.${accountId}.${sequence}`)
        .success,
    ).toBe(false),
);

test.each([1, null, "1", "np1.invalid.1", `np2.${accountId}.1`])(
  "rejects positions without the versioned account scope %j",
  (value) =>
    expect(notificationPositionSchema.safeParse(value).success).toBe(false),
);

test("lists default to bounded unread pages and reject unknown query keys", () => {
  expect(notificationListRequestSchema.parse({})).toEqual({
    filter: "unread",
    limit: 50,
  });
  expect(
    notificationListRequestSchema.parse({
      filter: "all",
      limit: "100",
      accountId,
    }),
  ).toEqual({ filter: "all", limit: 100, accountId });
  for (const value of [
    { limit: 101 },
    { limit: 0 },
    { limit: 1.5 },
    { after: "" },
    { filter: "read" },
    { offset: 50 },
  ]) {
    expect(notificationListRequestSchema.safeParse(value).success).toBe(false);
  }
});

test("acknowledgements require an observed position and cannot target another account", () => {
  expect(notificationReadRequestSchema.parse({ through: position })).toEqual({
    through: position,
  });
  expect(notificationReadRequestSchema.safeParse({}).success).toBe(false);
  expect(
    notificationReadRequestSchema.safeParse({ through: position, accountId })
      .success,
  ).toBe(false);
});

test("notification wire data carries fixed reasons and identifiers, never source content", () => {
  const notification = {
    id: accountId,
    subject: { kind: "mail_message", mailboxId: accountId, id: accountId },
    reason: "mail_received",
    position,
    updatedAt: "2026-10-07T12:00:00.000Z",
    read: false,
  };
  expect(notificationSchema.safeParse(notification).success).toBe(true);
  for (const value of [
    { ...notification, reason: "provider error text" },
    { ...notification, text: "private message" },
    {
      ...notification,
      subject: { ...notification.subject, text: "private message" },
    },
    { ...notification, omissionCount: 4 },
  ])
    expect(notificationSchema.safeParse(value).success).toBe(false);
});

test("status carries a lossless position, bounded count, and nullable oldest time", () => {
  expect(
    notificationStatusSchema.parse({
      position,
      unreadCount: 0,
      oldestUnreadAt: null,
    }),
  ).toEqual({ position, unreadCount: 0, oldestUnreadAt: null });
  expect(
    notificationStatusSchema.safeParse({
      position,
      unreadCount: -1,
      oldestUnreadAt: null,
    }).success,
  ).toBe(false);
});
