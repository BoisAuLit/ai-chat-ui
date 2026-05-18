// RAG doc store. Backed by either Upstash Redis (production, persistent across
// serverless instances and cold starts) or an in-memory Map (local dev /
// no-credentials fallback). The backend choice is made at module load time
// based on env vars; all callers see the same async API regardless.
//
// To enable persistent mode in production:
// 1. Provision Upstash Redis (free tier OK) — Vercel dashboard → Storage → Upstash KV.
// 2. Set env vars on the Vercel project:
//    - UPSTASH_REDIS_REST_URL
//    - UPSTASH_REDIS_REST_TOKEN
// 3. Redeploy.
//
// If either env var is missing, the store silently falls back to in-memory.
// This means: local `next dev` works with no setup; production without Upstash
// behaves as it did before this commit (in-memory, cold-start eviction).

import { createHash } from "crypto";
import { Redis } from "@upstash/redis";

export interface IndexedDoc {
  hash: string;
  chunks: string[];
  embeddings: number[][];
  indexed_at: string;
  n_chars: number;
}

export interface DocSummary {
  hash: string;
  n_chunks: number;
  n_chars: number;
  indexed_at: string;
  snippet: string;
}

// ─── Backend selection ───────────────────────────────────────────────────────

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useRedis = !!(REDIS_URL && REDIS_TOKEN);

const redis = useRedis
  ? new Redis({ url: REDIS_URL!, token: REDIS_TOKEN! })
  : null;

const DOC_KEY_PREFIX = "rag:doc:";
const DOC_INDEX_KEY = "rag:doc_hashes";
const LATEST_HASH_KEY = "rag:latest_hash";

// ─── In-memory fallback ──────────────────────────────────────────────────────

const MEMORY_STORE = new Map<string, IndexedDoc>();
let MEMORY_LATEST_HASH: string | null = null;

// ─── Public API (always async) ───────────────────────────────────────────────

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function getBackend(): "redis" | "memory" {
  return useRedis ? "redis" : "memory";
}

export async function putDoc(doc: IndexedDoc): Promise<void> {
  if (redis) {
    // Pipeline: set the doc, add to the index set, set latest pointer
    const pipeline = redis.pipeline();
    pipeline.set(DOC_KEY_PREFIX + doc.hash, doc);
    pipeline.sadd(DOC_INDEX_KEY, doc.hash);
    pipeline.set(LATEST_HASH_KEY, doc.hash);
    await pipeline.exec();
    return;
  }
  MEMORY_STORE.set(doc.hash, doc);
  MEMORY_LATEST_HASH = doc.hash;
}

export async function getDoc(hash: string): Promise<IndexedDoc | undefined> {
  if (redis) {
    const doc = await redis.get<IndexedDoc>(DOC_KEY_PREFIX + hash);
    return doc ?? undefined;
  }
  return MEMORY_STORE.get(hash);
}

export async function getLatestDoc(): Promise<IndexedDoc | undefined> {
  if (redis) {
    const hash = await redis.get<string>(LATEST_HASH_KEY);
    if (!hash) return undefined;
    return getDoc(hash);
  }
  if (!MEMORY_LATEST_HASH) return undefined;
  return MEMORY_STORE.get(MEMORY_LATEST_HASH);
}

export async function hasDoc(hash: string): Promise<boolean> {
  if (redis) {
    const exists = await redis.exists(DOC_KEY_PREFIX + hash);
    return exists > 0;
  }
  return MEMORY_STORE.has(hash);
}

export async function listDocHashes(): Promise<string[]> {
  if (redis) {
    const members = await redis.smembers(DOC_INDEX_KEY);
    return members as string[];
  }
  return [...MEMORY_STORE.keys()];
}

export async function listDocSummaries(): Promise<DocSummary[]> {
  if (redis) {
    const hashes = await listDocHashes();
    if (hashes.length === 0) return [];
    const docs = await Promise.all(hashes.map((h) => getDoc(h)));
    return docs
      .filter((d): d is IndexedDoc => !!d)
      .map((d) => ({
        hash: d.hash,
        n_chunks: d.chunks.length,
        n_chars: d.n_chars,
        indexed_at: d.indexed_at,
        snippet: (d.chunks[0] || "").slice(0, 200),
      }));
  }
  return [...MEMORY_STORE.values()].map((d) => ({
    hash: d.hash,
    n_chunks: d.chunks.length,
    n_chars: d.n_chars,
    indexed_at: d.indexed_at,
    snippet: (d.chunks[0] || "").slice(0, 200),
  }));
}

export async function clearAllDocs(): Promise<number> {
  if (redis) {
    const hashes = await listDocHashes();
    if (hashes.length === 0) {
      await redis.del(LATEST_HASH_KEY);
      return 0;
    }
    const pipeline = redis.pipeline();
    for (const h of hashes) {
      pipeline.del(DOC_KEY_PREFIX + h);
    }
    pipeline.del(DOC_INDEX_KEY);
    pipeline.del(LATEST_HASH_KEY);
    await pipeline.exec();
    return hashes.length;
  }
  const n = MEMORY_STORE.size;
  MEMORY_STORE.clear();
  MEMORY_LATEST_HASH = null;
  return n;
}

export async function getDocsOrLatest(hashes: string[]): Promise<IndexedDoc[]> {
  if (hashes.length === 0) {
    const latest = await getLatestDoc();
    return latest ? [latest] : [];
  }
  const docs = await Promise.all(hashes.map((h) => getDoc(h)));
  return docs.filter((d): d is IndexedDoc => !!d);
}
