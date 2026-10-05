import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { extractPages, ocrAvailable, PdfError } from "./pdf.js";
import { chunkPages } from "./chunker.js";
import { buildBM25, cosine } from "./retrieval.js";
import * as llm from "./llm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 100);
const upload = multer({ dest: path.join(os.tmpdir(), "pdf-rag-uploads"), limits: { fileSize: MAX_MB * 1024 * 1024 } });
const MAX_DOCS = Number(process.env.MAX_DOCS || 20);

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  const docs = new Map(); // in-memory store: id -> { name, chunks, vectors?, bm25 }

  app.get("/api/health", async (_req, res) =>
    res.json({ ok: true, mode: llm.hasKey() ? "openai" : "local", ocr: await ocrAvailable(), maxUploadMb: MAX_MB }));

  const summary = (id, d) => ({ id, name: d.name, pages: d.pages, chunks: d.chunks.length, ocrPages: d.ocrPages, warnings: d.warnings, mode: d.vectors ? "openai" : "local" });

  app.get("/api/docs", (_req, res) => res.json({ docs: [...docs].map(([id, d]) => summary(id, d)) }));

  app.delete("/api/docs/:id", (req, res) => {
    if (!docs.delete(req.params.id)) return res.status(404).json({ error: "Document not found." });
    res.json({ ok: true });
  });

  const uploadOne = (req, res, next) =>
    upload.single("file")(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `File is too large (max ${MAX_MB} MB).` });
      res.status(400).json({ error: err.message });
    });

  app.post("/api/upload", uploadOne, async (req, res) => {
    const tmp = req.file?.path;
    try {
      if (!req.file) return res.status(400).json({ error: "Attach a PDF as form field 'file'." });
      if (docs.size >= MAX_DOCS) throw new PdfError(`Too many documents loaded (max ${MAX_DOCS}). Remove one first.`, 409, "TOO_MANY");
      if (!req.file.size) throw new PdfError("The file is empty.", 422, "EMPTY");
      const name = Buffer.from(req.file.originalname, "latin1").toString("utf8");
      const { pages, ocrPages, warnings } = await extractPages(tmp);
      const chunks = chunkPages(pages);
      if (!chunks.length) throw new PdfError("No extractable text in this PDF.", 422, "NO_TEXT");
      const doc = { name, pages: pages.length, ocrPages, warnings, chunks, bm25: buildBM25(chunks) };
      if (llm.hasKey()) {
        try { doc.vectors = await llm.embed(chunks.map((c) => c.text)); }
        catch (e) { doc.warnings.push("Embedding failed, using keyword search instead: " + e.message); }
      }
      const id = randomUUID();
      docs.set(id, doc);
      res.json(summary(id, doc));
    } catch (e) {
      if (!(e instanceof PdfError)) console.error(e);
      res.status(e.status || 500).json({ error: e.message, code: e.code });
    } finally {
      if (tmp) fs.rm(tmp, { force: true }, () => {});
    }
  });

  app.post("/api/ask", async (req, res) => {
    try {
      const { id, question } = req.body || {};
      const doc = docs.get(id);
      if (!doc) return res.status(404).json({ error: "Document not found. Upload a PDF first." });
      if (!question?.trim()) return res.status(400).json({ error: "Question is empty." });
      let hits;
      if (doc.vectors) {
        const [qv] = await llm.embed([question]);
        hits = doc.chunks
          .map((chunk, i) => ({ chunk, score: cosine(qv, doc.vectors[i]) }))
          .sort((a, b) => b.score - a.score).slice(0, 4);
      } else hits = doc.bm25(question, 4);
      if (!hits.length) return res.json({ answer: "I couldn't find anything about that in the document.", sources: [] });
      const text = llm.hasKey()
        ? await llm.answer(question, hits)
        : "(Local mode, no API key: showing the most relevant passages.)\n\n" + hits.slice(0, 2).map((h) => `${h.chunk.text} (p. ${h.chunk.page})`).join("\n\n");
      res.json({
        answer: text,
        sources: hits.map((h, i) => ({ n: i + 1, page: h.chunk.page, score: Number(h.score.toFixed(3)), text: h.chunk.text })),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  const dist = path.resolve(__dirname, "../../client/dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }
  return app;
}
