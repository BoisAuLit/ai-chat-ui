// LLM-as-judge eval metrics for RAG output, RAGAS-style.
// Three metrics, each computed by a single Claude call. Run in parallel.

import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

// Use Haiku for evals: simple structured classification, fast + cheap.
const JUDGE_MODEL = "claude-haiku-4-5-20251001";

export interface EvalRetrievedChunk {
  index: number;
  chunk: string;
}

export interface EvalInput {
  question: string;
  answer: string;
  retrievedChunks: EvalRetrievedChunk[];
}

export interface FaithfulnessDetail {
  n_claims: number;
  n_supported: number;
  unsupported_examples: string[];
}

export interface ContextRelevanceDetail {
  n_chunks: number;
  n_relevant: number;
  rationale: string;
}

export interface AnswerRelevanceDetail {
  rationale: string;
}

export interface EvalResult {
  faithfulness: number;
  context_relevance: number;
  answer_relevance: number;
  details: {
    faithfulness: FaithfulnessDetail;
    context_relevance: ContextRelevanceDetail;
    answer_relevance: AnswerRelevanceDetail;
  };
}

function stripFences(text: string): string {
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```[a-z]*\n/i, "").replace(/\n```$/i, "");
    s = s.trim();
  }
  return s;
}

function formatChunks(chunks: EvalRetrievedChunk[]): string {
  return chunks
    .map((c) => `[chunk ${c.index}]\n${c.chunk}`)
    .join("\n\n---\n\n");
}

async function judge(systemPrompt: string, userMessage: string): Promise<unknown> {
  const result = await generateText({
    model: anthropic(JUDGE_MODEL),
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  const raw = stripFences(result.text);
  return JSON.parse(raw);
}

const FAITHFULNESS_SYSTEM = `You are an impartial judge measuring whether an answer is faithful to retrieved document chunks.

A claim is "supported" if it appears in or follows directly from the retrieved chunks. A claim is "unsupported" if it relies on outside knowledge, makes up a number/name/quote not present, or contradicts the chunks.

Return ONE JSON object, no prose, no markdown fences:
{
  "n_claims": <int>,
  "n_supported": <int>,
  "score": <float between 0 and 1, = n_supported / n_claims, rounded to 2 decimals>,
  "unsupported_examples": [<string>, ...]   // up to 3 short quotes from the answer; empty array if none
}`;

const CONTEXT_RELEVANCE_SYSTEM = `You are an impartial judge measuring whether retrieved document chunks are relevant to a question.

A chunk is "relevant" if it contains information that helps answer the question, even partially. A chunk is "irrelevant" if it is off-topic.

Return ONE JSON object, no prose, no markdown fences:
{
  "n_chunks": <int>,
  "n_relevant": <int>,
  "score": <float between 0 and 1, = n_relevant / n_chunks, rounded to 2 decimals>,
  "rationale": <one short sentence>
}`;

const ANSWER_RELEVANCE_SYSTEM = `You are an impartial judge measuring whether an answer directly addresses a question.

Score 1.0 if the answer fully addresses what was asked. Score 0.5 if it partially addresses (e.g., addresses a related question, or only part of the asked question). Score 0.0 if it is off-topic or refuses to answer.

Return ONE JSON object, no prose, no markdown fences:
{
  "score": <0, 0.5, or 1>,
  "rationale": <one short sentence>
}`;

async function evalFaithfulness(input: EvalInput): Promise<{
  score: number;
  detail: FaithfulnessDetail;
}> {
  const userMessage = `RETRIEVED CHUNKS:\n${formatChunks(input.retrievedChunks)}\n\nQUESTION:\n${input.question}\n\nANSWER:\n${input.answer}`;
  const result = (await judge(FAITHFULNESS_SYSTEM, userMessage)) as {
    n_claims: number;
    n_supported: number;
    score: number;
    unsupported_examples: string[];
  };
  return {
    score: result.score,
    detail: {
      n_claims: result.n_claims,
      n_supported: result.n_supported,
      unsupported_examples: result.unsupported_examples || [],
    },
  };
}

async function evalContextRelevance(input: EvalInput): Promise<{
  score: number;
  detail: ContextRelevanceDetail;
}> {
  const userMessage = `QUESTION:\n${input.question}\n\nRETRIEVED CHUNKS:\n${formatChunks(input.retrievedChunks)}`;
  const result = (await judge(CONTEXT_RELEVANCE_SYSTEM, userMessage)) as {
    n_chunks: number;
    n_relevant: number;
    score: number;
    rationale: string;
  };
  return {
    score: result.score,
    detail: {
      n_chunks: result.n_chunks,
      n_relevant: result.n_relevant,
      rationale: result.rationale,
    },
  };
}

async function evalAnswerRelevance(input: EvalInput): Promise<{
  score: number;
  detail: AnswerRelevanceDetail;
}> {
  const userMessage = `QUESTION:\n${input.question}\n\nANSWER:\n${input.answer}`;
  const result = (await judge(ANSWER_RELEVANCE_SYSTEM, userMessage)) as {
    score: number;
    rationale: string;
  };
  return {
    score: result.score,
    detail: { rationale: result.rationale },
  };
}

export async function runEvals(input: EvalInput): Promise<EvalResult> {
  const [faith, ctx, ans] = await Promise.all([
    evalFaithfulness(input),
    evalContextRelevance(input),
    evalAnswerRelevance(input),
  ]);
  return {
    faithfulness: faith.score,
    context_relevance: ctx.score,
    answer_relevance: ans.score,
    details: {
      faithfulness: faith.detail,
      context_relevance: ctx.detail,
      answer_relevance: ans.detail,
    },
  };
}
