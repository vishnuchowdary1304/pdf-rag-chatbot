# PDF Chat (RAG)

Upload a PDF, ask questions, get answers with page citations. React frontend, Node.js (Express) backend.

## How it works
1. **Upload**: the server extracts text page by page (`pdf-parse`).
2. **Chunk**: each page is split into ~800 character overlapping chunks that remember their page number (`server/src/chunker.js`).
3. **Index**:
   - With `OPENAI_API_KEY`: every chunk gets an embedding (`text-embedding-3-small`).
   - Without a key: a local BM25 keyword index is built (no network, no cost).
4. **Retrieve**: the question is embedded (or BM25-scored) and the top 4 chunks are picked (cosine similarity / BM25).
5. **Answer**: with a key, a chat model answers using only those chunks and cites `[1]`, `[2]`. Without a key, the best passages are shown directly. Sources with page numbers appear under each answer.

Documents are kept in memory (restart clears them).

## Handling any PDF
- **Multiple PDFs**: upload several at once (button or drag and drop). Each is a tab with its own chat; remove with the x.
- **Large files**: streamed to a temp file (not held in RAM), default limit 100 MB (`MAX_UPLOAD_MB`). Real upload progress bar.
- **Scanned / image-only pages**: pages with no text layer are OCR'd with Tesseract. Needs the `tesseract` and `pdftoppm` programs on the server (`sudo apt install tesseract-ocr poppler-utils`, or `brew install tesseract poppler`). Without them, normal PDFs still work and scanned ones give a clear message. `/api/health` and the UI show whether OCR is on.
- **Bad files**: clear errors for non-PDFs, empty files, corrupted files, password-protected PDFs, too-large files, and PDFs with no readable text. A broken PDF is parsed in a separate process, so it cannot crash or confuse the server.
- Mixed PDFs (some text pages, some scans) are handled page by page.

## Run it
Requires Node 18+.

```bash
npm run install:all
cp server/.env.example server/.env   # optional: add OPENAI_API_KEY
npm run dev                          # client http://localhost:5173, API :3001
```

Or production style (one server): `npm start` then open http://localhost:3001.

## Environment variables (`server/.env`)
| Name | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | empty | Enables semantic embeddings + generated answers. Never commit it. |
| `OPENAI_EMBED_MODEL` | `text-embedding-3-small` | Embedding model |
| `OPENAI_CHAT_MODEL` | `gpt-4o-mini` | Answer model |
| `OPENAI_BASE_URL` | OpenAI | Any OpenAI-compatible endpoint |
| `PORT` | `3001` | API port |
| `MAX_UPLOAD_MB` | `100` | Max PDF size |
| `MAX_DOCS` | `20` | Max PDFs loaded at once |
| `MAX_OCR_PAGES` | `100` | Max scanned pages OCR'd per PDF |
| `OCR_LANG` | `eng` | Tesseract language(s), e.g. `eng+hin` (language data must be installed) |
| `OCR_DPI` | `200` | Render resolution for OCR |

## Test
`npm test` covers: normal upload and cited answer, multiple PDFs, a generated 300-page PDF, password-protected, corrupt, empty and fake PDFs, and a scanned PDF (`samples/scanned.pdf`, OCR when installed). Some fixtures are generated with Ghostscript and skipped if it is missing.

## API
- `POST /api/upload` (multipart `file`) -> `{ id, name, pages, chunks, ocrPages, warnings, mode }`; errors are `{ error, code }`
- `GET /api/docs`, `DELETE /api/docs/:id`
- `POST /api/ask` `{ id, question }` -> `{ answer, sources: [{ n, page, score, text }] }`

## Structure
```
server/src/  app.js (routes) pdf.js textworker.js chunker.js retrieval.js llm.js
client/src/  App.jsx styles.css
samples/     sample.pdf scanned.pdf
```
🏗️ Architecture:

PDF
 ↓
Text Extraction
 ↓
Chunking
 ↓
 ┌─────────────────┐
 │                 │
 ▼                 ▼
BM25          Embeddings
 │                 │
 │                 ▼
 │          Vector Similarity
 │                 │
 └────────┬────────┘
          ▼
    Relevant Chunks
          │
          ▼
        LLM
          │
          ▼
       Answer
          │
          ▼
    Page Sources
    
🛠️ Tech Stack:
Frontend: React, Vite, JavaScript, CSS
Backend: Node.js, Express.js, Multer, PDF parsing
RAG / Retrieval: BM25, embeddings, cosine similarity, text chunking
AI: OpenAI-compatible API
📂 Project Structure:

pdf-rag-chat/
├── client/
├── samples/
├── server/
│   └── src/
├── .gitignore
├── package.json
└── README.md
