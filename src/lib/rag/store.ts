// Module-level in-memory store of indexed docs, keyed by SHA-256 hash of source text.
// Survives across requests on the same serverless instance; clears on cold start.
// V1 trade-off: fast and simple, but client may need to re-index after a cold start.

import { createHash } from "crypto";

export interface IndexedDoc {
  hash: string;
  chunks: string[];
  embeddings: number[][];
  indexed_at: string;
  n_chars: number;
}

const STORE = new Map<string, IndexedDoc>();
let LATEST_HASH: string | null = null;

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function putDoc(doc: IndexedDoc): void {
  STORE.set(doc.hash, doc);
  LATEST_HASH = doc.hash;
}

export function getLatestDoc(): IndexedDoc | undefined {
  if (!LATEST_HASH) return undefined;
  return STORE.get(LATEST_HASH);
}

export function getDoc(hash: string): IndexedDoc | undefined {
  return STORE.get(hash);
}

export function hasDoc(hash: string): boolean {
  return STORE.has(hash);
}

export function listDocHashes(): string[] {
  return [...STORE.keys()];
}

export interface DocSummary {
  hash: string;
  n_chunks: number;
  n_chars: number;
  indexed_at: string;
  snippet: string;
}

export function listDocSummaries(): DocSummary[] {
  return [...STORE.values()].map((d) => ({
    hash: d.hash,
    n_chunks: d.chunks.length,
    n_chars: d.n_chars,
    indexed_at: d.indexed_at,
    // First 200 chars of first chunk — enough to ID the doc in a list
    snippet: (d.chunks[0] || "").slice(0, 200),
  }));
}

export function clearAllDocs(): number {
  const n = STORE.size;
  STORE.clear();
  LATEST_HASH = null;
  return n;
}

export function getDocsOrLatest(hashes: string[]): IndexedDoc[] {
  if (hashes.length === 0) {
    const latest = getLatestDoc();
    return latest ? [latest] : [];
  }
  return hashes.map((h) => STORE.get(h)).filter((d): d is IndexedDoc => !!d);
}
