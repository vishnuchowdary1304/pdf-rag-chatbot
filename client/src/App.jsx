import { useEffect, useRef, useState } from "react";

// XHR instead of fetch so we get real upload progress.
function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress({ phase: "upload", pct: Math.round((e.loaded / e.total) * 100) });
    xhr.upload.onload = () => onProgress({ phase: "processing", pct: 100 });
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      xhr.status >= 200 && xhr.status < 300 ? resolve(data) : reject(new Error(data.error || `Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error. Is the server running?"));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export default function App() {
  const [docs, setDocs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [chats, setChats] = useState({}); // docId -> messages
  const [jobs, setJobs] = useState([]); // {key, name, phase, pct, error}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [info, setInfo] = useState(null);
  const endRef = useRef(null);
  const doc = docs.find((d) => d.id === activeId);
  const messages = chats[activeId] || [];

  useEffect(() => {
    fetch("/api/docs").then((r) => r.json()).then((d) => { setDocs(d.docs); if (d.docs[0]) setActiveId(d.docs[0].id); }).catch(() => {});
    fetch("/api/health").then((r) => r.json()).then(setInfo).catch(() => {});
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, busy]);

  async function handleFiles(fileList) {
    const files = [...fileList];
    for (const file of files) {
      const key = crypto.randomUUID();
      const patch = (p) => setJobs((j) => j.map((x) => (x.key === key ? { ...x, ...p } : x)));
      setJobs((j) => [...j, { key, name: file.name, phase: "upload", pct: 0 }]);
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { patch({ phase: "error", error: "Not a PDF file." }); continue; }
      if (info?.maxUploadMb && file.size > info.maxUploadMb * 1048576) { patch({ phase: "error", error: `Too large (max ${info.maxUploadMb} MB).` }); continue; }
      try {
        const d = await uploadFile(file, patch);
        setDocs((ds) => [...ds, d]);
        setActiveId(d.id);
        setJobs((j) => j.filter((x) => x.key !== key));
      } catch (err) { patch({ phase: "error", error: err.message }); }
    }
  }

  async function removeDoc(id) {
    await fetch(`/api/docs/${id}`, { method: "DELETE" }).catch(() => {});
    setDocs((ds) => { const rest = ds.filter((d) => d.id !== id); if (id === activeId) setActiveId(rest[0]?.id ?? null); return rest; });
    setChats((c) => { const { [id]: _, ...rest } = c; return rest; });
  }

  async function ask(e) {
    e.preventDefault();
    const question = input.trim();
    if (!question || !doc || busy) return;
    const id = doc.id;
    const add = (m) => setChats((c) => ({ ...c, [id]: [...(c[id] || []), m] }));
    setInput(""); setBusy(true); setError("");
    add({ role: "user", text: question });
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, question }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      add({ role: "bot", text: data.answer, sources: data.sources });
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  return (
    <div className="app"
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}>
      <header>
        <h1>PDF Chat</h1>
        <label className="upload">
          Upload PDFs
          <input type="file" accept="application/pdf,.pdf" multiple onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} hidden />
        </label>
      </header>
      {info && <p className="meta">{info.mode} mode · OCR for scanned PDFs: {info.ocr ? "on" : "off (install tesseract + poppler)"} · max {info.maxUploadMb} MB</p>}
      {drag && <div className="drop">Drop PDFs to upload</div>}

      {jobs.map((j) => (
        <div key={j.key} className={`job ${j.phase === "error" ? "bad" : ""}`}>
          <span>{j.name}</span>
          {j.phase === "error" ? (
            <span>{j.error} <button onClick={() => setJobs((x) => x.filter((y) => y.key !== j.key))}>dismiss</button></span>
          ) : j.phase === "processing" ? (
            <span>Reading text (OCR on scanned pages can take a while)...</span>
          ) : (
            <span><progress value={j.pct} max="100" /> {j.pct}%</span>
          )}
        </div>
      ))}

      {docs.length > 0 && (
        <div className="tabs">
          {docs.map((d) => (
            <span key={d.id} className={`tab ${d.id === activeId ? "on" : ""}`} onClick={() => setActiveId(d.id)}>
              {d.name}
              <button title="Remove" onClick={(ev) => { ev.stopPropagation(); removeDoc(d.id); }}>×</button>
            </span>
          ))}
        </div>
      )}
      {doc && (
        <p className="meta">
          {doc.pages} pages · {doc.chunks} chunks{doc.ocrPages ? ` · ${doc.ocrPages} pages read with OCR` : ""}
          {doc.warnings?.map((w, i) => <span key={i} className="warn"> ⚠ {w}</span>)}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <main>
        {!doc && <p className="hint">Upload or drop one or more PDFs (text or scanned) to start asking questions.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <p>{m.text}</p>
            {m.sources?.length > 0 && (
              <details>
                <summary>Sources ({m.sources.map((s) => `[${s.n}] p.${s.page}`).join(", ")})</summary>
                {m.sources.map((s) => (<blockquote key={s.n}><b>[{s.n}] page {s.page}</b><br />{s.text}</blockquote>))}
              </details>
            )}
          </div>
        ))}
        {busy && <p className="hint">Working...</p>}
        <div ref={endRef} />
      </main>
      <form onSubmit={ask}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={doc ? `Ask about ${doc.name}...` : "Upload a PDF first"} disabled={!doc} />
        <button disabled={!doc || busy}>Ask</button>
      </form>
    </div>
  );
}
