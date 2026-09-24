import { describe, expect, it } from "vitest";
import {
  fileDeletionRequestSchema,
  fileDeletionResultSchema,
  filesOrganizationRequestSchema,
  fileTrashRequestSchema,
  fileTrashResultSchema,
  restoreFileRevisionRequestSchema,
  fileRestorationResultSchema,
  fileHistoryRequestSchema,
  beginFileUploadRequestSchema,
  fileNameSchema,
  fileTargetSchema,
  fileUploadStatusSchema,
  fileUploadPartsSchema,
  fileListRequestSchema,
} from "./files.js";
const id = "11111111-1111-4111-8111-111111111111";
const md5 = "1B2M2Y8AsgTpgAmY7PhCfg==";
describe("Files wire boundaries", () => {
  it("measures UTF-8 names and rejects ambiguous target/unknown inputs", () => {
    expect(fileNameSchema.safeParse("é".repeat(127)).success).toBe(true);
    for (const name of ["é".repeat(128), "", "  ", "a/b", "a\\b", "a\0b"])
      expect(fileNameSchema.safeParse(name).success).toBe(false);
    expect(
      fileTargetSchema.safeParse({ name: "a", fileId: id, version: id })
        .success,
    ).toBe(false);
    expect(fileTargetSchema.safeParse({ fileId: id }).success).toBe(false);
    expect(
      fileTargetSchema.safeParse({ fileId: id, version: id }).success,
    ).toBe(true);
  });
  it("accepts bounded empty and full uploads, rejects excess and private wire fields", () => {
    const input = {
      workplaceId: id,
      operationId: id,
      target: { name: "a" },
      byteLength: 0,
      contentType: "text/plain",
      sha256: "0".repeat(64),
      contentMd5: md5,
      expiresAt: "2026-09-16T12:00:00.000Z",
      multipartParts: [{ partNumber: 1, byteLength: 0, contentMd5: md5 }],
    };
    expect(beginFileUploadRequestSchema.safeParse(input).success).toBe(true);
    expect(
      beginFileUploadRequestSchema.safeParse({
        ...input,
        byteLength: 64 * 1024 * 1024,
      }).success,
    ).toBe(true);
    for (const change of [
      { byteLength: 2_000_000_001 },
      { contentType: "text/plain\n" },
      { multipartParts: [] },
      { bucket: "private" },
      { sha256: "bad" },
    ])
      expect(
        beginFileUploadRequestSchema.safeParse({ ...input, ...change }).success,
      ).toBe(false);
  });
  it("keeps expired evidence distinct and bounds list requests", () => {
    expect(
      fileUploadStatusSchema.parse({ state: "evidence_expired", uploadId: id }),
    ).toEqual({ state: "evidence_expired", uploadId: id });
    expect(
      fileUploadStatusSchema.safeParse({ state: "published", uploadId: id })
        .success,
    ).toBe(false);
    expect(
      fileListRequestSchema.parse({ workplaceId: id, limit: "30" }).limit,
    ).toBe(30);
    expect(
      fileListRequestSchema.safeParse({ workplaceId: id, limit: 101 }).success,
    ).toBe(false);
  });
});

it("requires observed organization versions and an actual patch", () => {
  const identity = {
    workplaceId: id,
    operationId: id,
    action: "organize",
    entryId: id,
    expectedVersion: id,
  };
  expect(filesOrganizationRequestSchema.safeParse(identity).success).toBe(
    false,
  );
  expect(
    filesOrganizationRequestSchema.safeParse({ ...identity, parentId: null })
      .success,
  ).toBe(true);
  expect(
    filesOrganizationRequestSchema.safeParse({
      ...identity,
      name: "new",
      expectedVersion: undefined,
    }).success,
  ).toBe(false);
  expect(
    filesOrganizationRequestSchema.safeParse({
      ...identity,
      action: "delete_folder",
      name: "not-accepted",
    }).success,
  ).toBe(false);
});

