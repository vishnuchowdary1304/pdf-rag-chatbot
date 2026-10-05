// Two retrievers: OpenAI embeddings (if key set) or local BM25 (no key needed).
const tokenize = (s) => s.toLowerCase().match(/[a-z0-9]+/g) || [];
const STOP = new Set("a an the and or of to in is are was were be for on with as at by it this that from what which who how when where why do does did".split(" "));
const terms = (s) => tokenize(s).filter((t) => !STOP.has(t));

export function buildBM25(chunks) {
  const docs = chunks.map((c) => terms(c.text));
  const N = docs.length;
  const avg = docs.reduce((a, d) => a + d.length, 0) / (N || 1);
  const df = new Map();
  docs.forEach((d) => new Set(d).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
  return function search(query, k = 4) {
    const q = terms(query);
    const k1 = 1.5, b = 0.75;
    const scored = docs.map((d, i) => {
      const tf = new Map();
      d.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
      let score = 0;
      for (const t of q) {
        const f = tf.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
        score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg));
      }
      return { chunk: chunks[i], score };
    });
    return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
  };
}

export const cosine = (a, b) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};
