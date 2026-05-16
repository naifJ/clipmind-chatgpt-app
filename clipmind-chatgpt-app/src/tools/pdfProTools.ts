import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { createHash } from "node:crypto";
import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";

import { fetchFileBytes, saveOutputFile } from "../lib/fileStorage.js";
import type { FileReference, WidgetOperationResult } from "../lib/types.js";
import { assertPdfFile, parsePageRanges } from "../lib/validation.js";
import { extractPdfText } from "./pdfText.js";

type PublicBase = {
  publicBaseUrl: string;
};

function outputName(base: string, suffix: string): string {
  const cleanBase = base.replace(/\.pdf$/i, "").replace(/[^\w.-]+/g, "_").slice(0, 70) || "document";
  return `${cleanBase}-${suffix}.pdf`;
}

function parsePageSet(pageSpec: string | undefined, pageCount: number): Set<number> {
  if (!pageSpec?.trim()) {
    return new Set(Array.from({ length: pageCount }, (_, index) => index + 1));
  }

  const ranges = parsePageRanges(pageSpec, pageCount);
  const pages = new Set<number>();
  for (const range of ranges) {
    for (let page = range.start; page <= range.end; page += 1) {
      pages.add(page);
    }
  }
  return pages;
}

async function embedRasterImage(pdf: PDFDocument, file: FileReference) {
  const bytes = await fetchFileBytes(file);
  const name = (file.file_name ?? "").toLowerCase();
  const mime = (file.mime_type ?? "").toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg") || name.endsWith(".jpg") || name.endsWith(".jpeg")) {
    return pdf.embedJpg(bytes);
  }
  if (mime.includes("png") || name.endsWith(".png")) {
    return pdf.embedPng(bytes);
  }
  throw new Error("Only PNG and JPG images are supported.");
}

async function loadPdf(file: FileReference): Promise<{ bytes: Buffer; pdf: PDFDocument; fileName: string }> {
  const bytes = await fetchFileBytes(file);
  assertPdfFile(file, bytes);
  return {
    bytes,
    pdf: await PDFDocument.load(bytes, { ignoreEncryption: false }),
    fileName: file.file_name ?? "document.pdf",
  };
}

export async function uploadPdf(params: { file: FileReference } & PublicBase): Promise<WidgetOperationResult> {
  const bytes = await fetchFileBytes(params.file);
  assertPdfFile(params.file, bytes);
  const saved = await saveOutputFile({
    bytes,
    fileName: params.file.file_name ?? "uploaded.pdf",
    mimeType: "application/pdf",
    publicBaseUrl: params.publicBaseUrl,
  });

  return {
    operation: "upload_pdf",
    status: "completed",
    summary_ar: "تم التحقق من ملف PDF وتجهيزه للمعالجة.",
    summary_en: "Validated and staged the PDF for processing.",
    files: [saved],
    details: { file_name: saved.file_name, size_bytes: saved.size_bytes },
  };
}

export async function analyzePdf(params: { file: FileReference } & PublicBase): Promise<WidgetOperationResult> {
  const { bytes, pdf, fileName } = await loadPdf(params.file);
  const hash = createHash("sha256").update(bytes).digest("hex");
  let textPreview = "";
  try {
    const text = await extractPdfText(bytes);
    textPreview = text.text.slice(0, 1200);
  } catch {
    textPreview = "";
  }

  return {
    operation: "analyze_pdf",
    status: "completed",
    summary_ar: `تم تحليل الملف: ${pdf.getPageCount()} صفحة.`,
    summary_en: `Analyzed PDF: ${pdf.getPageCount()} pages.`,
    files: [],
    details: {
      file_name: fileName,
      page_count: pdf.getPageCount(),
      size_bytes: bytes.length,
      sha256: hash,
      has_text_preview: Boolean(textPreview),
      text_preview: textPreview || null,
    },
  };
}

