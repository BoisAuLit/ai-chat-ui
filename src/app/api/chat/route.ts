import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToModelMessages, type UIMessage } from "ai";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system:
      "You are a helpful assistant. Keep responses concise and concrete.",
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
