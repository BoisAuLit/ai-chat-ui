"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "@/components/CopyButton";
import { loadJson, saveJson, clearJson } from "@/lib/persist";

const STORAGE_KEY_MESSAGES = "ai-chat-ui:rag-messages";
const STORAGE_KEY_DRAFT = "ai-chat-ui:rag-draft";

interface DocSummary {
  hash: string;
  n_chunks: number;
  n_chars: number;
  indexed_at: string;
  snippet: string;
}

interface RetrievedSnippet {
  index: number;
  score: number;
  snippet: string;
  doc_hash?: string;
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
  answer_relevance: { rationale: string };
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

const SAMPLE_DOC = `Paste any plaintext document here — README, blog post, transcript, paper — or upload a PDF (button above).

Index multiple docs and the chat will retrieve across ALL of them; the response shows which chunk came from which document.`;

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
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [activeHashes, setActiveHashes] = useState<Set<string>>(new Set());
  const [draftText, setDraftText] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [indexErr, setIndexErr] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfErr, setPdfErr] = useState("");

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [chatErr, setChatErr] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const [rehydrated, setRehydrated] = useState(false);

  async function fetchDocs() {
    try {
      const res = await fetch("/api/rag/list");
      if (!res.ok) return;
      const data: { docs: DocSummary[] } = await res.json();
      setDocs(data.docs);
      setActiveHashes((prev) => {
        // Keep previous selections that still exist; auto-add any new docs.
        const next = new Set(prev);
        for (const d of data.docs) if (!next.has(d.hash)) next.add(d.hash);
        for (const h of [...next]) {
          if (!data.docs.some((d) => d.hash === h)) next.delete(h);
        }
        return next;
      });
    } catch {
      /* ignore — server might be cold */
    }
  }

  // Rehydrate from localStorage + fetch server doc list once.
  useEffect(() => {
    const storedDraft = loadJson<string>(STORAGE_KEY_DRAFT);
    if (storedDraft) setDraftText(storedDraft);

    const storedMsgs = loadJson<ChatMsg[]>(STORAGE_KEY_MESSAGES);
    if (storedMsgs && storedMsgs.length > 0) {
      setMessages(storedMsgs.map((m) => ({ ...m, evalRunning: false })));
    }
    fetchDocs();
    setRehydrated(true);
  }, []);

  useEffect(() => {
    if (!rehydrated) return;
    saveJson(STORAGE_KEY_DRAFT, draftText);
  }, [draftText, rehydrated]);

  useEffect(() => {
    if (!rehydrated) return;
    saveJson(STORAGE_KEY_MESSAGES, messages);
  }, [messages, rehydrated]);

  function updateMsg(id: string, patch: Partial<ChatMsg>) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function toggleHash(hash: string) {
    setActiveHashes((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  }

  async function handlePdfUpload(file: File) {
    setPdfUploading(true);
    setPdfErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/rag/extract-pdf", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `extract failed (${res.status})`);
      setDraftText(data.text);
    } catch (e) {
      setPdfErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfUploading(false);
    }
  }

  async function handleIndex() {
    if (!draftText.trim() || indexing) return;
    setIndexing(true);
    setIndexErr("");
    try {
      const res = await fetch("/api/rag/index", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: draftText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `index failed (${res.status})`);
      // Refresh full list (server is the source of truth).
      await fetchDocs();
      // Make sure the freshly-indexed doc is active.
      if (data.hash) {
        setActiveHashes((prev) => new Set(prev).add(data.hash));
      }
      // Clear the draft so the user can paste another doc.
      setDraftText("");
    } catch (e) {
      setIndexErr(e instanceof Error ? e.message : String(e));
    } finally {
      setIndexing(false);
    }
  }

  async function handleClearAllDocs() {
    if (!confirm("Forget all indexed documents on the server? This cannot be undone.")) return;
    try {
      await fetch("/api/rag/clear", { method: "POST" });
    } catch {
      /* ignore */
    }
    setDocs([]);
    setActiveHashes(new Set());
  }

  async function handleSend() {
    if (!input.trim() || streaming || activeHashes.size === 0) return;
    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: "user", text: input };
    const assistantMsg: ChatMsg = { id: crypto.randomUUID(), role: "assistant", text: "" };
    const baseMessages = [...messages, userMsg, assistantMsg];
    setMessages(baseMessages);
    setInput("");
    setStreaming(true);
    setChatErr("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
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
          docHashes: [...activeHashes],
          messages: apiMessages,
        }),
        signal: controller.signal,
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
          /* ignore */
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
      if ((e as { name?: string })?.name !== "AbortError") {
        setChatErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function handleClearChat() {
    setMessages([]);
    clearJson(STORAGE_KEY_MESSAGES);
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

  const activeDocs = docs.filter((d) => activeHashes.has(d.hash));
  const canChat = activeDocs.length > 0;

  return (
    <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col p-4">
      <header className="mb-3 flex items-center justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <div>
          <h1 className="text-lg font-semibold">ai-chat-ui · RAG + Evals</h1>
          <p className="text-xs text-zinc-500">
            Multi-doc retrieval. Index several docs, query across all of them, run LLM-as-judge evals.
          </p>
        </div>
        <nav className="flex gap-3 text-xs text-zinc-500">
          <Link href="/" className="underline-offset-2 hover:underline">Chat</Link>
          <Link href="/agent" className="underline-offset-2 hover:underline">Agent</Link>
        </nav>
      </header>

      <details className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40" open={docs.length === 0}>
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          📚 Indexed documents · {docs.length} doc{docs.length === 1 ? "" : "s"} · {activeDocs.length} active{" "}
          {docs.length > 0 && (
            <span className="text-zinc-400">
              ({docs.reduce((a, d) => a + d.n_chunks, 0)} chunks total)
            </span>
          )}
        </summary>
        <div className="space-y-3 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
          {docs.length > 0 && (
            <div className="space-y-2">
              {docs.map((d) => {
                const active = activeHashes.has(d.hash);
                return (
                  <label
                    key={d.hash}
                    className={
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-2 transition-colors " +
                      (active
                        ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40"
                        : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleHash(d.hash)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        <code className="font-mono text-zinc-700 dark:text-zinc-300">{d.hash}</code>
                        <span>·</span>
                        <span>{d.n_chunks} chunks</span>
                        <span>·</span>
                        <span>{d.n_chars.toLocaleString()} chars</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-400">
                        {d.snippet}
                      </div>
                    </div>
                  </label>
                );
              })}
              <button
                type="button"
                onClick={handleClearAllDocs}
                className="text-xs text-red-600 underline-offset-2 hover:underline dark:text-red-400"
              >
                🗑️ Forget all indexed docs
              </button>
            </div>
          )}

          <div className="rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
            <div className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {docs.length === 0 ? "Index your first document" : "Add another document"}
            </div>
            <div className="mb-2 flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handlePdfUpload(f);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={pdfUploading || indexing || streaming}
                className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-white disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {pdfUploading ? "Extracting PDF..." : "📎 Upload PDF"}
              </button>
              {pdfErr && (
                <span className="text-xs text-red-600 dark:text-red-400">{pdfErr}</span>
              )}
            </div>
            <textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              placeholder={SAMPLE_DOC}
              rows={6}
              className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
              disabled={indexing || streaming || pdfUploading}
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleIndex}
                disabled={!draftText.trim() || indexing || streaming}
                className="rounded-lg bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
              >
                {indexing ? "Indexing..." : "Index document"}
              </button>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearChat}
                  className="ml-auto text-xs text-red-600 underline-offset-2 hover:underline dark:text-red-400"
                >
                  🗑️ Clear chat
                </button>
              )}
            </div>
            {indexErr && (
              <div className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                {indexErr}
              </div>
            )}
          </div>
        </div>
      </details>

      <div className="flex-1 space-y-3 overflow-y-auto pb-4">
        {docs.length === 0 && (
          <p className="text-sm text-zinc-500">
            Index a document to start. Multiple docs are supported — the chat will retrieve across all active (checked) docs.
          </p>
        )}
        {docs.length > 0 && !canChat && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            ⚠️ No active docs selected. Tick at least one document above before chatting.
          </p>
        )}
        {canChat && messages.length === 0 && (
          <p className="text-sm text-zinc-500">
            Ready. Querying across {activeDocs.length} doc{activeDocs.length === 1 ? "" : "s"}. Try: <em>&quot;Summarize the key points in 3 bullets&quot;</em>
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

          const canEval = !!m.retrievedChunks && m.retrievedChunks.length > 0 && !!m.text && !streaming;
          const uniqueSrcDocs = new Set((m.retrievedChunks || []).map((r) => r.doc_hash).filter(Boolean));

          return (
            <div key={m.id} className="group space-y-2">
              <div className="max-w-[85%] rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                {m.text ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {m.text}
                  </ReactMarkdown>
                ) : (
                  <span className="text-zinc-500">…</span>
                )}
              </div>
              {m.text && (
                <div className="opacity-0 transition-opacity group-hover:opacity-100">
                  <CopyButton text={m.text} />
                </div>
              )}

              {m.retrievedChunks && m.retrievedChunks.length > 0 && (
                <details className="ml-0 max-w-[85%] rounded-xl border border-zinc-200 bg-zinc-50 text-xs dark:border-zinc-800 dark:bg-zinc-900/40">
                  <summary className="cursor-pointer select-none px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                    🔍 Retrieved {m.retrievedChunks.length} chunks
                    {uniqueSrcDocs.size > 1 && (
                      <span className="ml-2 text-zinc-500">from {uniqueSrcDocs.size} docs</span>
                    )}
                  </summary>
                  <div className="space-y-2 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
                    {m.retrievedChunks.map((r, i) => (
                      <div key={i} className="rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950">
                        <div className="mb-1 flex flex-wrap items-center gap-2 text-zinc-500">
                          <code>chunk {r.index}</code>
                          {r.doc_hash && (
                            <>
                              <span>·</span>
                              <span>doc <code className="font-mono">{r.doc_hash.slice(0, 8)}</code></span>
                            </>
                          )}
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
                        <strong>Faithfulness</strong> — {m.evalResult.details.faithfulness.n_supported}/{m.evalResult.details.faithfulness.n_claims} claims supported.
                        {m.evalResult.details.faithfulness.unsupported_examples.length > 0 && (
                          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-zinc-600 dark:text-zinc-400">
                            {m.evalResult.details.faithfulness.unsupported_examples.map((q, i) => (
                              <li key={i}><em>&quot;{q}&quot;</em></li>
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
          placeholder={
            !canChat
              ? "Index and select at least one document first"
              : activeDocs.length === 1
              ? "Ask about the indexed document..."
              : `Ask across ${activeDocs.length} documents...`
          }
          className="flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          disabled={!canChat || streaming}
        />
        {streaming ? (
          <button
            type="button"
            onClick={handleStop}
            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canChat || !input.trim()}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            Send
          </button>
        )}
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
