import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { expect, it } from "vitest";
import { AgentWorkplace, type FileMetadata } from "../src/index.js";
const workplaceId = "11111111-1111-4111-8111-111111111111",
  fileId = "22222222-2222-4222-8222-222222222222",
  revisionId = "33333333-3333-4333-8333-333333333333";
const auth = { apiKey: "private" },
  ref = { workplaceId, fileId },
  size = 8 * 1024 * 1024;
function fixture(
  bytes: Uint8Array,
  options: {
    bad?: string;
    denySecond?: boolean;
    changeGrant?: boolean;
    signal?: AbortController;
  } = {},
) {
  const file: FileMetadata = {
    workplaceId,
    fileId,
    revisionId,
    version: revisionId,
    name: "test.bin",
    reference: `awp:file:${workplaceId}:${fileId}`,
    revisionReference: `awp:file:${workplaceId}:${fileId}:revision:${revisionId}`,
    byteLength: bytes.length,
    contentType: "application/octet-stream",
    sha256: bytesToHex(sha256(bytes)),
    actorId: workplaceId,
    createdAt: "2026-09-17T00:00:00.000Z",
  };
  const ranges: string[] = [];
  let grants = 0,
    cancelled = 0;
  const client = new AgentWorkplace({
    baseUrl: "https://api.test",
    fetch: async (input, init) => {
      const request = new Request(input, init),
        url = new URL(request.url);
      expect(request.headers.get("authorization")).toBe("Bearer private");
      if (!url.pathname.endsWith("/download")) return Response.json(file);
      expect(url.searchParams.get("revisionId")).toBe(revisionId);
      grants++;
      if (options.denySecond && grants === 2)
        return Response.json(
          { error: { code: "access_denied", message: "Access denied" } },
          { status: 403 },
        );
      return Response.json({
        file: options.changeGrant ? { ...file, revisionId: workplaceId } : file,
        url: "https://storage.test/bytes?private-grant",
        expiresAt: "2026-09-17T00:01:00.000Z",
      });
    },
    transferFetch: async (input, init) => {
      const request = new Request(input, init);
      expect(request.headers.has("authorization")).toBe(false);
      expect(request.credentials).toBe("omit");
      expect(request.redirect).toBe("error");
      const range = request.headers.get("range");
      ranges.push(range ?? "empty");
      const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
      const start = match ? Number(match[1]) : 0,
        end = match ? Number(match[2]) : -1;
      const expected = bytes.slice(start, end + 1);
      let body = expected;
      if (options.bad === "short")
        body = body.subarray(0, Math.max(0, body.length - 1));
      if (options.bad === "long") body = new Uint8Array(body.length + 1);
      if (options.bad === "hash") body = body.map((v) => v ^ 1);
      const headers: Record<string, string> = range
        ? { "content-range": `bytes ${start}-${end}/${bytes.length}` }
        : { "content-length": "0" };
      if (options.bad === "range")
        headers["content-range"] = `bytes ${start + 1}-${end}/${bytes.length}`;
      if (options.bad === "total")
        headers["content-range"] = `bytes ${start}-${end}/${bytes.length + 1}`;
      if (options.bad === "encoding") headers["content-encoding"] = "gzip";
      if (options.bad === "abort")
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(body);
            },
            cancel() {
              cancelled++;
            },
          }),
          { status: 206, headers },
        );
      return new Response(body, {
        status: options.bad === "full" ? 200 : range ? 206 : 200,
        headers,
      });
    },
  });
  return {
    client,
    file,
    ranges,
    get grants() {
      return grants;
    },
    get cancelled() {
      return cancelled;
    },
  };
}
it("writes bounded pinned ranges with awaited checkpoints and backpressure", async () => {
  const bytes = new Uint8Array(size + 17).fill(37),
    f = fixture(bytes),
    output = new Uint8Array(bytes.length),
    checkpoints: number[] = [];
  let active = 0,
    maximum = 0,
    release!: () => void,
    entered!: () => void;
  const held = new Promise<void>((r) => {
      entered = r;
    }),
    gate = new Promise<void>((r) => {
      release = r;
    });
  const work = f.client.downloadFileTo(auth, ref, {
    async write(chunk, offset) {
      active++;
      maximum = Math.max(maximum, active);
      if (offset === 0) {
        entered();
        await gate;
      }
      output.set(chunk, offset);
      active--;
    },
    async checkpoint(offset) {
      checkpoints.push(offset);
    },
  });
  await Promise.race([held, work]);
  expect(f.ranges).toEqual([`bytes=0-${size - 1}`]);
  expect(checkpoints).toEqual([]);
  release();
  expect((await work).file).toEqual(f.file);
  expect(bytesToHex(sha256(output))).toBe(f.file.sha256);
  expect(maximum).toBe(1);
  expect(checkpoints).toEqual([size, bytes.length]);
  expect(f.ranges).toEqual([
    `bytes=0-${size - 1}`,
    `bytes=${size}-${bytes.length - 1}`,
  ]);
});
it.each(["full", "range", "total", "short", "long", "hash", "encoding"])(
  "rejects %s responses without reporting completion",
  async (bad) => {
    const f = fixture(new Uint8Array([1, 2, 3]), { bad });
    let completed = false;
    await expect(
      f.client.downloadFileTo(auth, ref, {
        write: async () => {},
        checkpoint: async () => {
          completed = true;
        },
      }),
    ).rejects.toMatchObject({ code: "transfer_interrupted" });
    expect(completed).toBe(false);
  },
);
it("rehashes a resumed prefix and rejects corruption instead of trusting saved progress", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]),
    f = fixture(bytes),
    output = new Uint8Array(bytes.length);
  output.set(bytes.subarray(0, 3));
  const resume = {
    revisionId,
    byteLength: bytes.length,
    sha256: f.file.sha256,
    offset: 3,
  };
  await f.client.downloadFileTo(
    auth,
    { ...ref, revisionId },
    {
      read: async (offset, length) => output.slice(offset, offset + length),
      write: async (chunk, offset) => {
        output.set(chunk, offset);
      },
    },
    { resume },
  );
  expect(f.ranges).toEqual(["bytes=3-4"]);
  expect(bytesToHex(sha256(output))).toBe(f.file.sha256);
  output[0] = 9;
  await expect(
    f.client.downloadFileTo(
      auth,
      { ...ref, revisionId },
      {
        read: async (offset, length) => output.slice(offset, offset + length),
        write: async () => {},
      },
      { resume },
    ),
  ).rejects.toMatchObject({ code: "transfer_interrupted" });
  await expect(
    f.client.downloadFileTo(auth, ref, { write: async () => {} }, { resume }),
  ).rejects.toThrow("saved revision");
});
it("preserves denied renewal and never silently changes the pinned revision", async () => {
  const f = fixture(new Uint8Array(size + 1), { denySecond: true });
  const checkpoints: number[] = [];
  await expect(
    f.client.downloadFileTo(auth, ref, {
      write: async () => {},
      checkpoint: async (offset) => {
        checkpoints.push(offset);
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(checkpoints).toEqual([size]);
  expect(f.ranges).toHaveLength(1);
  const changed = fixture(new Uint8Array([1]), { changeGrant: true });
  await expect(
    changed.client.downloadFileTo(auth, ref, {
      write: async () => {
        throw new Error("must not write");
      },
    }),
  ).rejects.toMatchObject({ code: "transfer_interrupted" });
  expect(changed.ranges).toHaveLength(0);
});
it("cancels an open response after sink-triggered cancellation and verifies empty files", async () => {
  const controller = new AbortController(),
    f = fixture(new Uint8Array([1, 2, 3]), { bad: "abort" });
  await expect(
    f.client.downloadFileTo(
      auth,
      ref,
      {
        write: async () => {
          controller.abort();
        },
      },
      { signal: controller.signal },
    ),
  ).rejects.toMatchObject({ code: "transfer_interrupted" });
  expect(f.cancelled).toBe(1);
  const empty = fixture(new Uint8Array());
  let offset = -1;
  expect(
    (
      await empty.client.downloadFileTo(auth, ref, {
        write: async () => {
          throw new Error("no bytes");
        },
        checkpoint: async (value) => {
          offset = value;
        },
      })
    ).file.byteLength,
  ).toBe(0);
  expect(offset).toBe(0);
  expect(empty.ranges).toEqual(["empty"]);
});

it("rejects an oversized whole-buffer download before fetching any object bytes", async () => {
  const f = fixture(new Uint8Array());
  f.file.byteLength = 2_000_000_000;
  await expect(
    f.client.downloadFile(auth, { ...ref, revisionId }),
  ).rejects.toThrow("Whole-buffer downloads");
  expect(f.ranges).toEqual([]);
});
