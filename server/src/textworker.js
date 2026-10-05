// Runs in a child process so a malformed PDF can never poison the server's PDF parser state.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import fs from "node:fs";

const pages = [];
try {
  await pdfParse(fs.readFileSync(process.argv[2]), {
    max: 0,
    pagerender: async (pageData) => {
      let text = "";
      try {
        const content = await pageData.getTextContent();
        let lastY, lastEnd;
        for (const item of content.items) {
          const y = item.transform[5], x = item.transform[4];
          if (lastY === undefined) text += item.str;
          else if (Math.abs(lastY - y) < 2) {
            // same line: some producers (e.g. Google Docs) emit words without spaces, so add one when there is a visible gap
            const gap = x - lastEnd;
            const needs = gap > 1 && !/\s$/.test(text) && !/^\s/.test(item.str);
            text += (needs ? " " : "") + item.str;
          } else text += "\n" + item.str;
          lastY = y; lastEnd = x + (item.width || 0);
        }
      } catch { /* leave page empty; OCR may recover it */ }
      pages.push({ page: pages.length + 1, text });
      return text;
    },
  });
  process.stdout.write(JSON.stringify({ pages }));
} catch (e) {
  process.stdout.write(JSON.stringify({ error: String(e?.message || e), name: e?.name }));
}
