import {
  mailCheckpointRequestSchema,
  mailMessageReadRequestSchema,
  type MailAttachmentList,
  type MailChanges,
  type MailCheckpoint,
  type MailMessage,
  type MailMessageList,
  type MailThread,
  type MailPreparationList,
  type MailOmissionList,
} from "./contracts/mail.js";
import { AgentWorkplaceError } from "./errors.js";

export type MailExportScope =
  | { kind: "mailbox" }
  | { kind: "message"; messageId: string }
  | { kind: "thread"; messageId: string };
export interface MailExportRequest {
  mailboxId: string;
  scope: MailExportScope;
}
/** A fresh store for one traversal. Keys are opaque, untrusted strings, not
 * filesystem paths. Large exporters should persist this index instead of
 * accumulating all message IDs and pagination cursors in memory. */
export interface MailExportVisitStore {
  addIfNew(key: string): Promise<boolean>;
}
export type MailExportItem =
  | {
      kind: "start";
      mailboxId: string;
      scope: MailExportScope;
      checkpoint: string;
    }
  | { kind: "message"; message: MailMessage }
  | { kind: "attachments"; page: MailAttachmentList }
  | { kind: "preparations"; page: MailPreparationList }
  | { kind: "omissions"; page: MailOmissionList }
  | {
      kind: "thread";
      groupId: string;
      revision: string;
      association: "historical_hints";
    }
  | {
      kind: "issue";
      messageId: string;
      code: "not_found" | "message_revisited";
    }
  | { kind: "incomplete"; reason: "thread_indexing" }
  | {
      kind: "complete";
      coverage: "non_snapshot";
      mailboxChanges: "observed" | "none_observed" | "unknown";
      messages: number;
      issues: number;
    };

interface Reads {
  checkpoint(): Promise<MailCheckpoint>;
  changes(cursor: string): Promise<MailChanges>;
  message(messageId: string): Promise<MailMessage>;
  page(view: "all" | "trash", after?: string): Promise<MailMessageList>;
  thread(messageId: string, after?: string): Promise<MailThread>;
  attachments(messageId: string, after?: number): Promise<MailAttachmentList>;
  preparations(after?: string): Promise<MailPreparationList>;
  omissions(after?: string): Promise<MailOmissionList>;
}
const malformed = () =>
  new AgentWorkplaceError("Invalid Mail export response", {
    status: 0,
    code: "invalid_response",
  });
const missing = (error: unknown) =>
  error instanceof AgentWorkplaceError && error.code === "not_found";

/** Bounded current-state inventory, not original MIME or a mailbox snapshot.
 * Yields exact retained representations and attachment metadata one page at a
 * time. Consumers download retained attachments separately through their issued
 * grants and preserve pending/omitted/unknown representations as metadata.
 * Thread indexing pauses this traversal; start again with a fresh visit store.
 * Authorization loss and thread conflicts propagate rather than hiding gaps. */