export async function reorderPages(params: {
  file: FileReference;
  order: number[];
  output_name?: string;
} & PublicBase): Promise<WidgetOperationResult> {
  const { pdf, fileName } = await loadPdf(params.file);
  const pageCount = pdf.getPageCount();
  if (!params.order.length || params.order.some((page) => page < 1 || page > pageCount)) {
    throw new Error(`Invalid page order. The PDF has ${pageCount} pages.`);
  }

  const out = await PDFDocument.create();
  const pages = await out.copyPages(pdf, params.order.map((page) => page - 1));
  pages.forEach((page) => out.addPage(page));

  const output = await saveOutputFile({
    bytes: await out.save(),
    fileName: params.output_name ?? outputName(fileName, "reordered"),
    mimeType: "application/pdf",
    publicBaseUrl: params.publicBaseUrl,
  });

  return {
    operation: "reorder_pages",
    status: "completed",
    summary_ar: "تمت إعادة ترتيب صفحات PDF.",
    summary_en: "Reordered PDF pages.",
    files: [output],
    details: { page_count: pageCount, order: params.order },
  };
}

export async function rotatePages(params: {
  file: FileReference;
  pages?: string;
  degrees: 90 | 180 | 270;
  output_name?: string;
} & PublicBase): Promise<WidgetOperationResult> {
  const { pdf, fileName } = await loadPdf(params.file);
  const selected = parsePageSet(params.pages, pdf.getPageCount());
  pdf.getPages().forEach((page, index) => {
    if (selected.has(index + 1)) {
      page.setRotation(degrees(params.degrees));
    }
  });

  const output = await saveOutputFile({
    bytes: await pdf.save(),
    fileName: params.output_name ?? outputName(fileName, "rotated"),
    mimeType: "application/pdf",
    publicBaseUrl: params.publicBaseUrl,
  });

  return {
    operation: "rotate_pages",
    status: "completed",
    summary_ar: "تم تدوير الصفحات المحددة.",
    summary_en: "Rotated the selected pages.",
    files: [output],
    details: { pages: [...selected], degrees: params.degrees },
  };
}

export async function deletePages(params: {
  file: FileReference;
  pages: string;
  output_name?: string;
} & PublicBase): Promise<WidgetOperationResult> {
  const { pdf, fileName } = await loadPdf(params.file);
  const toDelete = parsePageSet(params.pages, pdf.getPageCount());
  const keep = Array.from({ length: pdf.getPageCount() }, (_, index) => index + 1).filter(
    (page) => !toDelete.has(page)
  );
  if (!keep.length) {
    throw new Error("Cannot delete every page in the PDF.");
  }

  const out = await PDFDocument.create();
  const pages = await out.copyPages(pdf, keep.map((page) => page - 1));
  pages.forEach((page) => out.addPage(page));
  const output = await saveOutputFile({
    bytes: await out.save(),
    fileName: params.output_name ?? outputName(fileName, "deleted-pages"),
    mimeType: "application/pdf",
    publicBaseUrl: params.publicBaseUrl,
  });

  return {
    operation: "delete_pages",
    status: "completed",
    summary_ar: "تم حذف الصفحات المحددة وإنشاء ملف جديد.",
    summary_en: "Deleted selected pages and created a new PDF.",
    files: [output],
    details: { deleted_pages: [...toDelete], kept_pages: keep },
  };
}

