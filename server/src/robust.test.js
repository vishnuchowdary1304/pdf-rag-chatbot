import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { ocrAvailable } from "./pdf.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = path.resolve(here, "../../samples/sample.pdf");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rag-fixtures-"));
const has = (cmd, arg = "-v") => { try { execFileSync(cmd, [arg], { stdio: "ignore" }); return true; } catch { return false; } };
const haveGs = has("gs");

let server, base;
test.before(() => { delete process.env.OPENAI_API_KEY; server = createApp().listen(0); base = `http://localhost:${server.address().port}`; });
test.after(() => server.close());

async function up(buf, name, type = "application/pdf") {
  const form = new FormData();
  form.append("file", new Blob([buf], { type }), name);
  const r = await fetch(base + "/api/upload", { method: "POST", body: form });
  return { status: r.status, body: await r.json() };
}
async function ask(id, question) {
  return (await fetch(base + "/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, question }) })).json();
}

test("rejects non-PDF content, empty and corrupt files with clear errors", async () => {
  let r = await up(Buffer.from("hello world, not a pdf"), "fake.pdf");
  assert.strictEqual(r.status, 415); assert.match(r.body.error, /not a PDF/i);
  r = await up(Buffer.alloc(0), "empty.pdf");
  assert.strictEqual(r.status, 422);
  const corrupt = Buffer.concat([fs.readFileSync(sample).subarray(0, 400), Buffer.from("garbage".repeat(50))]);
  r = await up(corrupt, "corrupt.pdf");
  assert.ok(r.status >= 400 && r.body.error, JSON.stringify(r));
});

test("multiple PDFs can be loaded, listed, queried separately and deleted", async () => {
  const a = await up(fs.readFileSync(sample), "a.pdf");
  const b = await up(fs.readFileSync(sample), "b.pdf");
  assert.ok(a.body.id && b.body.id && a.body.id !== b.body.id, JSON.stringify([a,b]));
  const list = await (await fetch(base + "/api/docs")).json();
  assert.ok(list.docs.length >= 2);
  const r = await ask(b.body.id, "octopuses hearts");
  assert.ok(r.sources.length > 0);
  assert.strictEqual((await fetch(base + `/api/docs/${a.body.id}`, { method: "DELETE" })).status, 200);
  assert.strictEqual((await ask(a.body.id, "x")).error?.includes("not found"), true);
});

test("large many-page PDF uploads", { skip: !haveGs, timeout: 120000 }, async () => {
  const ps = path.join(tmp, "big.ps");
  let body = "/Helvetica findfont 12 scalefont setfont\n";
  for (let i = 1; i <= 300; i++) body += `72 700 moveto (Page ${i} discusses topic${i} and the unique word zebra${i}. ${"Lorem ipsum dolor sit amet. ".repeat(20)}) show showpage\n`;
  fs.writeFileSync(ps, body);
  const out = path.join(tmp, "big.pdf");
  execFileSync("gs", ["-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=pdfwrite", `-sOutputFile=${out}`, ps]);
  const r = await up(fs.readFileSync(out), "big.pdf");
  assert.strictEqual(r.body.pages, 300, JSON.stringify(r.body));
  const a = await ask(r.body.id, "zebra217");
  assert.strictEqual(a.sources[0].page, 217);
});

test("password-protected PDF gives a clear error", { skip: !haveGs }, async () => {
  const out = path.join(tmp, "enc.pdf");
  execFileSync("gs", ["-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=pdfwrite", "-sOwnerPassword=o", "-sUserPassword=u", `-sOutputFile=${out}`, sample]);
  const r = await up(fs.readFileSync(out), "enc.pdf");
  assert.strictEqual(r.status, 422);
  assert.match(r.body.error, /password/i);
});

test("scanned (image-only) PDF is read with OCR, or gives a clear message without it", { timeout: 120000 }, async () => {
  const scanned = path.resolve(here, "../../samples/scanned.pdf"); // image only, no text layer
  const r = await up(fs.readFileSync(scanned), "scanned.pdf");
  if (await ocrAvailable()) {
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.ocrPages >= 1);
    const a = await ask(r.body.id, "octopuses hearts");
    assert.ok(a.sources.length > 0);
  } else {
    assert.strictEqual(r.body.code, "NEEDS_OCR");
  }
});