export async function* walkMail(
  input: MailExportRequest,
  reads: Reads,
  visits: MailExportVisitStore,
): AsyncGenerator<MailExportItem> {
  const parsed = mailCheckpointRequestSchema.safeParse({
    mailboxId: input.mailboxId,
  });
  if (!parsed.success || !visits || typeof visits.addIfNew !== "function")
    throw new TypeError("Invalid Mail export request");
  const mailboxId = parsed.data.mailboxId.toLowerCase();
  const kind = input.scope?.kind;
  if (kind !== "mailbox" && kind !== "message" && kind !== "thread")
    throw new TypeError("Invalid Mail export scope");
  let scope: MailExportScope = { kind: "mailbox" };
  if (input.scope.kind !== "mailbox") {
    const ref = mailMessageReadRequestSchema.safeParse({
      mailboxId,
      messageId: input.scope.messageId,
    });
    if (!ref.success) throw new TypeError("Invalid Mail export message");
    scope = {
      kind: input.scope.kind,
      messageId: ref.data.messageId.toLowerCase(),
    };
  }
  const checkpoint = (await reads.checkpoint()).checkpoint;
  // Internal identity is copied before yielding caller-mutable metadata.
  const seed = scope.kind === "mailbox" ? undefined : scope.messageId;
  yield { kind: "start", mailboxId, scope: { ...scope }, checkpoint };
  let messages = 0,
    issues = 0;
  async function* attachments(
    messageId: string,
  ): AsyncGenerator<MailExportItem> {
    if (!(await visits.addIfNew(JSON.stringify(["attachments", messageId]))))
      return;
    try {
      let after: number | undefined;
      for (;;) {
        const page = await reads.attachments(messageId, after);
        if (
          page.messageId !== messageId ||
          (page.nextAfter !== null && page.nextAfter <= (after ?? -1))
        )
          throw malformed();
        const next = page.nextAfter;
        yield { kind: "attachments", page };
        if (next === null) break;
        after = next;
      }
    } catch (error) {
      if (!missing(error)) throw error;
      issues++;
      yield { kind: "issue", messageId, code: "not_found" };
    }
  }
  async function* message(messageId: string): AsyncGenerator<MailExportItem> {
    if (!(await visits.addIfNew(JSON.stringify(["message", messageId])))) {
      issues++;
      yield { kind: "issue", messageId, code: "message_revisited" };
      return;
    }
    try {
      const value = await reads.message(messageId);
      if (value.messageId !== messageId || value.mailboxId !== mailboxId)
        throw malformed();
      messages++;
      yield { kind: "message", message: value };
    } catch (error) {
      if (!missing(error)) throw error;
      issues++;
      yield { kind: "issue", messageId, code: "not_found" };
    }
    // Pending-only arrivals can expose preparation/parts without a body row.
    yield* attachments(messageId);
  }
  if (kind === "message") {
    yield* message(seed!);
  } else if (kind === "thread") {
    let after: string | undefined;
    let group: { id: string; revision: string } | undefined;
    for (;;) {
      if (
        !(await visits.addIfNew(
          JSON.stringify(["thread-page", seed, after ?? null]),
        ))
      )
        throw malformed();
      const page = await reads.thread(seed!, after);
      if (page.mailboxId !== mailboxId || page.seedMessageId !== seed)
        throw malformed();
      if (page.state === "indexing") {
        yield { kind: "incomplete", reason: "thread_indexing" };
        return;
      }
      if (
        group &&
        (group.id !== page.groupId || group.revision !== page.revision)
      )
        throw malformed();
      if (!group) {
        group = { id: page.groupId, revision: page.revision };
        yield {
          kind: "thread",
          groupId: group.id,
          revision: group.revision,
          association: "historical_hints",
        };
      }
      const next = page.nextCursor;
      const ids = page.messages.map((summary) => {
        if (summary.mailboxId !== mailboxId) throw malformed();
        return summary.messageId;
      });
      for (const id of ids) yield* message(id);
      if (next === null) break;
      after = next;
    }
  } else {
    for (const view of ["all", "trash"] as const) {
      let after: string | undefined;
      for (;;) {
        if (
          !(await visits.addIfNew(
            JSON.stringify(["message-page", view, after ?? null]),
          ))
        )
          throw malformed();
        const page = await reads.page(view, after);
        const next = page.nextCursor;
        const ids = page.messages.map((summary) => {
          if (summary.mailboxId !== mailboxId) throw malformed();
          return summary.messageId;
        });
        for (const id of ids) yield* message(id);
        if (next === null) break;
        after = next;
      }
    }
    let after: string | undefined;
    for (;;) {
      if (
        !(await visits.addIfNew(
          JSON.stringify(["preparation-page", after ?? null]),
        ))
      )
        throw malformed();
      const page = await reads.preparations(after);
      const next = page.nextCursor;
      const ids = page.preparations.map((preparation) => {
        if (preparation.mailboxId !== mailboxId) throw malformed();
        return preparation.messageId;
      });
      yield { kind: "preparations", page };
      for (const id of ids) yield* attachments(id);
      if (next === null) break;
      after = next;
    }
    after = undefined;
    for (;;) {
      if (
        !(await visits.addIfNew(
          JSON.stringify(["omission-page", after ?? null]),
        ))
      )
        throw malformed();
      const page = await reads.omissions(after);
      if (page.omissions.some((omission) => omission.mailboxId !== mailboxId))
        throw malformed();
      const next = page.nextCursor;
      yield { kind: "omissions", page };
      if (next === null) break;
      after = next;
    }
  }
  const changes = await reads.changes(checkpoint);
  yield {
    kind: "complete",
    coverage: "non_snapshot",
    mailboxChanges:
      changes.state === "gap"
        ? "unknown"
        : changes.items.length
          ? "observed"
          : "none_observed",
    messages,
    issues,
  };
}
