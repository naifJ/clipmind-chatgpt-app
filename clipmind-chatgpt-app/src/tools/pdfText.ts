import { PDFParse } from "pdf-parse";

export async function extractPdfText(bytes: Buffer): Promise<{ text: string; pageCount: number }> {
  const parser = new PDFParse({ data: bytes });

  try {
    const result = await parser.getText();
    return {
      text: result.text.trim(),
      pageCount: result.total,
    };
  } finally {
    await parser.destroy();
  }
}
