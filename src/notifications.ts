import { notificationPositionSchema } from "./contracts/notifications.js";

/** Compare two opaque positions from the same account without numeric precision loss. */
export function compareNotificationPositions(
  left: string,
  right: string,
): -1 | 0 | 1 {
  const a = notificationPositionSchema.safeParse(left);
  const b = notificationPositionSchema.safeParse(right);
  if (!a.success || !b.success)
    throw new TypeError("Invalid notification position");
  const [, accountA, sequenceA] = a.data.split(".");
  const [, accountB, sequenceB] = b.data.split(".");
  if (accountA !== accountB)
    throw new TypeError("Notification positions belong to different accounts");
  const x = BigInt(sequenceA!),
    y = BigInt(sequenceB!);
  return x < y ? -1 : x > y ? 1 : 0;
}
