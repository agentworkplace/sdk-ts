import { expect, test, vi } from "vitest";
import { AgentWorkplace, type DownloadOptions } from "../src/index.js";

const id = "11111111-1111-4111-8111-111111111111";
const hash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const auth = { apiKey: "private-key-sentinel" };

function fixture(
  kind: "file" | "attachment",
  length = 3,
  body: BodyInit = "abc",
) {
  const file = {
    workplaceId: id,
    fileId: id,
    revisionId: id,
    version: id,
    name: "text.txt",
    reference: `awp:file:${id}:${id}`,
    revisionReference: `awp:file:${id}:${id}:revision:${id}`,
    byteLength: length,
    contentType: "text/plain",
    sha256: hash,
    actorId: id,
    createdAt: "2026-10-10T00:00:00.000Z",
  };
  const attachment = {
    attachmentId: id,
    ordinal: 0,
    filename: "text.txt",
    contentType: "text/plain",
    disposition: null,
    contentId: null,
    state: "retained",
    bytes: length,
    sha256: hash,
  };
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
    Response.json({
      ...(kind === "file" ? { file } : { messageId: id, attachment }),
      url: "https://storage.test/object?secret-grant-sentinel",
      expiresAt: "2030-01-01T00:00:00Z",
    }),
  );
  const transferFetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => new Response(body));
  const client = new AgentWorkplace({
    baseUrl: "https://api.test",
    fetch,
    transferFetch,
  });
  const download = (options?: DownloadOptions) =>
    kind === "file"
      ? client.downloadFile(auth, { workplaceId: id, fileId: id }, options)
      : client.downloadMailAttachment(
          auth,
          { messageId: id, attachmentId: id },
          options,
        );
  return { download, fetch, transferFetch };
}

for (const kind of ["file", "attachment"] as const) {
  test.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    `${kind}: invalid ceiling %s never requests a grant`,
    async (maxBytes) => {
      const f = fixture(kind);
      await expect(f.download({ maxBytes })).rejects.toThrow(TypeError);
      expect(f.fetch).not.toHaveBeenCalled();
      expect(f.transferFetch).not.toHaveBeenCalled();
    },
  );

  test(`${kind}: oversized metadata rejects before byte transfer`, async () => {
    const f = fixture(kind, 262145);
    await expect(f.download({ maxBytes: 262144 })).rejects.toMatchObject({
      code: "download_too_large",
      status: 0,
      message: "Download exceeds the caller's byte limit",
    });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.transferFetch).not.toHaveBeenCalled();
  });

  test(`${kind}: streaming overflow cancels before retaining excess bytes`, async () => {
    const cancel = vi.fn();
    const f = fixture(
      kind,
      3,
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("ab"));
          controller.enqueue(new TextEncoder().encode("cd"));
        },
        cancel,
      }),
    );
    await expect(f.download({ maxBytes: 3 })).rejects.toMatchObject({
      code: "download_too_large",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test(`${kind}: exact limit succeeds; omitted limit keeps existing behavior`, async () => {
    for (const options of [undefined, { maxBytes: 3 }, { maxBytes: 10 }]) {
      const f = fixture(kind);
      expect((await f.download(options)).bytes).toEqual(
        new TextEncoder().encode("abc"),
      );
      expect(f.transferFetch.mock.calls[0]![1]).toMatchObject({
        redirect: "error",
        credentials: "omit",
      });
      expect(f.transferFetch.mock.calls[0]![1]?.headers).toBeUndefined();
    }
  });

  test.each(["abd", "ab", "abcd"])(
    `${kind}: metadata and hash checks remain independent of the ceiling (%s)`,
    async (body) => {
      const f = fixture(kind, 3, body);
      await expect(f.download({ maxBytes: 10 })).rejects.toMatchObject({
        code: "transfer_interrupted",
      });
    },
  );

  test(`${kind}: interrupted stream cancels and exposes no source error`, async () => {
    const f = fixture(
      kind,
      3,
      new ReadableStream({
        start(controller) {
          controller.error(new Error("secret-grant-sentinel"));
        },
      }),
    );
    await expect(f.download({ maxBytes: 3 })).rejects.toMatchObject({
      code: "transfer_interrupted",
      cause: undefined,
    });
  });

  test(`${kind}: zero rejects nonempty metadata`, async () => {
    const f = fixture(kind);
    await expect(f.download({ maxBytes: 0 })).rejects.toMatchObject({
      code: "download_too_large",
    });
    expect(f.transferFetch).not.toHaveBeenCalled();
  });
}
