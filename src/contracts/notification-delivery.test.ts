import { expect, test } from "vitest";
import {
  notificationEndpointInspectionSchema,
  notificationEndpointListSchema,
  notificationEndpointRegisterRequestSchema,
  notificationEndpointRegistrationSchema,
  notificationEndpointSchema,
  notificationEndpointTestAcceptanceSchema,
  notificationProfileSchema,
  notificationPushSchema,
} from "./notification-delivery.js";
const accountId = "00000000-0000-4000-8000-000000000001";
const endpoint = {
  id: accountId,
  accountId,
  url: "https://receiver.example/hook/private-path",
  profile: { kind: "standard" },
  createdBy: accountId,
  createdAt: "2026-10-08T00:00:00.000Z",
  disabledAt: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
};
const status = {
  position: `np1.${accountId}.42`,
  unreadCount: 0,
  oldestUnreadAt: null,
};

test("registration requires a token only for bearer profiles and rejects injection", () => {
  for (const profile of [
    { kind: "standard" },
    { kind: "bearer" },
    { kind: "openclaw", agentId: "main" },
    { kind: "claude-routine" },
  ]) {
    const input = {
      url: endpoint.url,
      profile,
      ...(profile.kind === "standard" ? {} : { token: "abc_-./~+==" }),
    };
    expect(
      notificationEndpointRegisterRequestSchema.safeParse(input).success,
    ).toBe(true);
    expect(
      notificationEndpointRegisterRequestSchema.safeParse({
        ...input,
        accountId,
      }).success,
    ).toBe(true);
    expect(
      notificationEndpointRegisterRequestSchema.safeParse({
        ...input,
        token: profile.kind === "standard" ? "unexpected" : undefined,
      }).success,
    ).toBe(false);
  }
  for (const value of [
    "",
    "=",
    "a=b",
    "a b",
    "a\r\nX-Header:b",
    "é",
    "a".repeat(4097),
  ]) {
    expect(
      notificationEndpointRegisterRequestSchema.safeParse({
        url: endpoint.url,
        profile: { kind: "bearer" },
        token: value,
      }).success,
    ).toBe(false);
  }
  for (const extra of [
    { secret: "private" },
    { headers: {} },
    { prompt: "custom" },
  ])
    expect(
      notificationEndpointRegisterRequestSchema.safeParse({
        url: endpoint.url,
        profile: endpoint.profile,
        ...extra,
      }).success,
    ).toBe(false);
});

test("only Standard registration can expose a secret; management is secret-free", () => {
  const secret = `whsec_${"A".repeat(43)}=`;
  expect(notificationEndpointSchema.safeParse(endpoint).success).toBe(true);
  expect(
    notificationEndpointRegistrationSchema.safeParse({ endpoint, secret })
      .success,
  ).toBe(true);
  expect(
    notificationEndpointRegistrationSchema.safeParse({ endpoint }).success,
  ).toBe(false);
  for (const extra of [
    { secret },
    { token: "private" },
    { ciphertext: "private" },
    { lastError: "raw receiver response" },
    { lastAttemptAt: "invalid" },
    { responseHeaders: {} },
  ])
    expect(
      notificationEndpointSchema.safeParse({ ...endpoint, ...extra }).success,
    ).toBe(false);
  for (const profile of [
    { kind: "bearer" },
    { kind: "openclaw", agentId: "main" },
    { kind: "claude-routine" },
  ]) {
    const registered = { endpoint: { ...endpoint, profile } };
    expect(
      notificationEndpointRegistrationSchema.safeParse(registered).success,
    ).toBe(true);
    expect(
      notificationEndpointRegistrationSchema.safeParse({
        ...registered,
        secret,
      }).success,
    ).toBe(false);
    expect(
      notificationEndpointRegistrationSchema.safeParse({
        ...registered,
        token: "private",
      }).success,
    ).toBe(false);
  }
});

test("endpoint list and inspection validate account scope and bounded lists", () => {
  expect(
    notificationEndpointInspectionSchema.safeParse({ endpoint, status })
      .success,
  ).toBe(true);
  expect(
    notificationEndpointListSchema.safeParse({ endpoints: [], status }).success,
  ).toBe(true);
  expect(
    notificationEndpointListSchema.safeParse({ endpoints: [endpoint], status })
      .success,
  ).toBe(true);
  const foreign = {
    ...endpoint,
    accountId: "00000000-0000-4000-8000-000000000002",
  };
  expect(
    notificationEndpointInspectionSchema.safeParse({
      endpoint: foreign,
      status,
    }).success,
  ).toBe(false);
  for (const endpoints of [
    [foreign],
    [endpoint, endpoint],
    Array(4).fill(endpoint),
  ])
    expect(
      notificationEndpointListSchema.safeParse({ endpoints, status }).success,
    ).toBe(false);
  expect(
    notificationEndpointTestAcceptanceSchema.safeParse({
      accepted: true,
      testId: accountId,
    }).success,
  ).toBe(true);
  expect(
    notificationEndpointTestAcceptanceSchema.safeParse({
      accepted: true,
      testId: accountId,
      response: "private",
    }).success,
  ).toBe(false);
});
test("profiles accept only fixed options, including an explicit OpenClaw agent", () => {
  for (const kind of ["standard", "bearer", "claude-routine"])
    expect(notificationProfileSchema.safeParse({ kind }).success).toBe(true);
  expect(
    notificationProfileSchema.safeParse({ kind: "openclaw", agentId: "main" })
      .success,
  ).toBe(true);
  for (const profile of [
    { kind: "unknown" },
    { kind: "openclaw" },
    { kind: "openclaw", agentId: "\n" },
    { kind: "openclaw", agentId: "a".repeat(129) },
    { kind: "bearer", token: "private" },
    { kind: "standard", prompt: "custom text" },
  ])
    expect(notificationProfileSchema.safeParse(profile).success).toBe(false);
});
test("push schemas bind positions to the account and cannot carry Mail content", () => {
  const input = {
    type: "notifications.wake",
    id: accountId,
    workplaceId: accountId,
    accountId,
    position: `np1.${accountId}.42`,
    unreadCount: 2,
    createdAt: "2026-10-08T00:00:00.000Z",
    test: false,
  };
  expect(notificationPushSchema.safeParse(input).success).toBe(true);
  expect(
    notificationPushSchema.safeParse({ ...input, unreadCount: 0, test: true })
      .success,
  ).toBe(true);
  for (const changed of [
    { ...input, accountId: "00000000-0000-4000-8000-000000000002" },
    { ...input, subject: "Mail content" },
    { ...input, unreadCount: -1 },
    { ...input, token: "private" },
    { ...input, createdAt: "invalid" },
  ])
    expect(notificationPushSchema.safeParse(changed).success).toBe(false);
});
