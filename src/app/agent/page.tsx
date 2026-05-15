"use client";

import { useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

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
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer"
       className="text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400">
      {children}
    </a>
  ),
};

interface ToolPartLike {
  type: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function ToolCallBlock({ part }: { part: ToolPartLike }) {
  const toolName = part.type.replace(/^tool-/, "");
  const state = part.state ?? "input-streaming";
  const isRunning = state === "input-streaming" || state === "input-available";
  const isError = state === "output-error";

  const stateLabel =
    state === "input-streaming"
      ? "preparing call"
      : state === "input-available"
      ? "calling..."
      : state === "output-available"
      ? "done"
      : state === "output-error"
      ? "error"
      : state;

  return (
    <details
      className={
        "rounded-xl border text-xs " +
        (isError
          ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
          : "border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/40")
      }
      open={isRunning || isError}
    >
      <summary className="cursor-pointer select-none px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
        🛠️ <code className="font-mono">{toolName}</code>
        <span className="ml-2 text-zinc-500">· {stateLabel}</span>
        {isRunning && <span className="ml-2 animate-pulse">⏳</span>}
      </summary>
      <div className="space-y-2 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
        {part.input != null && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">input</div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-white p-2 font-mono text-[11px] dark:bg-zinc-950">
              {JSON.stringify(part.input, null, 2)}
            </pre>
          </div>
        )}
        {part.output != null && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">output</div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 font-mono text-[11px] dark:bg-zinc-950">
              {typeof part.output === "string"
                ? part.output
                : JSON.stringify(part.output, null, 2)}
            </pre>
          </div>
        )}
        {part.errorText && (
          <div className="rounded bg-red-100 p-2 text-[11px] text-red-900 dark:bg-red-950/60 dark:text-red-200">
            {part.errorText}
          </div>
        )}
      </div>
    </details>
  );
}

export default function AgentPage() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, regenerate } = useChat({
    transport: new DefaultChatTransport({ api: "/api/agent" }),
  });
  const isLoading = status === "submitted" || status === "streaming";

  return (
    <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col p-4">
      <header className="mb-3 flex items-center justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <div>
          <h1 className="text-lg font-semibold">ai-chat-ui · Agent</h1>
          <p className="text-xs text-zinc-500">
            Claude + tool use · calculator, fetch_url, search_indexed_doc
          </p>
        </div>
        <nav className="flex gap-3 text-xs text-zinc-500">
          <Link href="/" className="underline-offset-2 hover:underline">Chat</Link>
          <Link href="/rag" className="underline-offset-2 hover:underline">RAG</Link>
        </nav>
      </header>

      <details className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          🧰 Available tools
        </summary>
        <div className="space-y-1 border-t border-zinc-200 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
          <div>
            <code className="font-mono">calculator</code> — math expressions
          </div>
          <div>
            <code className="font-mono">fetch_url</code> — fetch a public URL (https), extract text
          </div>
          <div>
            <code className="font-mono">search_indexed_doc</code> — query the most recently indexed doc from{" "}
            <Link href="/rag" className="underline">/rag</Link>
          </div>
        </div>
      </details>

      <div className="flex-1 space-y-3 overflow-y-auto pb-4">
        {messages.length === 0 && (
          <div className="space-y-2 text-sm text-zinc-500">
            <p>Try one of:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <em>&quot;What is 17 ** 4 / 3.14?&quot;</em> — exercises calculator
              </li>
              <li>
                <em>&quot;Summarize https://en.wikipedia.org/wiki/Retrieval-augmented_generation in 4 bullets&quot;</em>{" "}
                — exercises fetch_url
              </li>
              <li>
                <em>&quot;What does my indexed doc say about X?&quot;</em> — exercises search_indexed_doc (after indexing in /rag)
              </li>
            </ul>
          </div>
        )}

        {messages.map((m) => {
          if (m.role === "user") {
            const text = m.parts
              .filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join("");
            return (
              <div
                key={m.id}
                className="ml-auto max-w-[80%] whitespace-pre-wrap break-words rounded-2xl bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-black"
              >
                {text}
              </div>
            );
          }

          return (
            <div key={m.id} className="space-y-2">
              {m.parts.map((part, i) => {
                if (part.type === "text") {
                  return (
                    <div
                      key={i}
                      className="max-w-[85%] rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {part.text}
                      </ReactMarkdown>
                    </div>
                  );
                }
                if (typeof part.type === "string" && part.type.startsWith("tool-")) {
                  return (
                    <div key={i} className="max-w-[85%]">
                      <ToolCallBlock part={part as ToolPartLike} />
                    </div>
                  );
                }
                return null;
              })}
            </div>
          );
        })}

        {isLoading && <div className="text-xs text-zinc-500">…</div>}

        {error && (
          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <div className="mb-1 font-medium">Request failed</div>
            <div className="mb-2 whitespace-pre-wrap break-words font-mono text-xs opacity-80">
              {error.message || String(error)}
            </div>
            <button
              type="button"
              onClick={() => regenerate()}
              className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900/40"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || isLoading) return;
          sendMessage({ text: input });
          setInput("");
        }}
        className="flex gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the agent..."
          className="flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
        >
          Send
        </button>
      </form>
    </div>
  );
}
