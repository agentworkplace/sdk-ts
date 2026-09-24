import {
  filesTreeRequestSchema,
  type FilesEntry,
  type FilesTree,
  type FileMetadata,
  type FilesCheckpoint,
  type FilesChanges,
} from "./contracts/files.js";
import { AgentWorkplaceError } from "./errors.js";

/** Paths are untrusted names, not filesystem paths. Consumers must enforce
 * their destination's name, collision and no-overwrite rules independently. */
export type FilesTreeItem =
  | { kind: "start"; root: FilesEntry | null; checkpoint: string }
  | { kind: "folder"; entry: FilesEntry; path: string[] }
  | {
      kind: "file";
      entry: FilesEntry;
      file: FileMetadata;
      path: string[];
      changedSinceListing: boolean;
    }
  | {
      kind: "issue";
      entryId: string | null;
      path: string[];
      code: "not_found" | "entry_revisited";
    }
  | {
      kind: "complete";
      coverage: "non_snapshot";
      workplaceChanges: "observed" | "none_observed" | "unknown";
      issues: number;
    };

/** Scoped to one new traversal. Return true only on the first visit to an ID.
 * Large filesystem consumers can keep this index on disk instead of in RAM. */
export interface FilesTreeVisitStore {
  addIfNew(entryId: string): Promise<boolean>;
}

interface TreeReads {
  checkpoint(): Promise<FilesCheckpoint>;
  changes(cursor: string): Promise<FilesChanges>;
  entry(entryId: string): Promise<FilesEntry>;
  file(fileId: string): Promise<FileMetadata>;
  page(parentId: string | null, after?: string): Promise<FilesTree>;
}

const malformed = () =>
  new AgentWorkplaceError("Invalid Files tree response", {
    status: 0,
    code: "invalid_response",
  });
const missing = (error: unknown) =>
  error instanceof AgentWorkplaceError && error.code === "not_found";

/** Streams a best-effort inventory through existing authorized reads. Content is
 * pinned per file, not as a tree snapshot. Keeps one page per active depth and
 * visited IDs to avoid duplication/cycles caused by concurrent moves. It does
 * not collect file bytes or the complete inventory. */
export async function* walkTree(
  input: { workplaceId: string; parentId?: string | null },
  reads: TreeReads,
  visits?: FilesTreeVisitStore,
): AsyncGenerator<FilesTreeItem> {
  const parsed = filesTreeRequestSchema.safeParse(input);
  if (!parsed.success) throw new TypeError("Invalid Files tree root");
  const { workplaceId, parentId } = parsed.data;
  const { checkpoint } = await reads.checkpoint();
  const root = parentId === null ? null : await reads.entry(parentId);
  if (root && (root.workplaceId !== workplaceId || root.entryId !== parentId))
    throw malformed();
  if (root && root.kind !== "folder")
    throw new TypeError("Files tree root must be a folder");
  const seen = new Set<string>();
  const addIfNew = visits
    ? (entryId: string) => visits.addIfNew(entryId)
    : async (entryId: string) => {
        if (seen.has(entryId)) return false;
        seen.add(entryId);
        return true;
      };
  if (root) await addIfNew(root.entryId);
  yield { kind: "start", root, checkpoint };
  let issues = 0;
  type Frame = {
    parentId: string | null;
    path: string[];
    after?: string;
    page?: FilesTree;
    index: number;
  };
  const stack: Frame[] = [{ parentId, path: [], index: 0 }];
  while (stack.length) {
    const frame = stack.at(-1)!;
    if (!frame.page) {
      try {
        frame.page = await reads.page(frame.parentId, frame.after);
      } catch (error) {
        if (!missing(error)) throw error;
        issues++;
        yield {
          kind: "issue",
          entryId: frame.parentId,
          path: frame.path,
          code: "not_found",
        };
        stack.pop();
        continue;
      }
      const { entries, nextCursor } = frame.page;
      // The HTTP API orders UUIDs ascending. Reject a stalled or backwards
      // cursor instead of issuing unbounded repeated requests.
      let previous = frame.after ?? "";
      for (const entry of entries) {
        if (
          entry.workplaceId !== workplaceId ||
          entry.parentId !== frame.parentId ||
          entry.entryId <= previous
        )
          throw malformed();
        previous = entry.entryId;
      }
      if (nextCursor !== null && (!entries.length || nextCursor !== previous))
        throw malformed();
      frame.index = 0;
    }
    const entry = frame.page.entries[frame.index++];
    if (!entry) {
      if (frame.page.nextCursor === null) stack.pop();
      else {
        frame.after = frame.page.nextCursor;
        frame.page = undefined;
      }
      continue;
    }
    const path = [...frame.path, entry.name];
    if (!(await addIfNew(entry.entryId))) {
      issues++;
      yield {
        kind: "issue",
        entryId: entry.entryId,
        path,
        code: "entry_revisited",
      };
      continue;
    }
    if (entry.kind === "folder") {
      // Capture continuation before yielding mutable result objects.
      stack.push({ parentId: entry.entryId, path: [...path], index: 0 });
      yield { kind: "folder", entry, path };
      continue;
    }
    try {
      const file = await reads.file(entry.entryId);
      if (file.workplaceId !== workplaceId || file.fileId !== entry.entryId)
        throw malformed();
      yield {
        kind: "file",
        entry,
        file,
        path,
        changedSinceListing: file.version !== entry.version,
      };
    } catch (error) {
      if (!missing(error)) throw error;
      issues++;
      yield { kind: "issue", entryId: entry.entryId, path, code: "not_found" };
    }
  }
  const changes = await reads.changes(checkpoint);
  yield {
    kind: "complete",
    coverage: "non_snapshot",
    workplaceChanges:
      changes.state === "gap"
        ? "unknown"
        : changes.items.length
          ? "observed"
          : "none_observed",
    issues,
  };
}

