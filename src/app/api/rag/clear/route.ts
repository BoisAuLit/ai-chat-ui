import { clearAllDocs } from "@/lib/rag/store";

export async function POST(): Promise<Response> {
  const cleared = clearAllDocs();
  return Response.json({ cleared });
}