it("requires an immutable restoration identity and version, with explicit evidence expiry", () => {
  const request = {
    workplaceId: id,
    fileId: id,
    revisionId: id,
    expectedVersion: id,
    operationId: id,
  };
  expect(restoreFileRevisionRequestSchema.parse(request)).toEqual(request);
  for (const field of Object.keys(request)) {
    const partial: Record<string, string> = { ...request };
    delete partial[field];
    expect(restoreFileRevisionRequestSchema.safeParse(partial).success).toBe(
      false,
    );
  }
  expect(
    restoreFileRevisionRequestSchema.safeParse({ ...request, objectId: id })
      .success,
  ).toBe(false);
  expect(
    fileHistoryRequestSchema.safeParse({
      workplaceId: id,
      fileId: id,
      limit: 101,
    }).success,
  ).toBe(false);
  expect(
    fileRestorationResultSchema.safeParse({
      state: "restored",
      operationId: id,
    }).success,
  ).toBe(false);
  expect(
    fileRestorationResultSchema.parse({
      state: "evidence_expired",
      operationId: id,
    }),
  ).toEqual({ state: "evidence_expired", operationId: id });
});

it("requires a complete explicit trash recovery destination and immutable identity", () => {
  const request = {
    action: "restore",
    workplaceId: id,
    fileId: id,
    expectedVersion: id,
    operationId: id,
  };
  expect(fileTrashRequestSchema.safeParse(request).success).toBe(true);
  expect(
    fileTrashRequestSchema.safeParse({
      ...request,
      destination: { parentId: null, name: "recovered.txt" },
    }).success,
  ).toBe(true);
  for (const destination of [
    { name: "note" },
    { parentId: null },
    { parentId: null, name: "../escape" },
  ])
    expect(
      fileTrashRequestSchema.safeParse({ ...request, destination }).success,
    ).toBe(false);
  expect(
    fileTrashRequestSchema.safeParse({ ...request, expectedVersion: undefined })
      .success,
  ).toBe(false);
  expect(
    fileTrashRequestSchema.safeParse({
      ...request,
      action: "trash",
      destination: { parentId: null, name: "note" },
    }).success,
  ).toBe(false);
  expect(
    fileTrashResultSchema.safeParse({
      state: "trashed",
      operationId: id,
      fileId: id,
      version: id,
      occurredAt: "2026-09-17T00:00:00.000Z",
      trashExpiresAt: null,
    }).success,
  ).toBe(false);
});

it("separates administrative deletion admission from truthful bounded completion", () => {
  const request = {
    workplaceId: id,
    operationId: id,
    fileId: id,
    expectedVersion: id,
    action: "purge",
  };
  expect(fileDeletionRequestSchema.safeParse(request).success).toBe(true);
  expect(
    fileDeletionRequestSchema.safeParse({ ...request, action: "delete_all" })
      .success,
  ).toBe(false);
  expect(
    fileDeletionRequestSchema.safeParse({ ...request, force: true }).success,
  ).toBe(false);
  const result = {
    state: "pending",
    phase: "collecting",
    operationId: id,
    fileId: id,
    version: id,
    action: "clear_history",
    admittedAt: "2026-09-17T00:00:00.000Z",
    targetCount: 2,
    processedCount: 0,
  };
  expect(fileDeletionResultSchema.safeParse(result).success).toBe(true);
  expect(
    fileDeletionResultSchema.safeParse({ ...result, processedCount: 1 })
      .success,
  ).toBe(false);
  const complete = {
    ...result,
    state: "complete",
    completedAt: result.admittedAt,
    logicalComplete: true,
    physicalCleanup: "handed_off",
    processedCount: 2,
  };
  expect(fileDeletionResultSchema.safeParse(complete).success).toBe(true);
  expect(
    fileDeletionResultSchema.safeParse({ ...complete, processedCount: 1 })
      .success,
  ).toBe(false);
  expect(
    fileDeletionResultSchema.safeParse({
      ...complete,
      physicalCleanup: "complete",
    }).success,
  ).toBe(false);
});

