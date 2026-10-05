const base = () => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
export const hasKey = () => Boolean(process.env.OPENAI_API_KEY);

async function call(path, body) {
  const res = await fetch(base() + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function embed(texts) {
  const model = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
  const out = [];
  for (let i = 0; i < texts.length; i += 96) {
    const json = await call("/embeddings", { model, input: texts.slice(i, i + 96) });
    out.push(...json.data.map((d) => d.embedding));
  }
  return out;
}

export async function answer(question, hits) {
  const context = hits.map((h, i) => `[${i + 1}] (page ${h.chunk.page}) ${h.chunk.text}`).join("\n\n");
  const json = await call("/chat/completions", {
    model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: "Answer using ONLY the numbered context excerpts. Cite sources like [1] or [2]. If the answer is not in the context, say you could not find it in the document." },
      { role: "user", content: `Context:\n${context}\n\nQuestion: ${question}` },
    ],
  });
  return json.choices[0].message.content;
}
