import { expect, it } from "vitest";
import {
  AgentWorkplace,
  prepareFileUpload,
  parseFileReference,
} from "../src/index.js";
const workplaceId = "11111111-1111-4111-8111-111111111111",
  fileId = "22222222-2222-4222-8222-222222222222",
  revisionId = "33333333-3333-4333-8333-333333333333";
const base = {
  workplaceId,
  operationId: "44444444-4444-4444-8444-444444444444",
  target: { name: "shared.txt" },
  contentType: "text/plain",
  expiresAt: "2026-09-16T12:00:00.000Z",
};
const emptyUploadedParts = () =>
  Response.json({
    upload: {
      state: "pending",
      transferState: "open",
      uploadId: revisionId,
      fileId,
      revisionId,
      version: null,
    },
    presentPartNumbers: [],
  });
it("prepares fixed slot manifests and stable pinned references", () => {
  const request = prepareFileUpload(base, new TextEncoder().encode("abc"));
  expect(request.contentMd5).toBe("kAFQmDzST7DWlj99KOF/cg==");
  expect(request.sha256).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(prepareFileUpload(base, new Uint8Array()).multipartParts).toEqual([
    { partNumber: 1, byteLength: 0, contentMd5: "1B2M2Y8AsgTpgAmY7PhCfg==" },
  ]);
  const split = prepareFileUpload(base, new Uint8Array(8 * 1024 * 1024 + 1));
  expect(split.multipartParts.map((p) => p.byteLength)).toEqual([
    8 * 1024 * 1024,
    1,
  ]);
  expect(
    parseFileReference(
      `awp:file:${workplaceId}:${fileId}:revision:${revisionId}`,
    ),
  ).toEqual({ workplaceId, fileId, revisionId });
  expect(() => parseFileReference("https://storage.test/private")).toThrow(
    "Invalid file reference",
  );
});
it("does not dispatch modified bytes or oversized text", async () => {
  let calls = 0;
  const client = new AgentWorkplace({
    baseUrl: "https://api.test",
    fetch: async () => {
      calls++;
      throw new Error();
    },
  });
  await expect(
    client.uploadFile(
      { apiKey: "private" },
      prepareFileUpload(base, new TextEncoder().encode("abc")),
      new TextEncoder().encode("bad"),
    ),
  ).rejects.toThrow("immutable request");
  await expect(
    client.uploadText({ apiKey: "private" }, base, "a".repeat(1024 * 1024 + 1)),
  ).rejects.toThrow("1 MiB");
  expect(calls).toBe(0);
});
it("checks downloaded bytes and never sends API authorization to storage", async () => {
  const file = {
    workplaceId,
    fileId,
    revisionId,
    version: revisionId,
    name: "shared.txt",
    reference: `awp:file:${workplaceId}:${fileId}`,
    revisionReference: `awp:file:${workplaceId}:${fileId}:revision:${revisionId}`,
    byteLength: 3,
    contentType: "text/plain",
    sha256: prepareFileUpload(base, new TextEncoder().encode("abc")).sha256,
    actorId: workplaceId,
    createdAt: "2026-09-16T00:00:00.000Z",
  };
  const client = new AgentWorkplace({
    baseUrl: "https://api.test",
    fetch: async (input, init) => {
      const req = new Request(input, init);
      if (new URL(req.url).pathname.endsWith("/parts"))
        return emptyUploadedParts();
      if (new URL(req.url).hostname === "api.test")
        return Response.json({
          file,
          url: "https://storage.test/object?private-grant",
          expiresAt: "2026-09-16T00:01:00.000Z",
        });
      expect(req.headers.has("authorization")).toBe(false);
      expect(req.credentials).toBe("omit");
      return new Response("bad");
    },
  });
  await expect(
    client.downloadFile({ apiKey: "private" }, { workplaceId, fileId }),
  ).rejects.toMatchObject({
    code: "transfer_interrupted",
    message: "File download integrity or transport check failed",
  });
});

