"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";

export default function ChatPage() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, regenerate } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const isLoading = status === "submitted" || status === "streaming";

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col p-4">
      <header className="mb-4 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">ai-chat-ui</h1>
        <p className="text-xs text-zinc-500">
          Claude Sonnet 4.6 · streaming · Vercel AI SDK
        </p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto pb-4">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-500">
            Say something to start. Try: <em>&quot;Explain RAG in 2 sentences&quot;</em>
          </p>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "ml-auto max-w-[80%] rounded-2xl bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-black"
                : "max-w-[80%] rounded-2xl bg-zinc-100 px-4 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
            }
          >
            {m.parts
              .filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p, i) => (
                <span key={i} className="whitespace-pre-wrap">
                  {p.text}
                </span>
              ))}
          </div>
        ))}

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
