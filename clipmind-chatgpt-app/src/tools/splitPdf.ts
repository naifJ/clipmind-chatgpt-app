import { PDFDocument } from "pdf-lib";

import { fetchFileBytes, saveOutputFile } from "../lib/fileStorage.js";
import type { FileReference, WidgetOperationResult } from "../lib/types.js";
import { assertPdfFile, parsePageRanges } from "../lib/validation.js";

export async function splitPdf(params: {
  file: FileReference;
  ranges: string;
  output_prefix?: string;
  publicBaseUrl: string;
}): Promise<WidgetOperationResult> {
  const bytes = await fetchFileBytes(params.file);
  assertPdfFile(params.file, bytes);

  const source = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const parsedRanges = parsePageRanges(params.ranges, source.getPageCount());
  const prefix = params.output_prefix ?? "split";
  const outputs = [];

  for (const range of parsedRanges) {
    const document = await PDFDocument.create();
    const pageIndexes = Array.from(
      { length: range.end - range.start + 1 },
      (_, index) => range.start - 1 + index
    );
    const pages = await document.copyPages(source, pageIndexes);
    for (const page of pages) {
      document.addPage(page);
    }

    const splitBytes = await document.save();
    outputs.push(
      await saveOutputFile({
        bytes: splitBytes,
        fileName: `${prefix}-${range.start}-${range.end}.pdf`,
        mimeType: "application/pdf",
        publicBaseUrl: params.publicBaseUrl,
      })
    );
  }

  return {
    operation: "split_pdf",
    status: "completed",
    summary_ar: `تم تقسيم ملف PDF إلى ${outputs.length} ملفات حسب النطاقات المطلوبة.`,
    summary_en: `Split the PDF into ${outputs.length} files using the requested page ranges.`,
    files: outputs,
    details: {
      original_file: params.file.file_name ?? "document.pdf",
      original_pages: source.getPageCount(),
      ranges: parsedRanges,
    },
  };
}