it.each([
  "http://storage.test/object?private-grant",
  "ftp://storage.test/object?private-grant",
  "https://user:secret@storage.test/object?private-grant",
])(
  "rejects insecure grant transport before fetching bytes (%s)",
  async (url) => {
    const bytes = new TextEncoder().encode("abc"),
      prepared = prepareFileUpload(base, bytes);
    let storageCalls = 0;
    const file = {
      workplaceId,
      fileId,
      revisionId,
      version: revisionId,
      name: "shared.txt",
      reference: `awp:file:${workplaceId}:${fileId}`,
      revisionReference: `awp:file:${workplaceId}:${fileId}:revision:${revisionId}`,
      byteLength: 3,
      contentType: "text/plain",
      sha256: prepared.sha256,
      actorId: workplaceId,
      createdAt: "2026-09-16T00:00:00.000Z",
    };
    const client = new AgentWorkplace({
      baseUrl: "https://api.test",
      fetch: async (input, init) => {
        const req = new Request(input, init);
        if (new URL(req.url).pathname.endsWith("/parts"))
          return emptyUploadedParts();
        if (new URL(req.url).hostname !== "api.test") {
          storageCalls++;
          return new Response("abc");
        }
        if (req.url.endsWith("/uploads"))
          return Response.json({
            state: "pending",
            transferState: "open",
            uploadId: revisionId,
            fileId,
            revisionId,
            version: null,
          });
        return Response.json({
          url,
          headers: {},
          file,
          expiresAt: "2026-09-16T00:01:00.000Z",
        });
      },
    });
    for (const call of [
      () => client.uploadFile({ apiKey: "private" }, prepared, bytes),
      () => client.downloadFile({ apiKey: "private" }, { workplaceId, fileId }),
    ]) {
      await expect(call()).rejects.toMatchObject({
        code: "transfer_interrupted",
      });
      try {
        await call();
      } catch (error) {
        expect(String(error)).not.toContain("private-grant");
        expect(String(error)).not.toContain("secret");
      }
    }
    expect(storageCalls).toBe(0);
  },
);
it.each(
  [
    "https://storage.test/object",
    "http://127.0.0.1:9000/object",
    "http://[::1]:9000/object",
    "http://localhost:9000/object",
  ].flatMap((url) => [false, true].map((separate) => ({ url, separate }))),
)(
  "secure transfers $url with separate transport=$separate",
  async ({ url, separate }) => {
    const bytes = new TextEncoder().encode("abc"),
      prepared = prepareFileUpload(base, bytes);
    let transfers = 0;
    const file = {
      workplaceId,
      fileId,
      revisionId,
      version: revisionId,
      name: "shared.txt",
      reference: `awp:file:${workplaceId}:${fileId}`,
      revisionReference: `awp:file:${workplaceId}:${fileId}:revision:${revisionId}`,
      byteLength: 3,
      contentType: "text/plain",
      sha256: prepared.sha256,
      actorId: workplaceId,
      createdAt: "2026-09-16T00:00:00.000Z",
    };
    const transfer: typeof fetch = async (input, init) => {
      const req = new Request(input, init);
      if (new URL(req.url).pathname.endsWith("/parts"))
        return emptyUploadedParts();
      transfers++;
      expect(req.redirect).toBe("error");
      expect(req.credentials).toBe("omit");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      for (const header of [
        "authorization",
        "cookie",
        "cf-access-client-id",
        "cf-access-client-secret",
        "x-request-id",
      ])
        expect(req.headers.has(header)).toBe(false);
      return new Response("abc");
    };
    const client = new AgentWorkplace({
      baseUrl: "https://api.test",
      ...(separate ? { transferFetch: transfer } : {}),
      fetch: async (input, init) => {
        const req = new Request(input, init);
        if (new URL(req.url).pathname.endsWith("/parts"))
          return emptyUploadedParts();
        if (new URL(req.url).hostname !== "api.test") {
          expect(separate).toBe(false);
          return transfer(input, init);
        }
        expect(req.headers.get("authorization")).toBe("Bearer private");
        if (req.url.endsWith("/uploads"))
          return Response.json({
            state: "pending",
            transferState: "open",
            uploadId: revisionId,
            fileId,
            revisionId,
            version: null,
          });
        if (new URL(req.url).pathname.endsWith("/finalize"))
          return Response.json({
            state: "published",
            uploadId: revisionId,
            fileId,
            revisionId,
            version: revisionId,
          });
        return Response.json({
          url,
          headers: {},
          file,
          expiresAt: "2026-09-16T00:01:00.000Z",
        });
      },
    });
    expect(
      (await client.uploadFile({ apiKey: "private" }, prepared, bytes)).state,
    ).toBe("published");
    expect(
      (
        await client.downloadFile(
          { apiKey: "private" },
          { workplaceId, fileId },
        )
      ).bytes,
    ).toEqual(bytes);
    expect(transfers).toBe(2);
  },
);

