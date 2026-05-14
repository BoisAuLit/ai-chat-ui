import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { embedQuery } from "@/lib/rag/embeddings";
import { getDoc } from "@/lib/rag/store";
import { retrieveTopK, type Retrieved } from "@/lib/rag/retrieve";

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
        `[chunk ${r.index} | score=${r.score.toFixed(3)}]\n${r.chunk}`,
    )
    .join("\n\n---\n\n");
  return `${BASE_SYSTEM}\n\nRetrieved document chunks (most relevant first):\n\n${contextBlock}`;
}

export async function POST(req: Request): Promise<Response> {
  const body: {
    messages: UIMessage[];
    docHash?: string;
    model?: string;
    topK?: number;
  } = await req.json();

  const docHash = body.docHash;
  if (!docHash) {
    return Response.json(
      { error: "Missing 'docHash' — index a document first" },
      { status: 400 },
    );
  }

  const doc = getDoc(docHash);
  if (!doc) {
    return Response.json(
      {
        error: "Document not found (likely cold-start eviction). Re-index it.",
        docHash,
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
      retrieved = retrieveTopK(doc, qEmb, k);
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

  // Stream the model output as text, with retrieved chunks in a header so the UI
  // can render them. Use a custom JSON header line + plain text stream below.
  // For simplicity we use toTextStreamResponse() and ship retrieval as a header.
  const response = result.toTextStreamResponse();
  response.headers.set(
    "x-rag-retrieved",
    encodeURIComponent(
      JSON.stringify(
        retrieved.map((r) => ({
          index: r.index,
          score: r.score,
          // Send a snippet, not the full chunk, to keep header small.
          snippet: r.chunk.slice(0, 240),
        })),
      ),
    ),
  );
  return response;
}
