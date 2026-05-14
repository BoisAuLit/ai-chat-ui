import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToModelMessages, type UIMessage } from "ai";

export const maxDuration = 30;

const ALLOWED_MODELS = new Set([
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-7",
]);

const DEFAULT_SYSTEM =
  "You are a helpful assistant. Keep responses concise and concrete.";

export async function POST(req: Request) {
  const body: {
    messages: UIMessage[];
    model?: string;
    system?: string;
  } = await req.json();

  const model = body.model && ALLOWED_MODELS.has(body.model)
    ? body.model
    : "claude-sonnet-4-6";

  const system = (body.system && body.system.trim()) || DEFAULT_SYSTEM;

  const result = streamText({
    model: anthropic(model),
    system,
    messages: await convertToModelMessages(body.messages),
  });

  return result.toUIMessageStreamResponse();
}
