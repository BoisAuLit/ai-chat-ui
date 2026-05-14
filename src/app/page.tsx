"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 (balanced)" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5 (fastest)" },
  { id: "claude-opus-4-7", label: "Opus 4.7 (highest quality)" },
] as const;

const DEFAULT_SYSTEM =
  "You are a helpful assistant. Keep responses concise and concrete.";

const markdownComponents: Components = {
  p: ({ children }) => (
    <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-3 text-base font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-3 text-sm font-semibold">{children}</h3>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-zinc-300 pl-3 italic text-zinc-600 dark:border-zinc-600 dark:text-zinc-400">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = (className ?? "").startsWith("language-");
    if (isBlock) {
      return (
        <code className="block whitespace-pre-wrap break-words font-mono text-xs">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-zinc-200 px-1 py-0.5 font-mono text-xs dark:bg-zinc-700">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-zinc-900 p-3 text-xs text-zinc-100 dark:bg-zinc-950">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-zinc-300 dark:border-zinc-700">{children}</thead>
  ),
  th: ({ children }) => <th className="px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => (
    <td className="border-b border-zinc-200 px-2 py-1 dark:border-zinc-800">{children}</td>
  ),
  hr: () => <hr className="my-3 border-zinc-300 dark:border-zinc-700" />,
};

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string>(MODELS[0].id);
  const [systemPrompt, setSystemPrompt] = useState<string>(DEFAULT_SYSTEM);

  const { messages, sendMessage, status, error, regenerate } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const isLoading = status === "submitted" || status === "streaming";
  const currentModel = MODELS.find((m) => m.id === model) ?? MODELS[0];

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col p-4">
      <header className="mb-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">ai-chat-ui</h1>
        <p className="text-xs text-zinc-500">
          {currentModel.label.split(" ")[0]} · streaming · Vercel AI SDK
        </p>
      </header>

      <details className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          ⚙️ Config (model · system prompt)
        </summary>
        <div className="space-y-3 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
          <div>
            <label
              htmlFor="model"
              className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Model
            </label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="system"
              className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              System prompt (applies to the next message)
            </label>
            <textarea
              id="system"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
              placeholder={DEFAULT_SYSTEM}
            />
            <button
              type="button"
              onClick={() => setSystemPrompt(DEFAULT_SYSTEM)}
              className="mt-1 text-xs text-zinc-500 underline-offset-2 hover:underline"
            >
              Reset to default
            </button>
          </div>
        </div>
      </details>

      <div className="flex-1 space-y-4 overflow-y-auto pb-4">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-500">
            Say something to start. Try:{" "}
            <em>&quot;Explain RAG in 2 sentences&quot;</em> or{" "}
            <em>&quot;Show me a markdown table comparing Sonnet vs Haiku&quot;</em>
          </p>
        )}

        {messages.map((m) => {
          const text = m.parts
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join("");

          if (m.role === "user") {
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
            <div
              key={m.id}
              className="max-w-[85%] rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {text}
              </ReactMarkdown>
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
          sendMessage(
            { text: input },
            { body: { model, system: systemPrompt } }
          );
          setInput("");
        }}
        className="flex gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Claude..."
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
