"use client";

import { useState } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface RetrievedSnippet {
  index: number;
  score: number;
  snippet: string;
}

interface EvalDetails {
  faithfulness: {
    n_claims: number;
    n_supported: number;
    unsupported_examples: string[];
  };
  context_relevance: {
    n_chunks: number;
    n_relevant: number;
    rationale: string;
  };
  answer_relevance: {
    rationale: string;
  };
}

interface EvalResult {
  faithfulness: number;
  context_relevance: number;
  answer_relevance: number;
  details: EvalDetails;
}

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  text: string;
  retrievedChunks?: RetrievedSnippet[];
  evalResult?: EvalResult;
  evalRunning?: boolean;
  evalError?: string;
}

interface IndexResult {
  hash: string;
  n_chunks: number;
  n_chars: number;
  cached: boolean;
}

const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ className, children }) => {
    const isBlock = (className ?? "").startsWith("language-");
    if (isBlock) {
      return <code className="block whitespace-pre-wrap break-words font-mono text-xs">{children}</code>;
    }
    return <code className="rounded bg-zinc-200 px-1 py-0.5 font-mono text-xs dark:bg-zinc-700">{children}</code>;
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-zinc-900 p-3 text-xs text-zinc-100">{children}</pre>
  ),
};

const SAMPLE_DOC = `Paste any plaintext document here — README, blog post, transcript, paper.

It will be chunked (paragraph-aware), embedded with OpenAI text-embedding-3-small, and stored in memory. Each chat turn embeds your query, retrieves the top-4 most similar chunks via cosine similarity, and feeds them to Claude as grounded context.

Try uploading the project README, a HN comment thread, or any reasonably structured doc and ask questions about it.`;

