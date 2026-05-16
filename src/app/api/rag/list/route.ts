import { listDocSummaries } from "@/lib/rag/store";

export async function GET(): Promise<Response> {
  return Response.json({ docs: listDocSummaries() });
}