it("uses restoration/history product routes and validates their receipts", async () => {
  const requests: Request[] = [];
  const result = {
    state: "restored",
    operationId: base.operationId,
    fileId,
    restoredFromRevisionId: revisionId,
    revisionId: base.operationId,
    version: base.operationId,
    occurredAt: "2026-09-17T00:00:00.000Z",
  };
  let malformed = false;
  const client = new AgentWorkplace({
    baseUrl: "https://api.test",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname.endsWith("/parts"))
        return emptyUploadedParts();
      requests.push(request);
      if (request.url.includes("/revisions?"))
        return Response.json({ revisions: [], nextCursor: null });
      return Response.json(malformed ? { state: "restored" } : result);
    },
  });
  const input = {
    workplaceId,
    fileId,
    revisionId,
    expectedVersion: fileId,
    operationId: base.operationId,
  };
  expect(
    await client.restoreFileRevision({ apiKey: "private" }, input),
  ).toEqual(result);
  expect(await requests[0]!.json()).toEqual(input);
  expect(requests[0]!.method).toBe("POST");
  expect(await client.getFileRestoration({ apiKey: "private" }, input)).toEqual(
    result,
  );
  expect(
    await client.listFileRevisions(
      { apiKey: "private" },
      { workplaceId, fileId, after: revisionId, limit: 2 },
    ),
  ).toEqual({ revisions: [], nextCursor: null });
  expect(new URL(requests[2]!.url).searchParams.get("after")).toBe(revisionId);
  malformed = true;
  await expect(
    client.getFileRestoration({ apiKey: "private" }, input),
  ).rejects.toThrow();
});

it("uses HTTP trash discovery, mutation and private status with validated replies", async () => {
  const requests: Request[] = [];
  const receipt = {
    state: "trashed",
    operationId: base.operationId,
    fileId,
    version: revisionId,
    occurredAt: "2026-09-17T00:00:00.000Z",
    trashExpiresAt: "2026-09-24T00:00:00.000Z",
  };
  const client = new AgentWorkplace({
    baseUrl: "https://fixture.test",
    fetch: async (input, init) => {
      const req = new Request(input, init);
      if (new URL(req.url).pathname.endsWith("/parts"))
        return emptyUploadedParts();
      requests.push(req);
      return Response.json(
        req.url.includes("/trash?") ? { files: [], nextCursor: null } : receipt,
      );
    },
  });
  const auth = { apiKey: "private" };
  expect(
    await client.listTrashedFiles(auth, { workplaceId, limit: 2 }),
  ).toEqual({ files: [], nextCursor: null });
  const request = {
    action: "trash" as const,
    workplaceId,
    fileId,
    expectedVersion: revisionId,
    operationId: base.operationId,
  };
  expect(await client.changeFileTrash(auth, request)).toEqual(receipt);
  expect(
    await client.getFileTrashOperation(auth, {
      workplaceId,
      operationId: base.operationId,
    }),
  ).toEqual(receipt);
  expect(new URL(requests[0]!.url).pathname).toBe("/v1/files/trash");
  expect(await requests[1]!.json()).toEqual(request);
  expect(new URL(requests[2]!.url).pathname).toBe(
    `/v1/files/trash-operations/${base.operationId}`,
  );
  expect(
    requests.every(
      (req) => req.headers.get("authorization") === "Bearer private",
    ),
  ).toBe(true);
});

it("uses private administrative deletion HTTP status and rejects false completion counts", async () => {
  const requests: Request[] = [];
  let response: unknown = {
    state: "pending",
    phase: "collecting",
    operationId: base.operationId,
    fileId,
    version: revisionId,
    action: "clear_history",
    admittedAt: "2026-09-17T00:00:00.000Z",
    targetCount: 0,
    processedCount: 0,
  };
  const client = new AgentWorkplace({
    baseUrl: "https://fixture.test",
    fetch: async (input, init) => {
      const r = new Request(input, init);
      requests.push(r);
      return Response.json(response);
    },
  });
  const auth = { apiKey: "private" },
    request = {
      workplaceId,
      fileId,
      operationId: base.operationId,
      expectedVersion: revisionId,
      action: "clear_history" as const,
    };
  expect(await client.beginFileDeletion(auth, request)).toEqual(response);
  expect(await requests[0]!.json()).toEqual(request);
  expect(new URL(requests[0]!.url).pathname).toBe(
    "/v1/files/deletion-operations",
  );
  expect(
    await client.getFileDeletionOperation(auth, {
      workplaceId,
      operationId: base.operationId,
    }),
  ).toEqual(response);
  expect(new URL(requests[1]!.url).pathname).toBe(
    `/v1/files/deletion-operations/${base.operationId}`,
  );
  expect(
    requests.every((r) => r.headers.get("authorization") === "Bearer private"),
  ).toBe(true);
  response = {
    ...(response as object),
    state: "complete",
    targetCount: 2,
    processedCount: 1,
    logicalComplete: true,
    completedAt: "2026-09-17T00:00:00.000Z",
    physicalCleanup: "handed_off",
  };
  await expect(
    client.getFileDeletionOperation(auth, {
      workplaceId,
      operationId: base.operationId,
    }),
  ).rejects.toThrow();
});

