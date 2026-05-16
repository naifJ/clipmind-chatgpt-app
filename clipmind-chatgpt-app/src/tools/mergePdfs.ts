import { PDFDocument } from "pdf-lib";

import { fetchFileBytes, saveOutputFile } from "../lib/fileStorage.js";
import type { FileReference, WidgetOperationResult } from "../lib/types.js";
import { assertFileCount, assertPdfFile } from "../lib/validation.js";

export async function mergePdfs(params: {
  files: FileReference[];
  sort_by_name?: boolean;
  output_name?: string;
  publicBaseUrl: string;
}): Promise<WidgetOperationResult> {
  assertFileCount(params.files.length);

  const files = [...params.files];
  if (params.sort_by_name) {
    files.sort((a, b) => (a.file_name ?? "").localeCompare(b.file_name ?? ""));
  }

  const merged = await PDFDocument.create();
  const sourceSummaries: Array<{ file_name: string; pages: number }> = [];

  for (const file of files) {
    const bytes = await fetchFileBytes(file);
    assertPdfFile(file, bytes);

    const source = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) {
      merged.addPage(page);
    }

    sourceSummaries.push({
      file_name: file.file_name ?? "document.pdf",
      pages: source.getPageCount(),
    });
  }

  const mergedBytes = await merged.save();
  const output = await saveOutputFile({
    bytes: mergedBytes,
    fileName: params.output_name ?? "merged.pdf",
    mimeType: "application/pdf",
    publicBaseUrl: params.publicBaseUrl,
  });

  return {
    operation: "merge_pdfs",
    status: "completed",
    summary_ar: `تم دمج ${files.length} ملفات PDF في ملف واحد.`,
    summary_en: `Merged ${files.length} PDF files into one document.`,
    files: [output],
    details: {
      input_files: sourceSummaries,
      total_pages: merged.getPageCount(),
      sorted_by_name: Boolean(params.sort_by_name),
    },
  };
}
