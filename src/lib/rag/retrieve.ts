import type { IndexedDoc } from "./store";

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

function cosine(a: number[], b: number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

export interface Retrieved {
  index: number;
  chunk: string;
  score: number;
  doc_hash?: string; // present only in multi-doc retrieval
}

export function retrieveTopK(
  doc: IndexedDoc,
  queryEmbedding: number[],
  k = 4,
): Retrieved[] {
  const scored = doc.embeddings.map((emb, i) => ({
    index: i,
    chunk: doc.chunks[i],
    score: cosine(emb, queryEmbedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

export function retrieveTopKMulti(
  docs: IndexedDoc[],
  queryEmbedding: number[],
  k = 4,
): Retrieved[] {
  const scored: Retrieved[] = [];
  for (const doc of docs) {
    for (let i = 0; i < doc.embeddings.length; i++) {
      scored.push({
        index: i,
        chunk: doc.chunks[i],
        score: cosine(doc.embeddings[i], queryEmbedding),
        doc_hash: doc.hash,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