it("keeps catch-up gaps distinct from pages and lossless positions", async () => {
  const { filesChangesSchema } = await import("./files.js");
  const page = {
    state: "changes",
    items: [],
    nextCursor: null,
    checkpoint: "opaque.signature",
  };
  expect(filesChangesSchema.safeParse(page).success).toBe(true);
  expect(
    filesChangesSchema.safeParse({ ...page, checkpoint: null }).success,
  ).toBe(false);
  expect(
    filesChangesSchema.safeParse({ ...page, nextCursor: "next.signature" })
      .success,
  ).toBe(false);
  expect(
    filesChangesSchema.safeParse({
      state: "gap",
      reason: "history_expired",
      baselineRequired: true,
    }).success,
  ).toBe(true);
  expect(
    filesChangesSchema.safeParse({
      state: "gap",
      reason: "history_expired",
      baselineRequired: false,
    }).success,
  ).toBe(false);
  const item = {
    id: id,
    fileId: id,
    revisionId: null,
    action: "revision_expired",
    actorId: null,
    occurredAt: "2026-09-17T00:00:00.000Z",
    position: "9007199254740993",
  };
  expect(filesChangesSchema.parse({ ...page, items: [item] })).toMatchObject({
    items: [{ position: "9007199254740993" }],
  });
  for (const position of [1, "0", "invalid", "9223372036854775808"])
    expect(
      filesChangesSchema.safeParse({ ...page, items: [{ ...item, position }] })
        .success,
    ).toBe(false);
});

it("accepts the full decimal cap in a bounded239-part wire declaration", () => {
  const part = 8 * 1024 * 1024;
  for (const byteLength of [1_999_999_999, 2_000_000_000]) {
    const request = {
      workplaceId: id,
      operationId: id,
      target: { name: "\\".repeat(255) },
      byteLength,
      contentType: "\\".repeat(255),
      sha256: "f".repeat(64),
      contentMd5: md5,
      expiresAt: "2026-09-17T12:00:00.000Z",
      multipartParts: Array.from(
        { length: Math.ceil(byteLength / part) },
        (_, i) => ({
          partNumber: i + 1,
          byteLength: Math.min(part, byteLength - i * part),
          contentMd5: md5,
        }),
      ),
    };
    // A valid255-byte filename with maximal JSON escaping (quotes).
    request.target.name = '"'.repeat(255);
    expect(beginFileUploadRequestSchema.safeParse(request).success).toBe(true);
    expect(request.multipartParts).toHaveLength(239);
    expect(JSON.stringify(request).length).toBeLessThan(65536);
    expect(
      beginFileUploadRequestSchema.safeParse({
        ...request,
        multipartParts: [
          ...request.multipartParts,
          { partNumber: 240, byteLength: 0, contentMd5: md5 },
        ],
      }).success,
    ).toBe(false);
  }
});

it("requires complete bounded distinct part presence only for open uploads", () => {
  const upload = {
    state: "pending",
    transferState: "open",
    uploadId: "11111111-1111-4111-8111-111111111111",
    fileId: "22222222-2222-4222-8222-222222222222",
    revisionId: null,
    version: null,
  };
  expect(
    fileUploadPartsSchema.safeParse({ upload, presentPartNumbers: [] }).success,
  ).toBe(true);
  for (const parts of [null, [1, 1], [0], [240]])
    expect(
      fileUploadPartsSchema.safeParse({ upload, presentPartNumbers: parts })
        .success,
    ).toBe(false);
  expect(
    fileUploadPartsSchema.safeParse({
      upload: { ...upload, state: "expired" },
      presentPartNumbers: null,
    }).success,
  ).toBe(true);
  expect(
    fileUploadPartsSchema.safeParse({
      upload: { ...upload, state: "expired" },
      presentPartNumbers: [],
    }).success,
  ).toBe(false);
});
