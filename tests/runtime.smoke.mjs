import assert from "node:assert/strict";
import { AgentWorkplace } from "../dist/index.js";

const client = new AgentWorkplace({
  baseUrl: "https://api.example.test",
  fetch: async () =>
    new Response(JSON.stringify({ status: "ok" }), {
      headers: { "content-type": "application/json" },
    }),
});
assert.deepEqual(await client.health(), { status: "ok" });