function scoreColor(score: number): string {
  if (score >= 0.8) return "text-emerald-700 dark:text-emerald-400";
  if (score >= 0.5) return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

function scoreBg(score: number): string {
  if (score >= 0.8) return "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-900";
  if (score >= 0.5) return "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-900";
  return "bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-900";
}

export default function RagPage() {
  const [docText, setDocText] = useState("");
  const [indexed, setIndexed] = useState<IndexResult | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexErr, setIndexErr] = useState("");

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [chatErr, setChatErr] = useState("");

  function updateMsg(id: string, patch: Partial<ChatMsg>) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  async function handleIndex() {
    if (!docText.trim() || indexing) return;
    setIndexing(true);
    setIndexErr("");
    try {
      const res = await fetch("/api/rag/index", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: docText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `index failed (${res.status})`);
      setIndexed(data as IndexResult);
      setMessages([]);
    } catch (e) {
      setIndexErr(e instanceof Error ? e.message : String(e));
    } finally {
      setIndexing(false);
    }
  }

  async function handleSend() {
    if (!input.trim() || streaming || !indexed) return;
    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: "user", text: input };
    const assistantMsg: ChatMsg = { id: crypto.randomUUID(), role: "assistant", text: "" };
    const baseMessages = [...messages, userMsg, assistantMsg];
    setMessages(baseMessages);
    setInput("");
    setStreaming(true);
    setChatErr("");

    try {
      // Build the message history payload for the API (everything up to and including userMsg).
      const apiMessages = baseMessages
        .filter((m) => m.id !== assistantMsg.id)
        .map((m) => ({
          id: m.id,
          role: m.role,
          parts: [{ type: "text" as const, text: m.text }],
        }));

      const res = await fetch("/api/rag/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          docHash: indexed.hash,
          messages: apiMessages,
        }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `chat failed (${res.status})`);
      }

      const ragHeader = res.headers.get("x-rag-retrieved");
      if (ragHeader) {
        try {
          const parsed: RetrievedSnippet[] = JSON.parse(decodeURIComponent(ragHeader));
          updateMsg(assistantMsg.id, { retrievedChunks: parsed });
        } catch {
          /* ignore parse errors */
        }
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        updateMsg(assistantMsg.id, { text: accumulated });
      }
    } catch (e) {
      setChatErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
    }
  }

  async function handleRunEval(assistantId: string) {
    const idx = messages.findIndex((m) => m.id === assistantId);
    if (idx < 1) return;
    const assistantMsg = messages[idx];
    const userMsg = messages[idx - 1];
    if (
      assistantMsg.role !== "assistant" ||
      userMsg.role !== "user" ||
      !assistantMsg.retrievedChunks ||
      !assistantMsg.text
    ) {
      return;
    }
    if (assistantMsg.evalRunning) return;

    updateMsg(assistantId, { evalRunning: true, evalError: undefined });

    try {
      const res = await fetch("/api/rag/eval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: userMsg.text,
          answer: assistantMsg.text,
          retrievedChunks: assistantMsg.retrievedChunks.map((r) => ({
            index: r.index,
            chunk: r.snippet,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `eval failed (${res.status})`);
      updateMsg(assistantId, { evalResult: data as EvalResult, evalRunning: false });
    } catch (e) {
      updateMsg(assistantId, {
        evalError: e instanceof Error ? e.message : String(e),
        evalRunning: false,
      });
    }
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col p-4">
      <header className="mb-3 flex items-center justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <div>
          <h1 className="text-lg font-semibold">ai-chat-ui · RAG + Evals</h1>
          <p className="text-xs text-zinc-500">
            Paste doc → index → ask → run LLM-as-judge eval. OpenAI embeddings · Claude generation.
          </p>
        </div>
        <Link
          href="/"
          className="text-xs text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Plain chat
        </Link>
      </header>

      <details className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40" open={!indexed}>
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          📄 Document {indexed ? `· ${indexed.n_chunks} chunks indexed (hash ${indexed.hash})` : "(not indexed yet)"}
        </summary>
        <div className="space-y-2 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
          <textarea
            value={docText}
            onChange={(e) => setDocText(e.target.value)}
            placeholder={SAMPLE_DOC}
            rows={8}
            className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
            disabled={indexing || streaming}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleIndex}
              disabled={!docText.trim() || indexing || streaming}
              className="rounded-lg bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
            >
              {indexing ? "Indexing..." : indexed ? "Re-index" : "Index document"}
            </button>
            {indexed && (
              <span className="text-xs text-zinc-500">
                {indexed.n_chars.toLocaleString()} chars · {indexed.n_chunks} chunks{" "}
                {indexed.cached && "· cached"}
              </span>
            )}
          </div>
          {indexErr && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {indexErr}
            </div>
          )}
        </div>
      </details>

      <div className="flex-1 space-y-3 overflow-y-auto pb-4">
        {!indexed && <p className="text-sm text-zinc-500">Index a document first.</p>}
        {indexed && messages.length === 0 && (
          <p className="text-sm text-zinc-500">
            Ready. Try: <em>&quot;Summarize the key points in 3 bullets&quot;</em>
          </p>
        )}

        {messages.map((m) => {
          if (m.role === "user") {
            return (
              <div
                key={m.id}
                className="ml-auto max-w-[80%] whitespace-pre-wrap break-words rounded-2xl bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-black"
              >
                {m.text}
              </div>
            );
          }

          const canEval =
            !!m.retrievedChunks &&
            m.retrievedChunks.length > 0 &&
            !!m.text &&
            !streaming;

          return (
            <div key={m.id} className="space-y-2">
              <div className="max-w-[85%] rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                {m.text ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {m.text}
                  </ReactMarkdown>
                ) : (
                  <span className="text-zinc-500">…</span>
                )}
              </div>

              {m.retrievedChunks && m.retrievedChunks.length > 0 && (
                <details className="ml-0 max-w-[85%] rounded-xl border border-zinc-200 bg-zinc-50 text-xs dark:border-zinc-800 dark:bg-zinc-900/40">
                  <summary className="cursor-pointer select-none px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                    🔍 Retrieved {m.retrievedChunks.length} chunks
                  </summary>
                  <div className="space-y-2 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
                    {m.retrievedChunks.map((r) => (
                      <div key={r.index} className="rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950">
                        <div className="mb-1 flex items-center gap-2 text-zinc-500">
                          <code>chunk {r.index}</code>
                          <span>·</span>
                          <span>score {r.score.toFixed(3)}</span>
                        </div>
                        <div className="whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-zinc-700 dark:text-zinc-300">
                          {r.snippet}
                          {r.snippet.length >= 240 && "..."}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {canEval && !m.evalResult && (
                <button
                  type="button"
                  onClick={() => handleRunEval(m.id)}
                  disabled={m.evalRunning}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {m.evalRunning ? "Running 3 LLM-as-judge calls..." : "📊 Run eval (faithfulness · context · answer)"}
                </button>
              )}

              {m.evalError && (
                <div className="max-w-[85%] rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  {m.evalError}
                </div>
              )}

              {m.evalResult && (
                <div className="max-w-[85%] space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <ScoreCard label="Faithfulness" score={m.evalResult.faithfulness} />
                    <ScoreCard label="Context relevance" score={m.evalResult.context_relevance} />
                    <ScoreCard label="Answer relevance" score={m.evalResult.answer_relevance} />
                  </div>
                  <details className="rounded-xl border border-zinc-200 bg-zinc-50 text-xs dark:border-zinc-800 dark:bg-zinc-900/40">
                    <summary className="cursor-pointer select-none px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                      Eval rationales
                    </summary>
                    <div className="space-y-2 border-t border-zinc-200 px-3 py-3 text-[11px] dark:border-zinc-800">
                      <div>
                        <strong>Faithfulness</strong> — {m.evalResult.details.faithfulness.n_supported}/{m.evalResult.details.faithfulness.n_claims} claims supported by retrieved chunks.
                        {m.evalResult.details.faithfulness.unsupported_examples.length > 0 && (
                          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-zinc-600 dark:text-zinc-400">
                            {m.evalResult.details.faithfulness.unsupported_examples.map((q, i) => (
                              <li key={i}>
                                <em>&quot;{q}&quot;</em> — not in chunks
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <strong>Context relevance</strong> — {m.evalResult.details.context_relevance.n_relevant}/{m.evalResult.details.context_relevance.n_chunks} chunks relevant. {m.evalResult.details.context_relevance.rationale}
                      </div>
                      <div>
                        <strong>Answer relevance</strong> — {m.evalResult.details.answer_relevance.rationale}
                      </div>
                    </div>
                  </details>
                </div>
              )}
            </div>
          );
        })}

        {chatErr && (
          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {chatErr}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="flex gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={indexed ? "Ask about the indexed document..." : "Index a document first"}
          className="flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          disabled={!indexed || streaming}
        />
        <button
          type="submit"
          disabled={!indexed || streaming || !input.trim()}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {streaming ? "..." : "Send"}
        </button>
      </form>
    </div>
  );
}

function ScoreCard({ label, score }: { label: string; score: number }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${scoreBg(score)}`}>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-lg font-bold ${scoreColor(score)}`}>{score.toFixed(2)}</div>
    </div>
  );
}