it("uses authenticated catch-up routes and preserves gaps and opaque cursors", async () => {
  const calls: string[] = [];
  const client = new AgentWorkplace({
    baseUrl: "https://api.test",
    fetch: async (input, init) => {
      const request = new Request(input, init),
        url = new URL(request.url);
      expect(request.headers.get("authorization")).toBe("Bearer private");
      expect(url.searchParams.get("workplaceId")).toBe(workplaceId);
      calls.push(url.pathname);
      if (url.pathname.endsWith("checkpoint"))
        return Response.json({ checkpoint: "opaque.signature" });
      if (url.pathname.endsWith("baseline"))
        return Response.json({ entries: [], nextCursor: null });
      expect(url.searchParams.get("cursor")).toBe("opaque.signature");
      return Response.json({
        state: "gap",
        reason: "history_expired",
        baselineRequired: true,
      });
    },
  });
  const auth = { apiKey: "private" };
  const saved = await client.getFilesCheckpoint(auth, { workplaceId });
  expect(
    await client.listFilesBaseline(auth, { workplaceId, limit: 1 }),
  ).toEqual({ entries: [], nextCursor: null });
  expect(
    await client.listFilesChanges(auth, {
      workplaceId,
      cursor: saved.checkpoint,
    }),
  ).toEqual({
    state: "gap",
    reason: "history_expired",
    baselineRequired: true,
  });
  expect(calls).toEqual([
    "/v1/files/checkpoint",
    "/v1/files/baseline",
    "/v1/files/changes",
  ]);
});

it("prepares a bounded seekable source with the same frozen hashes and manifest", async () => {
  const { prepareFileUploadFromSource } = await import("../src/index.js");
  const bytes = new Uint8Array(17 * 1024 * 1024 + 3);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const reads: Array<[number, number]> = [];
  const window = new Uint8Array(8 * 1024 * 1024);
  const prepared = await prepareFileUploadFromSource(base, {
    byteLength: bytes.length,
    async read(offset, length) {
      reads.push([offset, length]);
      const part = bytes.subarray(offset, offset + length);
      window.set(part);
      return window.subarray(0, part.length);
    },
  });
  expect(prepared).toEqual(prepareFileUpload(base, bytes));
  expect(reads).toEqual([
    [0, 8 * 1024 * 1024],
    [8 * 1024 * 1024, 8 * 1024 * 1024],
    [16 * 1024 * 1024, 1024 * 1024 + 3],
    [bytes.length, 1],
  ]);
  expect(
    await prepareFileUploadFromSource(base, {
      byteLength: 0,
      read: async () => new Uint8Array(),
    }),
  ).toEqual(prepareFileUpload(base, new Uint8Array()));
}, 30000);

it("rejects short, growing and oversized sources instead of freezing a prefix", async () => {
  const { prepareFileUploadFromSource } = await import("../src/index.js");
  await expect(
    prepareFileUploadFromSource(base, {
      byteLength: 3,
      read: async () => new Uint8Array(2),
    }),
  ).rejects.toThrow("length changed");
  await expect(
    prepareFileUploadFromSource(base, {
      byteLength: 3,
      read: async (_offset, length) => new Uint8Array(length),
    }),
  ).rejects.toThrow("length changed");
  let read = false;
  await expect(
    prepareFileUploadFromSource(base, {
      byteLength: 2_000_000_001,
      read: async () => {
        read = true;
        return new Uint8Array();
      },
    }),
  ).rejects.toThrow("2,000,000,000 bytes");
  expect(read).toBe(false);
});

