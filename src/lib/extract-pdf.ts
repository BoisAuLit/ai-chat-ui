// PDF text extraction using `unpdf`, a pre-polyfilled pdf.js wrapper that
// works in Vercel serverless / edge runtimes. Replaces direct pdfjs-dist
// import which fails with "DOMMatrix is not defined" on Vercel.

import { extractText, getDocumentProxy } from "unpdf";

export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const data = new Uint8Array(buffer);
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  const out = Array.isArray(text) ? text.join("\n\n") : text;
  return (out || "").trim();
}