export async function compressPdf(params: {
  file: FileReference;
  target_size_mb?: number;
  output_name?: string;
} & PublicBase): Promise<WidgetOperationResult> {
  const { bytes, pdf, fileName } = await loadPdf(params.file);
  const savedBytes = await pdf.save({ useObjectStreams: true, addDefaultPage: false });
  const output = await saveOutputFile({
    bytes: savedBytes,
    fileName: params.output_name ?? outputName(fileName, "compressed"),
    mimeType: "application/pdf",
    publicBaseUrl: params.publicBaseUrl,
  });

  const reduction = bytes.length ? Math.max(0, 1 - output.size_bytes / bytes.length) : 0;
  return {
    operation: "compress_pdf",
    status: "completed",
    summary_ar: "تم إنشاء نسخة PDF محسنة الحجم. الضغط المتقدم للصور يحتاج Ghostscript في المرحلة التالية.",
    summary_en: "Created a size-optimized PDF. Advanced image compression requires Ghostscript in the next phase.",
    files: [output],
    details: {
      original_size_bytes: bytes.length,
      output_size_bytes: output.size_bytes,
      estimated_reduction_percent: Math.round(reduction * 100),
      target_size_mb: params.target_size_mb ?? null,
      compression_mode: "pdf-lib object stream rewrite",
    },
  };
}

export async function addWatermark(params: {
  file: FileReference;
  text?: string;
  watermark_image?: FileReference;
  pages?: string;
  opacity?: number;
  font_size?: number;
  output_name?: string;
} & PublicBase): Promise<WidgetOperationResult> {
  const { pdf, fileName } = await loadPdf(params.file);
  if (!params.text?.trim() && !params.watermark_image) {
    throw new Error("Watermark text or image is required.");
  }

  const selected = parsePageSet(params.pages, pdf.getPageCount());
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const opacity = Math.max(0.05, Math.min(params.opacity ?? 0.18, 0.8));
  const fontSize = Math.max(10, Math.min(params.font_size ?? 44, 96));
  const image = params.watermark_image ? await embedRasterImage(pdf, params.watermark_image) : undefined;

  pdf.getPages().forEach((page, index) => {
    if (!selected.has(index + 1)) return;
    const { width, height } = page.getSize();

    if (params.text?.trim()) {
      page.drawText(params.text, {
        x: width * 0.18,
        y: height * 0.48,
        size: fontSize,
        font,
        color: rgb(0.15, 0.2, 0.3),
        opacity,
        rotate: degrees(-28),
      });
    }

    if (image) {
      const targetWidth = Math.min(width * 0.42, 260);
      const scale = targetWidth / image.width;
      page.drawImage(image, {
        x: (width - targetWidth) / 2,
        y: (height - image.height * scale) / 2,
        width: targetWidth,
        height: image.height * scale,
        opacity,
      });
    }
  });

  const output = await saveOutputFile({
    bytes: await pdf.save(),
    fileName: params.output_name ?? outputName(fileName, "watermarked"),
    mimeType: "application/pdf",
    publicBaseUrl: params.publicBaseUrl,
  });

  return {
    operation: "add_watermark",
    status: "completed",
    summary_ar: "تمت إضافة العلامة المائية إلى ملف PDF.",
    summary_en: "Added the watermark to the PDF.",
    files: [output],
    details: {
      pages: [...selected],
      text: params.text ?? null,
      image_watermark: Boolean(params.watermark_image),
      opacity,
      font_size: fontSize,
    },
  };
}

export async function addSignature(params: {
  file: FileReference;
  signature_image: FileReference;
  page: number;
  x?: number;
  y?: number;
  width?: number;
  output_name?: string;
} & PublicBase): Promise<WidgetOperationResult> {
  const { pdf, fileName } = await loadPdf(params.file);
  if (params.page < 1 || params.page > pdf.getPageCount()) {
    throw new Error(`Invalid page number. The PDF has ${pdf.getPageCount()} pages.`);
  }

  const imageBytes = await fetchFileBytes(params.signature_image);
  const imageName = params.signature_image.file_name ?? "signature.png";
  const embedded = imageName.toLowerCase().endsWith(".jpg") || imageName.toLowerCase().endsWith(".jpeg")
    ? await pdf.embedJpg(imageBytes)
    : await pdf.embedPng(imageBytes);
  const targetPage = pdf.getPage(params.page - 1);
  const pageSize = targetPage.getSize();
  const width = params.width ?? Math.min(180, pageSize.width * 0.28);
  const scale = width / embedded.width;
  const height = embedded.height * scale;

  targetPage.drawImage(embedded, {
    x: params.x ?? pageSize.width - width - 54,
    y: params.y ?? 54,
    width,
    height,
  });

  const output = await saveOutputFile({
    bytes: await pdf.save(),
    fileName: params.output_name ?? outputName(fileName, "signed"),
    mimeType: "application/pdf",
    publicBaseUrl: params.publicBaseUrl,
  });

  return {
    operation: "add_signature",
    status: "completed",
    summary_ar: "تمت إضافة صورة التوقيع إلى ملف PDF.",
    summary_en: "Added the signature image to the PDF.",
    files: [output],
    details: { page: params.page, width },
  };
}

