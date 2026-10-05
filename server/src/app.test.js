import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunkPages } from "./chunker.js";
import { createApp } from "./app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = path.resolve(here, "../../samples/sample.pdf");

test("chunker keeps page numbers and overlaps", () => {
  const c = chunkPages([{ page: 3, text: "word ".repeat(500) }], { size: 300, overlap: 50 });
  assert.ok(c.length > 3);
  assert.ok(c.every((x) => x.page === 3));
});

test("upload then ask returns cited page", async () => {
  delete process.env.OPENAI_API_KEY;
  const server = createApp().listen(0);
  const base = `http://localhost:${server.address().port}`;
  try {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(sample)], { type: "application/pdf" }), "sample.pdf");
    const up = await (await fetch(base + "/api/upload", { method: "POST", body: form })).json();
    assert.ok(up.id, JSON.stringify(up));
    const r = await (await fetch(base + "/api/ask", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: up.id, question: "Where do octopuses keep their hearts count?" }),
    })).json();
    assert.ok(r.sources.length > 0);
    assert.strictEqual(r.sources[0].page, 2);
  } finally { server.close(); }
});
