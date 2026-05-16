import { extractPdfText } from "@/lib/extract-pdf";

export const maxDuration = 30;
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request): Promise<Response> {
  const ct = req.headers.get("content-type") || "";
  if (!ct.startsWith("multipart/form-data")) {
    return Response.json(
      { error: "Expected multipart/form-data with a 'file' field" },
      { status: 400 },
    );
  }
  let file: File | null = null;
  try {
    const form = await req.formData();
    const entry = form.get("file");
    if (entry instanceof File) file = entry;
  } catch {
    return Response.json({ error: "Could not parse form data" }, { status: 400 });
  }
  if (!file) {
    return Response.json({ error: "No 'file' field" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `File too large (${file.size} > ${MAX_BYTES} bytes)` },
      { status: 413 },
    );
  }
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    return Response.json({ error: "Only .pdf files supported" }, { status: 400 });
  }
  try {
    const buf = await file.arrayBuffer();
    const text = await extractPdfText(buf);
    return Response.json({ text, n_chars: text.length, filename: file.name });
  } catch (e) {
    return Response.json(
      {
        error: "PDF parse failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
