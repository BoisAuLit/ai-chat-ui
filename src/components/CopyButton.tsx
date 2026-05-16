"use client";

import { useState } from "react";

export function CopyButton({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard might be unavailable in non-secure contexts */
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title="Copy"
      aria-label="Copy message"
      className={
        "rounded-md border border-zinc-300 bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-400 dark:hover:bg-zinc-900 " +
        className
      }
    >
      {copied ? "✓ copied" : "📋 copy"}
    </button>
  );
}
