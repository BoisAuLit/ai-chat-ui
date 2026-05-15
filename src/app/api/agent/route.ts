import { anthropic } from "@ai-sdk/anthropic";
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import { agentTools } from "@/lib/agent/tools";

export const maxDuration = 90;

const MODEL = "claude-sonnet-4-6";
const MAX_STEPS = 8;

const SYSTEM_PROMPT = `You are a helpful AI assistant with access to three tools:

- **calculator** — evaluate math expressions
- **fetch_url** — fetch a public web URL and read its text content
- **search_indexed_doc** — search the user's RAG-indexed document (only available if they indexed one via /rag)

Use a tool ONLY when it's the right move. If the question is simple, conversational, or you already know the answer, just respond directly without calling tools.

When you do call a tool, briefly state what you'll do before calling it, then react to the result before either calling another tool or giving the final answer.

Be concise. Show your work but don't over-explain. Treat the user as a peer engineer.

Hard limits:
- You have a maximum of ${MAX_STEPS} steps; plan accordingly.
- If a tool returns an error, decide whether to retry with adjusted input, try a different tool, or tell the user what went wrong.`;

export async function POST(req: Request): Promise<Response> {
  const body: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: anthropic(MODEL),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(body.messages),
    tools: agentTools,
    stopWhen: stepCountIs(MAX_STEPS),
  });

  return result.toUIMessageStreamResponse();
}
