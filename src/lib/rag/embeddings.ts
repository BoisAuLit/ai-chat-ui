import { openai } from "@ai-sdk/openai";
import { embedMany, embed } from "ai";

const EMBED_MODEL = "text-embedding-3-small";

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({
    model: openai.textEmbedding(EMBED_MODEL),
    values: texts,
  });
  return embeddings;
}

export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: openai.textEmbedding(EMBED_MODEL),
    value: text,
  });
  return embedding;
}
