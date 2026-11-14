import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentWorkplace } from "../src/client.js";
import { AgentWorkplaceInputError } from "../src/errors.js";
import { parseIgnoringUnknownFields } from "../src/unknown-fields.js";

const leaf = z.object({ a: z.string() }).strict();
const parser =
  <T>(schema: z.ZodType<T>) =>
  (value: unknown) =>
    schema.parse(value);

describe("parseIgnoringUnknownFields", () => {
  it("removes unknown keys at every depth, including inside arrays", () => {
    const schema = z.object({ inner: leaf, list: z.array(leaf) }).strict();
    const body = {
      inner: { a: "1", added: 1 },
      list: [{ a: "2" }, { a: "3", added: 2 }],
      top: 3,
    };
    expect(parseIgnoringUnknownFields(parser(schema), body)).toStrictEqual({
      inner: { a: "1" },
      list: [{ a: "2" }, { a: "3" }],
    });
    // The caller's value is not modified.
    expect(body.top).toBe(3);
    expect(body.inner).toHaveProperty("added");
  });

  it("removes unknown keys inside discriminated and plain unions", () => {
    const tagged = z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("x"), x: leaf }).strict(),
      z.object({ kind: z.literal("y"), y: z.number() }).strict(),
    ]);
    expect(
      parseIgnoringUnknownFields(parser(tagged), {
        kind: "x",
        x: { a: "1", added: 1 },
        added: 2,
      }),
    ).toStrictEqual({ kind: "x", x: { a: "1" } });

    const plain = z.object({
      items: z.array(
        z.union([
          z.object({ p: z.string() }).strict(),
          z.object({ q: leaf }).strict(),
        ]),
      ),
    });
    // One branch fails only on unknown keys; its relative paths resolve
    // under the union's position.
    expect(
      parseIgnoringUnknownFields(parser(plain), {
        items: [{ q: { a: "1", added: 1 } }, { p: "s", added: 2 }],
      }),
    ).toStrictEqual({ items: [{ q: { a: "1" } }, { p: "s" }] });
  });

  it("still applies refinements and transforms after removal", () => {
    const refined = z
      .object({ r: z.string() })
      .strict()
      .refine((value) => value.r !== "bad");
    expect(() =>
      parseIgnoringUnknownFields(parser(refined), { r: "bad", added: 1 }),
    ).toThrow();
    const transformed = z
      .object({ t: z.string() })
      .strict()
      .transform((value) => value.t.length);
    expect(
      parseIgnoringUnknownFields(parser(transformed), { t: "abc", added: 1 }),
    ).toBe(3);
  });

  it("fails on unknown values, wrong types and unions no branch can accept", () => {
    const state = z.object({ state: z.enum(["pending", "done"]) }).strict();
    expect(() =>
      parseIgnoringUnknownFields(parser(state), {
        state: "paused",
        added: 1,
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      parseIgnoringUnknownFields(parser(leaf), { a: 1, added: 1 }),
    ).toThrow(z.ZodError);
    const union = z.union([
      z.object({ p: z.string() }).strict(),
      z.object({ q: leaf }).strict(),
    ]);
    expect(() => parseIgnoringUnknownFields(parser(union), { z: 1 })).toThrow(
      z.ZodError,
    );
  });

  it("removes a parsed __proto__ key as an ordinary own property", () => {
    const body: unknown = JSON.parse('{"a":"1","__proto__":{"polluted":true}}');
    const parsed = parseIgnoringUnknownFields(parser(leaf), body);
    expect(parsed).toStrictEqual({ a: "1" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rethrows parser errors that are not validation failures", () => {
    const failure = new Error("not a schema problem");
    expect(() =>
      parseIgnoringUnknownFields(() => {
        throw failure;
      }, {}),
    ).toThrow(failure);
  });
});

describe("unknownResponseFields", () => {
  const fetch = async () => Response.json({ acknowledged: true, added: 1 });

  it("ignores unknown fields by default and rejects them on request", async () => {
    await expect(
      new AgentWorkplace({ fetch }).trashMailMessage(
        { apiKey: "key" },
        "message",
      ),
    ).resolves.toStrictEqual({ acknowledged: true });
    await expect(
      new AgentWorkplace({
        fetch,
        unknownResponseFields: "reject",
      }).trashMailMessage({ apiKey: "key" }, "message"),
    ).rejects.toMatchObject({ status: 200, code: "invalid_response" });
  });

  it("refuses an unsupported setting", () => {
    expect(
      () =>
        new AgentWorkplace({
          fetch,
          unknownResponseFields: "warn" as "ignore",
        }),
    ).toThrow(AgentWorkplaceInputError);
  });
});
