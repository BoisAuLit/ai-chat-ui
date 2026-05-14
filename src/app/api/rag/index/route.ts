import { chunk } from "@/lib/rag/chunker";
import { embedTexts } from "@/lib/rag/embeddings";
import { hashText, putDoc, getDoc } from "@/lib/rag/store";

export const maxDuration = 60;

const MAX_CHARS = 200_000;

export async function POST(req: Request): Promise<Response> {
  const body: { text?: string } = await req.json();
  const text = (body.text || "").trim();

  if (!text) {
    return Response.json({ error: "Missing 'text'" }, { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    return Response.json(
      { error: `Document too large (${text.length} > ${MAX_CHARS} chars)` },
      { status: 413 },
    );
  }

  const hash = hashText(text);

  // Idempotent: if we've already indexed this exact text, skip re-embedding.
  const existing = getDoc(hash);
  if (existing) {
    return Response.json({
      hash,
      n_chunks: existing.chunks.length,
      n_chars: existing.n_chars,
      cached: true,
    });
  }

  const chunks = chunk(text);
  if (chunks.length === 0) {
    return Response.json({ error: "No chunks produced" }, { status: 400 });
  }

  let embeddings: number[][];
  try {
    embeddings = await embedTexts(chunks);
  } catch (e) {
    return Response.json(
      {
        error: "Embedding API failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  putDoc({
    hash,
    chunks,
    embeddings,
    indexed_at: new Date().toISOString(),
    n_chars: text.length,
  });

  return Response.json({
    hash,
    n_chunks: chunks.length,
    n_chars: text.length,
    cached: false,
  });
}