export async function fillPdfForm(params: {
  file: FileReference;
  fields: Record<string, string | boolean>;
  output_name?: string;
} & PublicBase): Promise<WidgetOperationResult> {
  const { pdf, fileName } = await loadPdf(params.file);
  const form = pdf.getForm();
  const filled: string[] = [];
  const missing: string[] = [];

  for (const [name, value] of Object.entries(params.fields)) {
    const field = form.getFieldMaybe(name);
    if (!field) {
      missing.push(name);
      continue;
    }
    const typeName = field.constructor.name;
    if (typeName.includes("Text")) {
      form.getTextField(name).setText(String(value));
    } else if (typeName.includes("CheckBox")) {
      Boolean(value) ? form.getCheckBox(name).check() : form.getCheckBox(name).uncheck();
    } else {
      missing.push(name);
      continue;
    }
    filled.push(name);
  }

  const output = await saveOutputFile({
    bytes: await pdf.save(),
    fileName: params.output_name ?? outputName(fileName, "filled"),
    mimeType: "application/pdf",
    publicBaseUrl: params.publicBaseUrl,
  });

  return {
    operation: "fill_pdf_form",
    status: "completed",
    summary_ar: `تمت تعبئة ${filled.length} حقول في النموذج.`,
    summary_en: `Filled ${filled.length} form fields.`,
    files: [output],
    details: { filled_fields: filled, missing_or_unsupported_fields: missing },
  };
}

export async function extractText(params: { file: FileReference } & PublicBase): Promise<WidgetOperationResult> {
  const bytes = await fetchFileBytes(params.file);
  assertPdfFile(params.file, bytes);
  const text = await extractPdfText(bytes);
  const textBytes = Buffer.from(text.text, "utf8");
  const output = await saveOutputFile({
    bytes: textBytes,
    fileName: outputName(params.file.file_name ?? "document.pdf", "text").replace(/\.pdf$/i, ".txt"),
    mimeType: "text/plain; charset=utf-8",
    publicBaseUrl: params.publicBaseUrl,
  });

  return {
    operation: "extract_text",
    status: "completed",
    summary_ar: "تم استخراج النص من ملف PDF.",
    summary_en: "Extracted text from the PDF.",
    files: [output],
    details: { page_count: text.pageCount, text_chars: text.text.length, preview: text.text.slice(0, 1200) },
  };
}

