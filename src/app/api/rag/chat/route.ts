import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { embedQuery } from "@/lib/rag/embeddings";
import { getDocsOrLatest } from "@/lib/rag/store";
import { retrieveTopK, retrieveTopKMulti, type Retrieved } from "@/lib/rag/retrieve";

export const maxDuration = 60;

const ALLOWED_MODELS = new Set([
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-7",
]);
const DEFAULT_MODEL = "claude-sonnet-4-6";

const BASE_SYSTEM = `You are a helpful assistant grounded in the indexed document.

When answering, only use information from the supplied document chunks. If the answer is not in the chunks, say "I don't see that in the indexed document." Do not invent facts.

When you cite something, refer to it as "according to chunk N" using the index labels [chunk N] supplied below.`;

function buildSystemWithContext(retrieved: Retrieved[]): string {
  if (retrieved.length === 0) return BASE_SYSTEM;
  const contextBlock = retrieved
    .map(
      (r) =>
        `[chunk ${r.index}${r.doc_hash ? ` from doc ${r.doc_hash}` : ""} | score=${r.score.toFixed(3)}]\n${r.chunk}`,
    )
    .join("\n\n---\n\n");
  return `${BASE_SYSTEM}\n\nRetrieved document chunks (most relevant first, possibly from multiple indexed documents):\n\n${contextBlock}`;
}

export async function POST(req: Request): Promise<Response> {
  const body: {
    messages: UIMessage[];
    docHash?: string;
    docHashes?: string[];
    model?: string;
    topK?: number;
  } = await req.json();

  // Resolve which docs to retrieve from. Priority:
  //   1. body.docHashes (multi-doc) if provided and non-empty
  //   2. body.docHash (single-doc, legacy) if provided
  //   3. fall back to latest indexed doc
  const requestedHashes = (body.docHashes && body.docHashes.length > 0)
    ? body.docHashes
    : body.docHash
    ? [body.docHash]
    : [];

  const docs = await getDocsOrLatest(requestedHashes);
  if (docs.length === 0) {
    return Response.json(
      {
        error: "No indexed documents found. Index at least one document first.",
        requestedHashes,
      },
      { status: 404 },
    );
  }

  // If specific hashes were requested but some are missing, return a helpful error
  if (requestedHashes.length > 0 && docs.length < requestedHashes.length) {
    const found = new Set(docs.map((d) => d.hash));
    const missing = requestedHashes.filter((h) => !found.has(h));
    return Response.json(
      {
        error: "Some requested documents were not found (likely cold-start eviction). Re-index them.",
        missing,
      },
      { status: 404 },
    );
  }

  const model =
    body.model && ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL;
  const k = body.topK && body.topK > 0 && body.topK <= 8 ? body.topK : 4;

  // Use the latest user message as the retrieval query.
  const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
  const queryText =
    lastUser?.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join(" ") ?? "";

  let retrieved: Retrieved[] = [];
  if (queryText.trim()) {
    try {
      const qEmb = await embedQuery(queryText);
      retrieved = docs.length === 1
        ? retrieveTopK(docs[0], qEmb, k).map((r) => ({ ...r, doc_hash: docs[0].hash }))
        : retrieveTopKMulti(docs, qEmb, k);
    } catch (e) {
      return Response.json(
        {
          error: "Query embedding failed",
          detail: e instanceof Error ? e.message : String(e),
        },
        { status: 502 },
      );
    }
  }

  const result = streamText({
    model: anthropic(model),
    system: buildSystemWithContext(retrieved),
    messages: await convertToModelMessages(body.messages),
  });

  const response = result.toTextStreamResponse();
  response.headers.set(
    "x-rag-retrieved",
    encodeURIComponent(
      JSON.stringify(
        retrieved.map((r) => ({
          index: r.index,
          score: r.score,
          snippet: r.chunk.slice(0, 240),
          doc_hash: r.doc_hash,
        })),
      ),
    ),
  );
  response.headers.set(
    "x-rag-doc-count",
    String(docs.length),
  );
  return response;
}
