import { tool } from "ai";
import { z } from "zod";
import { embedQuery } from "@/lib/rag/embeddings";
import { getLatestDoc } from "@/lib/rag/store";
import { retrieveTopK } from "@/lib/rag/retrieve";

// ─────────────────────────────────────────────────────────────────────────────
// calculator
// ─────────────────────────────────────────────────────────────────────────────

const SAFE_EXPR = /^[0-9+\-*/().\s%]+$/;

export const calculatorTool = tool({
  description:
    "Evaluate a math expression. Supports +, -, *, /, %, parentheses. " +
    "Use this when the user's question requires arithmetic.",
  inputSchema: z.object({
    expression: z
      .string()
      .describe("A math expression like '(2 + 3) * 4' or '17 % 5'."),
  }),
  execute: async ({ expression }) => {
    if (!SAFE_EXPR.test(expression)) {
      return {
        error:
          "Invalid characters. Only digits, whitespace, and + - * / % ( ) are allowed.",
      };
    }
    try {
      // Safe because input is regex-validated; no identifiers can be referenced.
      const fn = new Function(`return (${expression})`) as () => unknown;
      const result = fn();
      if (typeof result !== "number" || !Number.isFinite(result)) {
        return { error: "Expression did not evaluate to a finite number." };
      }
      return { result, expression };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// fetch_url
// ─────────────────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 200_000;
const MAX_TEXT_OUT_CHARS = 15_000;

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h === "::1") return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  return false;
}

function htmlToText(html: string): string {
  let text = html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

export const fetchUrlTool = tool({
  description:
    "Fetch a public web URL and return its text content. " +
    "Use this when the user asks something requiring current or external information " +
    "(news, prices, definitions, anything not in your training).",
  inputSchema: z.object({
    url: z
      .string()
      .describe("Full URL including https:// — must be public, not local."),
  }),
  execute: async ({ url }) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { error: "Invalid URL" };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { error: "Only http/https URLs are allowed." };
    }
    if (isBlockedHost(parsed.hostname)) {
      return { error: "Refused: target host is private/internal." };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "user-agent": "ai-chat-ui-agent/1.0" },
        redirect: "follow",
      });
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_RESPONSE_BYTES) {
        return {
          error: `Response too large (${buf.byteLength} bytes; limit ${MAX_RESPONSE_BYTES}).`,
        };
      }
      const body = new TextDecoder("utf-8", { fatal: false }).decode(buf);
      const contentType = (res.headers.get("content-type") || "").toLowerCase();

      let text: string;
      if (contentType.includes("text/html")) {
        text = htmlToText(body);
      } else if (
        contentType.includes("application/json") ||
        contentType.includes("text/") ||
        contentType.includes("application/xml")
      ) {
        text = body;
      } else {
        return {
          error: `Unsupported content-type for text extraction: ${contentType || "unknown"}`,
        };
      }

      const truncated = text.length > MAX_TEXT_OUT_CHARS;
      if (truncated) {
        text = text.slice(0, MAX_TEXT_OUT_CHARS) + " […truncated…]";
      }

      return {
        status: res.status,
        final_url: res.url,
        content_type: contentType || null,
        bytes: buf.byteLength,
        truncated,
        text,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: `Fetch failed: ${msg}` };
    } finally {
      clearTimeout(timer);
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// search_indexed_doc — reuses the in-memory store populated by /api/rag/index
// ─────────────────────────────────────────────────────────────────────────────

export const searchIndexedDocTool = tool({
  description:
    "Search the user's most recently indexed document (from the /rag page). " +
    "Returns the top 3 most relevant chunks. Use this when the user's question is " +
    "about content they've indexed, or when you suspect they have a doc loaded.",
  inputSchema: z.object({
    query: z.string().describe("What to search for in the indexed document."),
  }),
  execute: async ({ query }) => {
    const doc = getLatestDoc();
    if (!doc) {
      return {
        error:
          "No document is currently indexed. Tell the user to visit /rag and " +
          "index a document first.",
      };
    }
    try {
      const qEmb = await embedQuery(query);
      const top = retrieveTopK(doc, qEmb, 3);
      return {
        doc_hash: doc.hash,
        n_chunks_in_doc: doc.chunks.length,
        results: top.map((r) => ({
          chunk_index: r.index,
          score: Number(r.score.toFixed(3)),
          text: r.chunk,
        })),
      };
    } catch (e) {
      return {
        error: `Embedding/search failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});

export const agentTools = {
  calculator: calculatorTool,
  fetch_url: fetchUrlTool,
  search_indexed_doc: searchIndexedDocTool,
};