export async function ocrPdf(params: {
  file: FileReference;
  language?: "Arabic" | "English" | "both";
  max_pages?: number;
} & PublicBase): Promise<WidgetOperationResult> {
  const bytes = await fetchFileBytes(params.file);
  assertPdfFile(params.file, bytes);
  const parser = new PDFParse({ data: bytes });
  const language = params.language ?? "both";
  const langCode = language === "Arabic" ? "ara" : language === "English" ? "eng" : "eng+ara";
  const maxPages = Math.max(1, Math.min(params.max_pages ?? 3, 5));
  const worker = await createWorker(langCode);

  try {
    const screenshots = await parser.getScreenshot({
      first: maxPages,
      imageBuffer: true,
      desiredWidth: 1600,
    });
    const texts: string[] = [];
    for (const page of screenshots.pages) {
      if (!page.data) continue;
      const result = await worker.recognize(Buffer.from(page.data));
      texts.push(`--- page ${page.pageNumber} ---\n${result.data.text.trim()}`);
    }
    const finalText = texts.join("\n\n").trim();
    const output = await saveOutputFile({
      bytes: Buffer.from(finalText, "utf8"),
      fileName: outputName(params.file.file_name ?? "document.pdf", "ocr").replace(/\.pdf$/i, ".txt"),
      mimeType: "text/plain; charset=utf-8",
      publicBaseUrl: params.publicBaseUrl,
    });

    return {
      operation: "ocr_pdf",
      status: "completed",
      summary_ar: "تم تنفيذ OCR وإخراج النص المستخرج. إنشاء PDF قابل للبحث ضمن المرحلة التالية.",
      summary_en: "OCR completed and extracted text. Searchable PDF generation is planned for the next phase.",
      files: [output],
      details: { language, pages_processed: texts.length, searchable_pdf: false, text_preview: finalText.slice(0, 1200) },
    };
  } finally {
    await worker.terminate();
    await parser.destroy();
  }
}

export async function extractImages(params: {
  file: FileReference;
  max_pages?: number;
} & PublicBase): Promise<WidgetOperationResult> {
  const bytes = await fetchFileBytes(params.file);
  assertPdfFile(params.file, bytes);
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getImage({
      first: Math.max(1, Math.min(params.max_pages ?? 5, 10)),
      imageBuffer: true,
    });
    const outputs = [];
    for (const page of result.pages) {
      for (const [index, image] of page.images.entries()) {
        if (!image.data) continue;
        outputs.push(
          await saveOutputFile({
            bytes: Buffer.from(image.data),
            fileName: `page-${page.pageNumber}-image-${index + 1}.png`,
            mimeType: "image/png",
            publicBaseUrl: params.publicBaseUrl,
          })
        );
      }
    }
    return {
      operation: "extract_images",
      status: "completed",
      summary_ar: `تم استخراج ${outputs.length} صور من PDF.`,
      summary_en: `Extracted ${outputs.length} images from the PDF.`,
      files: outputs,
      details: { image_count: outputs.length },
    };
  } finally {
    await parser.destroy();
  }
}

export async function pdfToImages(params: {
  file: FileReference;
  max_pages?: number;
} & PublicBase): Promise<WidgetOperationResult> {
  const bytes = await fetchFileBytes(params.file);
  assertPdfFile(params.file, bytes);
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getScreenshot({
      first: Math.max(1, Math.min(params.max_pages ?? 5, 10)),
      imageBuffer: true,
      desiredWidth: 1400,
    });
    const outputs = [];
    for (const page of result.pages) {
      if (!page.data) continue;
      outputs.push(
        await saveOutputFile({
          bytes: Buffer.from(page.data),
          fileName: `page-${page.pageNumber}.png`,
          mimeType: "image/png",
          publicBaseUrl: params.publicBaseUrl,
        })
      );
    }
    return {
      operation: "convert_pdf_to_images",
      status: "completed",
      summary_ar: `تم تحويل ${outputs.length} صفحات إلى صور.`,
      summary_en: `Converted ${outputs.length} pages to images.`,
      files: outputs,
      details: { image_count: outputs.length },
    };
  } finally {
    await parser.destroy();
  }
}

