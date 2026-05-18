import { clearAllDocs } from "@/lib/rag/store";

export async function POST(): Promise<Response> {
  const cleared = await clearAllDocs();
  return Response.json({ cleared });
}
