import { z } from "zod";

import type { FileReference } from "./types.js";

export const MAX_FILE_SIZE_BYTES = Number(process.env.MAX_FILE_SIZE_MB ?? "20") * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = Number(process.env.MAX_FILES_PER_REQUEST ?? "10");

export const fileReferenceSchema = z.object({
  file_id: z.string().optional(),
  download_url: z.string().url().optional(),
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
});

export function assertSafeFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[^\w .()[\]-]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  if (!sanitized || sanitized === "." || sanitized === "..") {
    return "file";
  }

  return sanitized;
}

export function assertPdfFile(file: FileReference, bytes: Buffer): void {
  const fileName = file.file_name ?? "document.pdf";
  const mimeType = file.mime_type ?? "application/pdf";

  if (bytes.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File ${fileName} exceeds the ${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)}MB limit.`);
  }

  if (mimeType && mimeType !== "application/pdf" && !fileName.toLowerCase().endsWith(".pdf")) {
    throw new Error(`File ${fileName} is not a PDF.`);
  }

  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error(`File ${fileName} does not look like a valid PDF.`);
  }
}

export function assertFileCount(count: number): void {
  if (count < 1) {
    throw new Error("At least one file is required.");
  }

  if (count > MAX_FILES_PER_REQUEST) {
    throw new Error(`Too many files. The current limit is ${MAX_FILES_PER_REQUEST}.`);
  }
}

export function parsePageRanges(ranges: string, pageCount: number): Array<{ start: number; end: number }> {
  const parsed = ranges
    .split(",")
    .map((range) => range.trim())
    .filter(Boolean)
    .map((range) => {
      const match = range.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) {
        throw new Error(`Invalid page range: ${range}`);
      }

      const start = Number(match[1]);
      const end = Number(match[2] ?? match[1]);

      if (start < 1 || end < 1 || start > end || end > pageCount) {
        throw new Error(`Page range ${range} is outside the document page count (${pageCount}).`);
      }

      return { start, end };
    });

  if (!parsed.length) {
    throw new Error("Page ranges are required, for example: 1-3,4-8.");
  }

  return parsed;
}