export async function imagesToPdf(params: {
  images: FileReference[];
  output_name?: string;
} & PublicBase): Promise<WidgetOperationResult> {
  if (!params.images.length) {
    throw new Error("At least one image is required.");
  }

  const pdf = await PDFDocument.create();
  for (const imageFile of params.images) {
    const image = await embedRasterImage(pdf, imageFile);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }

  const output = await saveOutputFile({
    bytes: await pdf.save(),
    fileName: params.output_name ?? "images-to-pdf.pdf",
    mimeType: "application/pdf",
    publicBaseUrl: params.publicBaseUrl,
  });

  return {
    operation: "images_to_pdf",
    status: "completed",
    summary_ar: `تم تحويل ${params.images.length} صور إلى ملف PDF.`,
    summary_en: `Converted ${params.images.length} images to a PDF.`,
    files: [output],
    details: { image_count: params.images.length },
  };
}

export async function comparePdfs(params: {
  left_file: FileReference;
  right_file: FileReference;
} & PublicBase): Promise<WidgetOperationResult> {
  const leftBytes = await fetchFileBytes(params.left_file);
  const rightBytes = await fetchFileBytes(params.right_file);
  assertPdfFile(params.left_file, leftBytes);
  assertPdfFile(params.right_file, rightBytes);
  const leftText = await extractPdfText(leftBytes).catch(() => ({ text: "", pageCount: 0 }));
  const rightText = await extractPdfText(rightBytes).catch(() => ({ text: "", pageCount: 0 }));
  const leftLines = new Set(leftText.text.split("\n").map((line) => line.trim()).filter(Boolean));
  const rightLines = new Set(rightText.text.split("\n").map((line) => line.trim()).filter(Boolean));
  const onlyLeft = [...leftLines].filter((line) => !rightLines.has(line)).slice(0, 50);
  const onlyRight = [...rightLines].filter((line) => !leftLines.has(line)).slice(0, 50);
  const diffText = [
    "Only in first PDF:",
    ...onlyLeft,
    "",
    "Only in second PDF:",
    ...onlyRight,
  ].join("\n");
  const output = await saveOutputFile({
    bytes: Buffer.from(diffText, "utf8"),
    fileName: "pdf-comparison.txt",
    mimeType: "text/plain; charset=utf-8",
    publicBaseUrl: params.publicBaseUrl,
  });

  return {
    operation: "compare_pdfs",
    status: "completed",
    summary_ar: "تمت مقارنة النصوص المستخرجة من الملفين. المقارنة البصرية المتقدمة ضمن TODO.",
    summary_en: "Compared extracted text from both PDFs. Advanced visual diff is listed as a TODO.",
    files: [output],
    details: {
      left_pages: leftText.pageCount,
      right_pages: rightText.pageCount,
      left_only_count: onlyLeft.length,
      right_only_count: onlyRight.length,
      visual_diff: false,
    },
  };
}

export async function exportPdf(params: {
  file: FileReference;
  output_name?: string;
} & PublicBase): Promise<WidgetOperationResult> {
  const bytes = await fetchFileBytes(params.file);
  assertPdfFile(params.file, bytes);
  const output = await saveOutputFile({
    bytes,
    fileName: params.output_name ?? params.file.file_name ?? "export.pdf",
    mimeType: "application/pdf",
    publicBaseUrl: params.publicBaseUrl,
  });

  return {
    operation: "export_pdf",
    status: "completed",
    summary_ar: "تم تجهيز ملف PDF للتنزيل.",
    summary_en: "Prepared the PDF for download.",
    files: [output],
    details: { exported: true },
  };
}

export async function unsupportedCommercialFeature(operation: string): Promise<WidgetOperationResult> {
  return {
    operation,
    status: "error",
    summary_ar: "هذه الميزة تحتاج مزود معالجة خارجي أو محرك تجاري ولم يتم تفعيلها بعد.",
    summary_en: "This feature needs an external processing provider or commercial engine and is not enabled yet.",
    files: [],
    details: {
      todo: true,
      planned_features: [
        "direct text editing inside PDFs",
        "replace images and logos",
        "perfect PDF to Word/PowerPoint conversion",
        "image-to-PDF conversion",
        "repair corrupted PDFs",
        "advanced visual diff",
        "contract analysis",
      ],
    },
  };
}