it("rejects a changed reread part before exposing it to storage", async () => {
  const bytes = new TextEncoder().encode("abc"),
    prepared = prepareFileUpload(base, bytes);
  let partReads = 0,
    admissions = 0,
    grants = 0,
    transfers = 0;
  const client = new AgentWorkplace({
    baseUrl: "https://api.test",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname.endsWith("/parts"))
        return emptyUploadedParts();
      if (request.url.endsWith("/uploads")) {
        admissions++;
        return Response.json({
          state: "pending",
          transferState: "open",
          uploadId: revisionId,
          fileId,
          revisionId,
          version: null,
        });
      }
      grants++;
      throw new Error("Changed part must not request a grant");
    },
    transferFetch: async () => {
      transfers++;
      throw new Error("Changed bytes must not escape");
    },
  });
  await expect(
    client.uploadFileFromSource({ apiKey: "private" }, prepared, {
      byteLength: bytes.length,
      async read(offset, length) {
        if (offset === bytes.length) return new Uint8Array();
        partReads++;
        return partReads === 1
          ? bytes.slice(0, length)
          : new TextEncoder().encode("bad");
      },
    }),
  ).rejects.toThrow("immutable request");
  expect({ admissions, grants, transfers }).toEqual({
    admissions: 1,
    grants: 0,
    transfers: 0,
  });
});

it.each([[1, 1], [240], [2], null])(
  "does not dispatch bytes for invalid part observation %j",
  async (presentPartNumbers) => {
    let transfers = 0,
      grants = 0;
    const client = new AgentWorkplace({
      baseUrl: "https://api.test",
      transferFetch: async () => {
        transfers++;
        throw new Error("Unexpected transfer");
      },
      fetch: async (input, init) => {
        const path = new URL(new Request(input, init).url).pathname;
        const upload = {
          state: "pending",
          transferState: "open",
          uploadId: revisionId,
          fileId,
          revisionId,
          version: null,
        };
        if (path.endsWith("/uploads")) return Response.json(upload);
        if (path.endsWith("/parts"))
          return Response.json({ upload, presentPartNumbers });
        grants++;
        throw new Error("Unexpected grant");
      },
    });
    const bytes = new TextEncoder().encode("abc");
    await expect(
      client.uploadFile(
        { apiKey: "private" },
        prepareFileUpload(base, bytes),
        bytes,
      ),
    ).rejects.toThrow();
    expect({ transfers, grants }).toEqual({ transfers: 0, grants: 0 });
  },
);

it("keeps present parts out of byte transport but still finalizes the immutable object", async () => {
  let finalized = 0;
  const client = new AgentWorkplace({
    baseUrl: "https://api.test",
    transferFetch: async () => {
      throw new Error("Already present bytes must not be resent");
    },
    fetch: async (input, init) => {
      const path = new URL(new Request(input, init).url).pathname;
      const upload = {
        state: "pending",
        transferState: "open",
        uploadId: revisionId,
        fileId,
        revisionId,
        version: null,
      };
      if (path.endsWith("/uploads")) return Response.json(upload);
      if (path.endsWith("/parts"))
        return Response.json({ upload, presentPartNumbers: [1] });
      if (path.endsWith("/finalize")) {
        finalized++;
        return Response.json({
          ...upload,
          state: "published",
          version: revisionId,
        });
      }
      throw new Error("Unexpected part grant");
    },
  });
  const bytes = new TextEncoder().encode("abc");
  expect(
    (
      await client.uploadFile(
        { apiKey: "private" },
        prepareFileUpload(base, bytes),
        bytes,
      )
    ).state,
  ).toBe("published");
  expect(finalized).toBe(1);
});

it("never treats failed inspection as an empty source", async () => {
  let grants = 0;
  const client = new AgentWorkplace({
    baseUrl: "https://api.test",
    fetch: async (input, init) => {
      const path = new URL(new Request(input, init).url).pathname;
      if (path.endsWith("/uploads"))
        return Response.json({
          state: "pending",
          transferState: "open",
          uploadId: revisionId,
          fileId,
          revisionId,
          version: null,
        });
      if (path.endsWith("/parts"))
        return Response.json(
          { error: { code: "conflict", message: "Parts cannot be inspected" } },
          { status: 409 },
        );
      grants++;
      throw new Error("Unexpected request");
    },
  });
  const bytes = new TextEncoder().encode("abc");
  await expect(
    client.uploadFile(
      { apiKey: "private" },
      prepareFileUpload(base, bytes),
      bytes,
    ),
  ).rejects.toMatchObject({ status: 409, code: "conflict" });
  expect(grants).toBe(0);
});