export type RetainedFilesItem =
  | { kind: "start"; checkpoint: string }
  | {
      kind: "entry";
      entry: import("./contracts/files.js").FilesBaseline["entries"][number];
    }
  | {
      kind: "revision";
      file: import("./contracts/files.js").FileHistory["revisions"][number];
    }
  | { kind: "issue"; entryId: string; code: "not_found" }
  | Extract<FilesTreeItem, { kind: "complete" }>;

/** Entire retained workplace inventory, including trash and previous revisions.
 * Folder/name/history/trash metadata accompanies immutable revision references;
 * it does not create archive, restore, retention or snapshot semantics. */
export async function* walkRetained(
  workplaceId: string,
  reads: Pick<TreeReads, "checkpoint" | "changes"> & {
    baseline(
      after?: string,
    ): Promise<import("./contracts/files.js").FilesBaseline>;
    history(
      fileId: string,
      after?: string,
    ): Promise<import("./contracts/files.js").FileHistory>;
  },
): AsyncGenerator<RetainedFilesItem> {
  if (!filesTreeRequestSchema.safeParse({ workplaceId }).success)
    throw new TypeError("Invalid Files workplace");
  const { checkpoint } = await reads.checkpoint();
  yield { kind: "start", checkpoint };
  let after: string | undefined,
    issues = 0;
  for (;;) {
    const page = await reads.baseline(after);
    let previous = after ?? "";
    for (const entry of page.entries) {
      if (entry.workplaceId !== workplaceId || entry.entryId <= previous)
        throw malformed();
      previous = entry.entryId;
    }
    if (
      page.nextCursor !== null &&
      (!page.entries.length || page.nextCursor !== previous)
    )
      throw malformed();
    for (const entry of page.entries) {
      const fileId = entry.entryId,
        kind = entry.kind;
      yield { kind: "entry", entry };
      if (kind !== "file") continue;
      let revisionAfter: string | undefined;
      try {
        for (;;) {
          const history = await reads.history(fileId, revisionAfter);
          if (!revisionAfter && history.revisions.length === 0)
            throw new AgentWorkplaceError(
              "Retained file content is unavailable",
              { status: 404, code: "not_found" },
            );
          let prior = revisionAfter ?? "";
          for (const file of history.revisions) {
            if (
              file.workplaceId !== workplaceId ||
              file.fileId !== fileId ||
              file.revisionId <= prior
            )
              throw malformed();
            prior = file.revisionId;
          }
          if (
            history.nextCursor !== null &&
            (!history.revisions.length || history.nextCursor !== prior)
          )
            throw malformed();
          for (const file of history.revisions)
            yield { kind: "revision", file };
          if (history.nextCursor === null) break;
          revisionAfter = history.nextCursor;
        }
      } catch (error) {
        if (!missing(error)) throw error;
        issues++;
        yield { kind: "issue", entryId: fileId, code: "not_found" };
      }
    }
    if (page.nextCursor === null) break;
    after = page.nextCursor;
  }
  const changes = await reads.changes(checkpoint);
  yield {
    kind: "complete",
    coverage: "non_snapshot",
    workplaceChanges:
      changes.state === "gap"
        ? "unknown"
        : changes.items.length
          ? "observed"
          : "none_observed",
    issues,
  };
}
