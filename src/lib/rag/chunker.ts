// V1 chunker: paragraph-aware, target ~1000 chars per chunk, no overlap.
// Replace with a tokenizer-based chunker when we hit retrieval-quality issues.

const TARGET_CHARS = 1000;
const MIN_CHARS = 200;

export function chunk(text: string): string[] {
  // Normalize line endings, then split on blank-line paragraph boundaries.
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buf = "";

  const flush = () => {
    const trimmed = buf.trim();
    if (trimmed) chunks.push(trimmed);
    buf = "";
  };

  for (const p of paragraphs) {
    // If a single paragraph is huge, hard-split it on sentence-ish boundaries.
    if (p.length > TARGET_CHARS * 2) {
      flush();
      const sentences = p.split(/(?<=[.!?])\s+/);
      let sbuf = "";
      for (const s of sentences) {
        if ((sbuf + " " + s).length > TARGET_CHARS && sbuf.length >= MIN_CHARS) {
          chunks.push(sbuf.trim());
          sbuf = s;
        } else {
          sbuf = sbuf ? sbuf + " " + s : s;
        }
      }
      if (sbuf.trim()) chunks.push(sbuf.trim());
      continue;
    }

    if (buf.length + p.length + 2 > TARGET_CHARS && buf.length >= MIN_CHARS) {
      flush();
    }
    buf = buf ? buf + "\n\n" + p : p;
  }
  flush();
  return chunks;
}
