// Split page texts into overlapping chunks, keeping the page number for citations.
export function chunkPages(pages, { size = 800, overlap = 150 } = {}) {
  const chunks = [];
  for (const { page, text } of pages) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) continue;
    let start = 0;
    while (start < clean.length) {
      let end = Math.min(start + size, clean.length);
      if (end < clean.length) {
        // prefer to cut at a sentence end or space
        const cut = Math.max(clean.lastIndexOf(". ", end), clean.lastIndexOf(" ", end));
        if (cut > start + size * 0.5) end = cut + 1;
      }
      const piece = clean.slice(start, end).trim();
      if (piece) chunks.push({ id: chunks.length, page, text: piece });
      if (end >= clean.length) break;
      start = Math.max(end - overlap, start + 1);
    }
  }
  return chunks;
}
