import { runEvals, type EvalInput } from "@/lib/rag/eval";

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const body: Partial<EvalInput> = await req.json();

  if (!body.question || !body.answer) {
    return Response.json(
      { error: "Missing 'question' or 'answer'" },
      { status: 400 },
    );
  }
  if (!body.retrievedChunks || !Array.isArray(body.retrievedChunks)) {
    return Response.json(
      { error: "Missing 'retrievedChunks' array" },
      { status: 400 },
    );
  }

  try {
    const result = await runEvals(body as EvalInput);
    return Response.json(result);
  } catch (e) {
    return Response.json(
      {
        error: "Eval call failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
