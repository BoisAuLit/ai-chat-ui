// Server-side PDF text extraction using pdfjs-dist's Node-friendly build.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyItem = any;

export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data, disableFontFace: true }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as AnyItem[];
    const pageText = items
      .filter((it) => typeof it === "object" && it !== null && "str" in it)
      .map((it) => (it as { str: string }).str)
      .join(" ");
    pages.push(pageText);
  }

  return pages.join("\n\n").trim();
}
