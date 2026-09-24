import { expect, it, vi } from "vitest";
import {
  AgentWorkplace,
  AgentWorkplaceError,
  type FilesEntry,
  type FileMetadata,
} from "../src/index.js";
import { walkTree, walkRetained } from "../src/files-tree.js";
const id = (n: number) =>
  `${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const workplaceId = id(1),
  version = id(99),
  checkpoint = "cursor.signature";
function entry(
  n: number,
  kind: "file" | "folder",
  parentId: string | null = null,
): FilesEntry {
  return {
    workplaceId,
    entryId: id(n),
    kind,
    parentId,
    name: `item-${n}`,
    version,
    actorId: id(2),
    changedAt: "2026-09-17T00:00:00.000Z",
    reference: `awp:${kind}:${workplaceId}:${id(n)}`,
  };
}
function file(n: number): FileMetadata {
  return {
    workplaceId,
    fileId: id(n),
    revisionId: id(100 + n),
    version,
    name: `item-${n}`,
    reference: `awp:file:${workplaceId}:${id(n)}`,
    revisionReference: `awp:file:${workplaceId}:${id(n)}:revision:${id(100 + n)}`,
    byteLength: 3,
    contentType: "text/plain",
    sha256: "f".repeat(64),
    actorId: id(2),
    createdAt: "2026-09-17T00:00:00.000Z",
  };
}
function reads() {
  return {
    checkpoint: vi.fn(async () => ({ checkpoint })),
    changes: vi.fn(async () => ({
      state: "changes" as const,
      items: [],
      nextCursor: null,
      checkpoint,
    })),
    entry: vi.fn(async () => entry(10, "folder")),
    file: vi.fn(async (n: string) => file(parseInt(n, 16))),
    page: vi.fn(
      async (
        _parent: string | null,
        _after?: string,
      ): Promise<{ entries: FilesEntry[]; nextCursor: string | null }> => {
        void _parent;
        void _after;
        return { entries: [], nextCursor: null };
      },
    ),
  };
}
it("traverses pages with backpressure, pins content and reports concurrent moves/removal", async () => {
  const r = reads();
  r.page.mockImplementation(async (parent, after) => {
    if (parent === null)
      return after
        ? {
            entries: [entry(20, "folder"), entry(30, "file")],
            nextCursor: null,
          }
        : { entries: [entry(10, "folder")], nextCursor: id(10) };
    return { entries: [entry(40, "file", parent)], nextCursor: null };
  });
  r.file.mockImplementation(async (n) => {
    if (n === id(30))
      throw new AgentWorkplaceError("Gone", { status: 404, code: "not_found" });
    return { ...file(40), version: id(98) };
  });
  const walk = walkTree({ workplaceId }, r);
  expect((await walk.next()).value).toMatchObject({ kind: "start" });
  expect(r.page).not.toHaveBeenCalled();
  const events = [];
  for await (const event of walk) events.push(event);
  expect(events.map((e) => e.kind)).toEqual([
    "folder",
    "file",
    "folder",
    "issue",
    "issue",
    "complete",
  ]);
  expect(events[1]).toMatchObject({
    path: ["item-10", "item-40"],
    changedSinceListing: true,
    file: { revisionId: id(140) },
  });
  expect(events[3]).toMatchObject({
    code: "entry_revisited",
    path: ["item-20", "item-40"],
  });
  expect(events[4]).toMatchObject({ code: "not_found", entryId: id(30) });
  expect(events.at(-1)).toMatchObject({
    coverage: "non_snapshot",
    issues: 2,
    workplaceChanges: "none_observed",
  });
  expect(r.file).toHaveBeenCalledTimes(2);
  expect(r.changes).toHaveBeenCalledWith(checkpoint);
});
it("marks a deleted branch partial but preserves authorization errors", async () => {
  const r = reads();
  r.page.mockRejectedValue(
    new AgentWorkplaceError("Gone", { status: 404, code: "not_found" }),
  );
  const events = [];
  for await (const event of walkTree({ workplaceId, parentId: id(10) }, r))
    events.push(event);
  expect(events.at(-1)).toMatchObject({ issues: 1 });
  r.page.mockRejectedValue(
    new AgentWorkplaceError("Denied", { status: 403, code: "access_denied" }),
  );
  const walk = walkTree({ workplaceId }, r);
  await walk.next();
  await expect(walk.next()).rejects.toMatchObject({ code: "access_denied" });
  expect(r.changes).toHaveBeenCalledTimes(1);
});
it.each(["cursor", "scope", "order"])(
  "rejects malformed %s without looping",
  async (mode) => {
    const r = reads();
    r.page.mockResolvedValue(
      mode === "cursor"
        ? { entries: [], nextCursor: id(10) }
        : mode === "scope"
          ? { entries: [entry(10, "file", id(20))], nextCursor: null }
          : {
              entries: [entry(20, "file"), entry(10, "file")],
              nextCursor: null,
            },
    );
    const walk = walkTree({ workplaceId }, r);
    await walk.next();
    await expect(walk.next()).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(r.page).toHaveBeenCalledTimes(1);
  },
);
it("uses authorized HTTP reads and reports a lost change-history window", async () => {
  const paths: string[] = [];
  const client = new AgentWorkplace({
    baseUrl: "https://api.test",
    fetch: async (input, init) => {
      const request = new Request(input, init),
        url = new URL(request.url);
      paths.push(url.pathname);
      if (url.pathname.endsWith("checkpoint"))
        return Response.json({ checkpoint });
      if (url.pathname.endsWith("changes")) {
        expect(url.searchParams.get("limit")).toBe("1");
        return Response.json({
          state: "gap",
          reason: "history_expired",
          baselineRequired: true,
        });
      }
      return Response.json({ entries: [], nextCursor: null });
    },
  });
  const events = [];
  for await (const event of client.walkFilesTree(
    { apiKey: "private" },
    { workplaceId },
  ))
    events.push(event);
  expect(paths).toEqual([
    "/v1/files/checkpoint",
    "/v1/files/entries",
    "/v1/files/changes",
  ]);
  expect(events.at(-1)).toMatchObject({
    workplaceChanges: "unknown",
    coverage: "non_snapshot",
  });
});

it("does not let caller mutation redirect traversal continuation", async () => {
  const r = reads();
  r.page.mockImplementation(async (parent) =>
    parent === null
      ? { entries: [entry(10, "folder")], nextCursor: null }
      : { entries: [entry(20, "file", parent)], nextCursor: null },
  );
  const walk = walkTree({ workplaceId }, r);
  await walk.next();
  const folder = (await walk.next()).value;
  if (!folder || folder.kind !== "folder") throw new Error("Expected folder");
  folder.path[0] = "changed";
  folder.entry.entryId = id(999);
  expect((await walk.next()).value).toMatchObject({
    kind: "file",
    path: ["item-10", "item-20"],
  });
  expect(r.page).toHaveBeenLastCalledWith(id(10), undefined);
});

it("retained inventory includes trash metadata, old revisions and empty folders", async () => {
  const r = reads();
  const history = vi.fn(async (n: string, after?: string) => ({
    revisions: [
      {
        ...file(parseInt(n, 16)),
        revisionId: after ? id(201) : id(200),
        isCurrent: !!after,
        expiresAt: after ? null : "2026-09-18T00:00:00.000Z",
        restoredFromRevisionId: null,
      },
    ],
    nextCursor: after ? null : id(200),
  }));
  const baseline = vi.fn(async (after?: string) => ({
    entries: [
      {
        ...entry(after ? 20 : 10, after ? "folder" : "file"),
        trashedAt: after ? null : "2026-09-17T00:00:00.000Z",
        trashExpiresAt: after ? null : "2026-09-24T00:00:00.000Z",
        clearingHistory: false,
      },
    ],
    nextCursor: after ? null : id(10),
  }));
  const events = [];
  for await (const event of walkRetained(workplaceId, {
    ...r,
    baseline,
    history,
  }))
    events.push(event);
  expect(events.map((e) => e.kind)).toEqual([
    "start",
    "entry",
    "revision",
    "revision",
    "entry",
    "complete",
  ]);
  expect(events[1]).toMatchObject({
    entry: { trashedAt: "2026-09-17T00:00:00.000Z" },
  });
  expect(events[2]).toMatchObject({
    file: { isCurrent: false, expiresAt: "2026-09-18T00:00:00.000Z" },
  });
  expect(events[3]).toMatchObject({
    file: { isCurrent: true, revisionId: id(201) },
  });
  expect(history).toHaveBeenCalledTimes(2);
  expect(baseline).toHaveBeenLastCalledWith(id(10));
});
it("does not hide content that expires between baseline and revision listing", async () => {
  const r = reads();
  const events = [];
  for await (const event of walkRetained(workplaceId, {
    ...r,
    baseline: async () => ({
      entries: [
        {
          ...entry(10, "file"),
          trashedAt: null,
          trashExpiresAt: null,
          clearingHistory: false,
        },
      ],
      nextCursor: null,
    }),
    history: async () => ({ revisions: [], nextCursor: null }),
  }))
    events.push(event);
  expect(events.at(-2)).toMatchObject({
    kind: "issue",
    entryId: id(10),
    code: "not_found",
  });
  expect(events.at(-1)).toMatchObject({ issues: 1 });
});

it("delegates repeated-entry tracking to a fresh external visit store", async () => {
  const r = reads();
  r.page.mockImplementation(async (parent) => ({
    entries: [entry(20, "folder", parent)],
    nextCursor: null,
  }));
  const ids = new Set<string>();
  const addIfNew = vi.fn(async (id: string) => {
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  });
  const events = [];
  for await (const event of walkTree({ workplaceId, parentId: id(10) }, r, {
    addIfNew,
  }))
    events.push(event);
  expect(addIfNew.mock.calls.map(([id]) => id)).toEqual([
    id(10),
    id(20),
    id(20),
  ]);
  expect(events.at(-2)).toMatchObject({
    kind: "issue",
    code: "entry_revisited",
  });
  expect(r.page).toHaveBeenCalledTimes(2);
});
