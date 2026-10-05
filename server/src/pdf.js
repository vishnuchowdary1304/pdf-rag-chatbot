import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const MIN_TEXT = 20; // pages with fewer characters are treated as scanned/image pages

export class PdfError extends Error {
  constructor(message, status = 422, code = "PDF_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let ocrChecked;
export async function ocrAvailable() {
  if (ocrChecked === undefined) {
    try {
      await run("tesseract", ["--version"]);
      await run("pdftoppm", ["-v"]);
      ocrChecked = true;
    } catch { ocrChecked = false; }
  }
  return ocrChecked;
}

function mapError(e) {
  const msg = String(e?.message || e);
  if (e?.name === "PasswordException" || /password|encrypt/i.test(msg))
    return new PdfError("This PDF is password-protected. Remove the password and upload it again.", 422, "ENCRYPTED");
  if (/Invalid PDF|XRef|bad XRef|Missing PDF|FormatError|InvalidPDF|end of file|stream/i.test(msg))
    return new PdfError("This file looks corrupted or is not a valid PDF.", 422, "CORRUPT");
  return new PdfError(`Could not read this PDF: ${msg}`, 422, "UNREADABLE");
}

const worker = fileURLToPath(new URL("./textworker.js", import.meta.url));

// Extract the text layer per page in an isolated child process.
async function textPages(filePath) {
  let out;
  try {
    ({ stdout: out } = await run(process.execPath, [worker, filePath], { timeout: 5 * 60000, maxBuffer: 512 * 1024 * 1024 }));
  } catch (e) {
    throw e.killed ? new PdfError("Reading this PDF took too long.", 422, "TIMEOUT") : mapError(e);
  }
  const res = JSON.parse(out);
  if (res.error) throw mapError({ name: res.name, message: res.error });
  if (!res.pages.length) throw new PdfError("This PDF has no pages.", 422, "EMPTY");
  return res.pages;
}

async function ocrPage(file, n, dpi, lang) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-"));
  try {
    const base = path.join(dir, "p");
    await run("pdftoppm", ["-f", String(n), "-l", String(n), "-r", String(dpi), "-png", "-singlefile", file, base], { timeout: 60000 });
    const { stdout } = await run("tesseract", [base + ".png", "stdout", "-l", lang], { timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
    return stdout.trim();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/**
 * Returns { pages, ocrPages, skippedOcr, warnings }.
 * Pages without a text layer are OCR'd when tesseract + pdftoppm are installed.
 */
export async function extractPages(filePath, opts = {}) {
  const maxOcr = opts.maxOcrPages ?? Number(process.env.MAX_OCR_PAGES || 100);
  const lang = opts.lang ?? (process.env.OCR_LANG || "eng");
  const dpi = Number(process.env.OCR_DPI || 200);
  const buffer = fs.readFileSync(filePath);
  if (buffer.subarray(0, 1024).toString("latin1").indexOf("%PDF-") === -1)
    throw new PdfError("This file is not a PDF (missing PDF header).", 415, "NOT_PDF");

  const pages = await textPages(filePath);
  const blank = pages.filter((p) => p.text.replace(/\s/g, "").length < MIN_TEXT);
  const warnings = [];
  let ocrPages = 0, skippedOcr = 0;

  if (blank.length) {
    if (opts.ocr !== false && (await ocrAvailable())) {
      const todo = blank.slice(0, maxOcr);
      skippedOcr = blank.length - todo.length;
      for (const p of todo) {
        try {
          const t = await ocrPage(filePath, p.page, dpi, lang);
          if (t.replace(/\s/g, "").length >= 1) { p.text = t; ocrPages++; }
        } catch (e) { warnings.push(`OCR failed on page ${p.page}`); }
      }
      if (skippedOcr) warnings.push(`OCR limit reached: ${skippedOcr} scanned pages were skipped (raise MAX_OCR_PAGES).`);
    } else if (blank.length === pages.length) {
      throw new PdfError(
        "This looks like a scanned PDF (no text layer) and OCR is not installed on the server. Install tesseract-ocr and poppler-utils (see README), then upload again.",
        422, "NEEDS_OCR");
    } else {
      warnings.push(`${blank.length} page(s) have no text layer and were skipped (OCR not installed).`);
    }
  }
  if (!pages.some((p) => p.text.replace(/\s/g, "").length))
    throw new PdfError("No readable text found in this PDF, even after OCR.", 422, "NO_TEXT");
  return { pages, ocrPages, skippedOcr, warnings };
}
