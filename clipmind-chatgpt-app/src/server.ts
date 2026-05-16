import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { cleanupExpiredFiles, ensureStorage, makePublicBaseUrl, readOutputFile, readOutputFileBytes } from "./lib/fileStorage.js";
import { startCleanupTimer } from "./lib/cleanup.js";
import { isRateLimited } from "./lib/rateLimit.js";
import { checkUsageAllowance } from "./lib/usageLimits.js";
import { fileReferenceSchema, MAX_FILE_SIZE_BYTES, MAX_FILES_PER_REQUEST } from "./lib/validation.js";
import { extractInvoiceData } from "./tools/extractInvoiceData.js";
import { mergePdfs } from "./tools/mergePdfs.js";
import {
  addSignature,
  addWatermark,
  analyzePdf,
  comparePdfs,
  compressPdf,
  deletePages,
  exportPdf,
  extractImages,
  extractText,
  fillPdfForm,
  ocrPdf,
  pdfToImages,
  reorderPages,
  rotatePages,
  uploadPdf,
  unsupportedCommercialFeature,
} from "./tools/pdfProTools.js";
import { splitPdf } from "./tools/splitPdf.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const WIDGET_URI = "ui://widget/pdf-pro-editor-v1.html";
const WIDGET_HTML = readFileSync(path.join(ROOT_DIR, "src", "ui", "pdf-widget.html"), "utf8");
const PRIVACY_HTML = readFileSync(path.join(ROOT_DIR, "public", "privacy.html"), "utf8");
const TERMS_HTML = readFileSync(path.join(ROOT_DIR, "public", "terms.html"), "utf8");

const outputFileSchema = z.object({
  file_id: z.string(),
  file_name: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().int(),
  download_url: z.string().url(),
});

const baseOperationOutputSchema = {
  operation: z.string(),
  status: z.enum(["ready", "processing", "completed", "error"]),
  summary_ar: z.string(),
  summary_en: z.string(),
  files: z.array(outputFileSchema),
  details: z.record(z.unknown()).optional(),
};

const confidenceStringSchema = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

const confidenceNumberSchema = z.object({
  value: z.number().nullable(),
  confidence: z.number().min(0).max(1),
});

const invoiceOutputSchema = {
  ...baseOperationOutputSchema,
  invoice_data: z.object({
    vendor_name: confidenceStringSchema,
    invoice_number: confidenceStringSchema,
    invoice_date: confidenceStringSchema,
    total_amount: confidenceNumberSchema,
    tax_amount: confidenceNumberSchema,
    currency: confidenceStringSchema,
    line_items: z.array(
      z.object({
        description: z.string().nullable(),
        quantity: z.number().nullable(),
        unit_price: z.number().nullable(),
        amount: z.number().nullable(),
        confidence: z.number().min(0).max(1),
      })
    ),
  }),
};

const unsupportedOutputSchema = {
  ...baseOperationOutputSchema,
};

const port = Number(process.env.PORT ?? "8787");
const MCP_PATH = "/mcp";
const SSE_PATH = "/sse";
const MESSAGES_PATH = "/messages";
const sseSessions = new Map<string, { transport: SSEServerTransport; server: McpServer }>();

function createAppServer(publicBaseUrl: string): McpServer {
  const server = new McpServer({
    name: "PDF Pro Editor",
    version: "0.1.0",
  });

  registerAppResource(server, "pdf-widget", WIDGET_URI, {}, async () => ({
    contents: [
      {
        uri: WIDGET_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: WIDGET_HTML,
        _meta: {
          ui: {
            prefersBorder: false,
            csp: {
              connectDomains: [],
              resourceDomains: [],
            },
          },
          "openai/widgetDescription":
            "PDF Pro Editor lets users upload, preview, edit, convert, OCR, and export PDFs directly inside ChatGPT.",
        },
      },
    ],
  }));

  registerAppTool(
    server,
    "upload_pdf",
    {
      title: "Upload PDF",
      description:
        "Use this when the user uploads or selects a PDF and wants it validated and staged for editing.",
      inputSchema: {
        file: fileReferenceSchema.describe("The PDF file reference authorized for this app."),
      },
      outputSchema: baseOperationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["file"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "رفع ملف PDF",
        "openai/toolInvocation/invoked": "تم تجهيز ملف PDF",
      },
    },
    async ({ file }) => {
      const structuredContent = await uploadPdf({ file, publicBaseUrl });
      return { content: [{ type: "text" as const, text: structuredContent.summary_ar }], structuredContent };
    }
  );

  registerAppTool(
    server,
    "analyze_pdf",
    {
      title: "Analyze PDF",
      description:
        "Use this when the user wants PDF metadata, page count, size, hash, and a text preview before choosing an operation.",
      inputSchema: {
        file: fileReferenceSchema.describe("The PDF file reference authorized for this app."),
      },
      outputSchema: baseOperationOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["file"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "تحليل ملف PDF",
        "openai/toolInvocation/invoked": "اكتمل تحليل ملف PDF",
      },
    },
    async ({ file }) => {
      const structuredContent = await analyzePdf({ file, publicBaseUrl });
      return { content: [{ type: "text" as const, text: structuredContent.summary_ar }], structuredContent };
    }
  );

  registerAppTool(
    server,
    "merge_pdfs",
    {
      title: "Merge PDFs",
      description:
        "Use this when the user wants to combine two or more PDF files into a single PDF, optionally sorted by file name.",
      inputSchema: {
        files: z
          .array(fileReferenceSchema)
          .min(2)
          .max(MAX_FILES_PER_REQUEST)
          .describe("PDF file references authorized for this app. Each file should include download_url."),
        sort_by_name: z
          .boolean()
          .default(false)
          .describe("Sort files alphabetically by file_name before merging."),
        output_name: z.string().optional().describe("Optional output PDF file name."),
      },
      outputSchema: baseOperationOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["files"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "دمج ملفات PDF",
        "openai/toolInvocation/invoked": "اكتمل دمج ملفات PDF",
      },
    },
    async ({ files, sort_by_name = false, output_name }) => {
      const structuredContent = await mergePdfs({
        files,
        sort_by_name,
        output_name,
        publicBaseUrl,
      });

      return {
        content: [{ type: "text" as const, text: structuredContent.summary_ar }],
        structuredContent,
      };
    }
  );

  registerAppTool(
    server,
    "split_pdf",
    {
      title: "Split PDF",
      description:
        "Use this when the user wants to split one PDF into page ranges such as 1-3,4-8.",
      inputSchema: {
        file: fileReferenceSchema.describe("The source PDF file reference authorized for this app."),
        ranges: z
          .string()
          .min(1)
          .describe("Comma-separated page ranges, for example 1-3,4-8,10."),
        output_prefix: z.string().optional().describe("Optional prefix for generated PDF files."),
      },
      outputSchema: baseOperationOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["file"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "تقسيم ملف PDF",
        "openai/toolInvocation/invoked": "اكتمل تقسيم ملف PDF",
      },
    },
    async ({ file, ranges, output_prefix }) => {
      const structuredContent = await splitPdf({
        file,
        ranges,
        output_prefix,
        publicBaseUrl,
      });

      return {
        content: [{ type: "text" as const, text: structuredContent.summary_ar }],
        structuredContent,
      };
    }
  );

  registerAppTool(
    server,
    "extract_invoice_data",
    {
      title: "Extract invoice data",
      description:
        "Use this when the user wants to extract structured invoice fields from a PDF invoice without guessing missing values.",
      inputSchema: {
        file: fileReferenceSchema.describe("The invoice PDF file reference authorized for this app."),
      },
      outputSchema: invoiceOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["file"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "استخراج بيانات الفاتورة",
        "openai/toolInvocation/invoked": "اكتمل استخراج بيانات الفاتورة",
      },
    },
    async ({ file }) => {
      const structuredContent = await extractInvoiceData({
        file,
        publicBaseUrl,
      });

      return {
        content: [
          {
            type: "text" as const,
            text:
              "تم استخراج بيانات الفاتورة كـ JSON مع درجات ثقة. القيم غير الموجودة تظهر null.",
          },
        ],
        structuredContent,
      };
    }
  );

  registerAppTool(
    server,
    "reorder_pages",
    {
      title: "Reorder pages",
      description: "Use this when the user wants to reorder PDF pages using an explicit page order.",
      inputSchema: {
        file: fileReferenceSchema.describe("The source PDF file."),
        order: z.array(z.number().int().positive()).min(1).describe("The new 1-based page order, such as [3,1,2]."),
        output_name: z.string().optional(),
      },
      outputSchema: baseOperationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["file"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "إعادة ترتيب الصفحات",
        "openai/toolInvocation/invoked": "اكتملت إعادة ترتيب الصفحات",
      },
    },
    async ({ file, order, output_name }) => {
      const structuredContent = await reorderPages({ file, order, output_name, publicBaseUrl });
      return { content: [{ type: "text" as const, text: structuredContent.summary_ar }], structuredContent };
    }
  );

  registerAppTool(
    server,
    "rotate_pages",
    {
      title: "Rotate pages",
      description: "Use this when the user wants to rotate all pages or selected PDF page ranges.",
      inputSchema: {
        file: fileReferenceSchema,
        pages: z.string().optional().describe("Optional ranges like 1-3,5. Omit for all pages."),
        degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]).default(90),
        output_name: z.string().optional(),
      },
      outputSchema: baseOperationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["file"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "تدوير الصفحات",
        "openai/toolInvocation/invoked": "اكتمل تدوير الصفحات",
      },
    },
    async ({ file, pages, degrees, output_name }) => {
      const structuredContent = await rotatePages({ file, pages, degrees, output_name, publicBaseUrl });
      return { content: [{ type: "text" as const, text: structuredContent.summary_ar }], structuredContent };
    }
  );

  registerAppTool(
    server,
    "delete_pages",
    {
      title: "Delete pages",
      description: "Use this when the user wants to delete specific PDF pages and export a new PDF.",
      inputSchema: {
        file: fileReferenceSchema,
        pages: z.string().min(1).describe("Ranges to delete, such as 2,4-6."),
        output_name: z.string().optional(),
      },
      outputSchema: baseOperationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["file"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "حذف الصفحات",
        "openai/toolInvocation/invoked": "اكتمل حذف الصفحات",
      },
    },
    async ({ file, pages, output_name }) => {
      const structuredContent = await deletePages({ file, pages, output_name, publicBaseUrl });
      return { content: [{ type: "text" as const, text: structuredContent.summary_ar }], structuredContent };
    }
  );

  registerAppTool(
    server,
    "compress_pdf",
    {
      title: "Compress PDF",
      description: "Use this when the user wants a smaller PDF file. This MVP does safe PDF object-stream rewriting.",
      inputSchema: {
        file: fileReferenceSchema,
        target_size_mb: z.number().positive().optional(),
        output_name: z.string().optional(),
      },
      outputSchema: baseOperationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["file"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "ضغط ملف PDF",
        "openai/toolInvocation/invoked": "اكتمل ضغط ملف PDF",
      },
    },
    async ({ file, target_size_mb, output_name }) => {
      const structuredContent = await compressPdf({ file, target_size_mb, output_name, publicBaseUrl });
      return { content: [{ type: "text" as const, text: structuredContent.summary_ar }], structuredContent };
    }
  );

  registerAppTool(
    server,
    "add_watermark",
    {
      title: "Add watermark",
      description: "Use this when the user wants to add a text watermark to selected pages or the whole PDF.",
      inputSchema: {
        file: fileReferenceSchema,
        text: z.string().min(1),
        pages: z.string().optional(),
        opacity: z.number().min(0.05).max(0.8).optional(),
        font_size: z.number().min(10).max(96).optional(),
        output_name: z.string().optional(),
      },
      outputSchema: baseOperationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["file"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "إضافة علامة مائية",
        "openai/toolInvocation/invoked": "اكتملت إضافة العلامة المائية",
      },
    },
    async ({ file, text, pages, opacity, font_size, output_name }) => {
      const structuredContent = await addWatermark({ file, text, pages, opacity, font_size, output_name, publicBaseUrl });
      return { content: [{ type: "text" as const, text: structuredContent.summary_ar }], structuredContent };
    }
  );

  registerAppTool(
    server,
    "add_signature",
    {
      title: "Add signature",
      description: "Use this when the user wants to place a signature PNG/JPG image on a PDF page.",
      inputSchema: {
        file: fileReferenceSchema,
        signature_image: fileReferenceSchema,
        page: z.number().int().positive(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().positive().optional(),
        output_name: z.string().optional(),
      },
      outputSchema: baseOperationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["file", "signature_image"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "إضافة التوقيع",
        "openai/toolInvocation/invoked": "اكتملت إضافة التوقيع",
      },
    },
    async ({ file, signature_image, page, x, y, width, output_name }) => {
      const structuredContent = await addSignature({ file, signature_image, page, x, y, width, output_name, publicBaseUrl });
      return { content: [{ type: "text" as const, text: structuredContent.summary_ar }], structuredContent };
    }
  );

  registerAppTool(
    server,
    "fill_pdf_form",
    {
      title: "Fill PDF form",
      description: "Use this when the user wants to fill AcroForm text or checkbox fields in a PDF.",
      inputSchema: {
        file: fileReferenceSchema,
        fields: z.record(z.union([z.string(), z.boolean()])),
        output_name: z.string().optional(),
      },
      outputSchema: baseOperationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["file"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "تعبئة نموذج PDF",
        "openai/toolInvocation/invoked": "اكتملت تعبئة نموذج PDF",
      },
    },
    async ({ file, fields, output_name }) => {
      const structuredContent = await fillPdfForm({ file, fields, output_name, publicBaseUrl });
      return { content: [{ type: "text" as const, text: structuredContent.summary_ar }], structuredContent };
    }
  );

  registerAppTool(
    server,
    "ocr_pdf",
    {
      title: "OCR PDF",
      description: "Use this when the user wants OCR text extraction from scanned PDF pages.",
      inputSchema: {
        file: fileReferenceSchema,
        language: z.enum(["Arabic", "English", "both"]).default("both"),
        max_pages: z.number().int().min(1).max(5).optional(),
      },
      outputSchema: baseOperationOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["file"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "تشغيل OCR",
        "openai/toolInvocation/invoked": "اكتمل OCR",
      },
    },
    async ({ file, language = "both", max_pages }) => {
      const structuredContent = await ocrPdf({ file, language, max_pages, publicBaseUrl });
      return { content: [{ type: "text" as const, text: structuredContent.summary_ar }], structuredContent };
    }
  );

  registerAppTool(
    server,
    "extract_text",
    {
      title: "Extract text",
      description: "Use this when the user wants to extract the embedded text layer from a PDF.",
      inputSchema: { file: fileReferenceSchema },
      outputSchema: baseOperationOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["file"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "استخراج النص",
        "openai/toolInvocation/invoked": "اكتمل استخراج النص",
      },
    },
    async ({ file }) => {
      const structuredContent = await extractText({ file, publicBaseUrl });
      return { content: [{ type: "text" as const, text: structuredContent.summary_ar }], structuredContent };
    }
  );

  registerAppTool(
    server,
    "extract_images",
    {
      title: "Extract images",
      description: "Use this when the user wants embedded images extracted from a PDF.",
      inputSchema: { file: fileReferenceSchema, max_pages: z.number().int().min(1).max(10).optional() },
      outputSchema: baseOperationOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["file"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "استخراج الصور",
        "openai/toolInvocation/invoked": "اكتمل استخراج الصور",
      },
    },
    async ({ file, max_pages }) => {
      const structuredContent = await extractImages({ file, max_pages, publicBaseUrl });
      return { content: [{ type: "text" as const, text: structuredContent.summary_ar }], structuredContent };
    }
  );

  registerAppTool(
    server,
    "convert_pdf_to_images",
    {
      title: "Convert PDF to images",
      description: "Use this when the user wants PDF pages exported as PNG images.",
      inputSchema: { file: fileReferenceSchema, max_pages: z.number().int().min(1).max(10).optional() },
      outputSchema: baseOperationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["file"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "تحويل PDF إلى صور",
        "openai/toolInvocation/invoked": "اكتمل تحويل PDF إلى صور",
      },
    },
    async ({ file, max_pages }) => {
      const structuredContent = await pdfToImages({ file, max_pages, publicBaseUrl });
      return { content: [{ type: "text" as const, text: structuredContent.summary_ar }], structuredContent };
    }
  );

  registerAppTool(
    server,
    "compare_pdfs",
    {
      title: "Compare PDFs",
      description: "Use this when the user wants to compare the extracted text of two PDFs.",
      inputSchema: {
        left_file: fileReferenceSchema,
        right_file: fileReferenceSchema,
      },
      outputSchema: baseOperationOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["left_file", "right_file"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "مقارنة ملفات PDF",
        "openai/toolInvocation/invoked": "اكتملت مقارنة ملفات PDF",
      },
    },
    async ({ left_file, right_file }) => {
      const structuredContent = await comparePdfs({ left_file, right_file, publicBaseUrl });
      return { content: [{ type: "text" as const, text: structuredContent.summary_ar }], structuredContent };
    }
  );

  registerAppTool(
    server,
    "export_pdf",
    {
      title: "Export PDF",
      description: "Use this when the user wants the current or selected PDF prepared as a downloadable PDF.",
      inputSchema: {
        file: fileReferenceSchema,
        output_name: z.string().optional(),
      },
      outputSchema: baseOperationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/fileParams": ["file"],
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "تجهيز التصدير",
        "openai/toolInvocation/invoked": "اكتمل التصدير",
      },
    },
    async ({ file, output_name }) => {
      const structuredContent = await exportPdf({ file, output_name, publicBaseUrl });
      return { content: [{ type: "text" as const, text: structuredContent.summary_ar }], structuredContent };
    }
  );

  for (const toolName of [
    "edit_pdf_text",
    "replace_image_or_logo",
    "export_to_word",
    "export_to_powerpoint",
    "images_to_pdf",
    "repair_pdf",
    "advanced_visual_diff",
    "analyze_contract",
  ]) {
    registerAppTool(
      server,
      toolName,
      {
        title: toolName.replaceAll("_", " "),
        description:
          "Use this only to explain that the requested commercial-grade PDF operation is planned but not enabled in this MVP.",
        inputSchema: { file: fileReferenceSchema.optional() },
        outputSchema: unsupportedOutputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        _meta: {
          ui: { resourceUri: WIDGET_URI },
          "openai/fileParams": ["file"],
          "openai/outputTemplate": WIDGET_URI,
          "openai/toolInvocation/invoking": "فحص توفر الميزة",
          "openai/toolInvocation/invoked": "الميزة ضمن الخطة القادمة",
        },
      },
      async () => {
        const structuredContent = await unsupportedCommercialFeature(toolName);
        return { content: [{ type: "text" as const, text: structuredContent.summary_ar }], structuredContent };
      }
    );
  }

  return server;
}

function clientKey(req: { socket: { remoteAddress?: string }; headers: Record<string, string | string[] | undefined> }): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string") {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return req.socket.remoteAddress ?? "unknown";
}

function isAppRoute(pathname: string): boolean {
  return (
    pathname === MCP_PATH ||
    pathname.startsWith(MCP_PATH + "/") ||
    pathname === SSE_PATH ||
    pathname === MESSAGES_PATH
  );
}

async function handleRequest(req: express.Request, res: express.Response): Promise<void> {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, "http://" + (req.headers.host ?? "localhost"));
  const isMcpRoute = url.pathname === MCP_PATH || url.pathname.startsWith(MCP_PATH + "/");
  const isSseRoute = url.pathname === SSE_PATH || url.pathname === MESSAGES_PATH;
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? makePublicBaseUrl(req);

  if (isAppRoute(url.pathname) && isRateLimited(clientKey(req))) {
    res.writeHead(429, { "content-type": "text/plain" }).end("Rate limit exceeded");
    return;
  }

  if (isAppRoute(url.pathname)) {
    const allowance = checkUsageAllowance({
      plan: process.env.DEFAULT_PLAN,
      estimatedCredits: 1,
      usedCredits: Number(process.env.USAGE_CREDITS_USED ?? "0"),
    });
    if (!allowance.allowed) {
      res.writeHead(402, { "content-type": "application/json; charset=utf-8" }).end(
        JSON.stringify({
          error: "usage_limit_reached",
          plan: allowance.plan,
          remainingCredits: allowance.remainingCredits,
          reason: allowance.reason,
        })
      );
      return;
    }
  }

  if (req.method === "OPTIONS" && (isMcpRoute || isSseRoute)) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("PDF Pro Editor MCP server");
    return;
  }

  if (req.method === "GET" && url.pathname === "/preview") {
    res.writeHead(200, { "content-type": RESOURCE_MIME_TYPE }).end(WIDGET_HTML);
    return;
  }

  if (req.method === "GET" && (url.pathname === "/privacy" || url.pathname === "/privacy-policy")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PRIVACY_HTML);
    return;
  }

  if (req.method === "GET" && (url.pathname === "/terms" || url.pathname === "/terms-of-use")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(TERMS_HTML);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/downloads/")) {
    const id = url.pathname.replace("/downloads/", "").trim();
    const file = await readOutputFile(id);
    const bytes = await readOutputFileBytes(id);

    if (!file || !bytes) {
      res.writeHead(404, { "content-type": "text/plain" }).end("File not found or expired");
      return;
    }

    res.writeHead(200, {
      "content-type": file.mimeType,
      "content-length": String(file.sizeBytes),
      "content-disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
      "cache-control": "private, max-age=1800",
    });
    res.end(bytes);
    return;
  }

  const transportMethods = new Set(["GET", "POST", "DELETE"]);
  if (req.method === "GET" && url.pathname === SSE_PATH) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const transport = new SSEServerTransport(MESSAGES_PATH, res);
    const server = createAppServer(publicBaseUrl);
    sseSessions.set(transport.sessionId, { transport, server });

    res.on("close", () => {
      sseSessions.delete(transport.sessionId);
      server.close();
    });

    try {
      await server.connect(transport);
    } catch (error) {
      console.error("Failed to open SSE transport:", error instanceof Error ? error.message : error);
      sseSessions.delete(transport.sessionId);
      server.close();
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  if (req.method === "POST" && url.pathname === MESSAGES_PATH) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const sessionId = url.searchParams.get("sessionId");
    const session = sessionId ? sseSessions.get(sessionId) : undefined;

    if (!session) {
      res.writeHead(400).end("No SSE transport found for sessionId");
      return;
    }

    try {
      await session.transport.handlePostMessage(req, res);
    } catch (error) {
      console.error("Failed to handle SSE message:", error instanceof Error ? error.message : error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  if (isMcpRoute && req.method && transportMethods.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createAppServer(publicBaseUrl);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Failed to handle MCP request:", error instanceof Error ? error.message : error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  res.writeHead(404).end("Not Found");
}

await ensureStorage();
startCleanupTimer();

const app = express();
app.disable("x-powered-by");
app.all("*splat", (req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error("Unhandled request error:", error instanceof Error ? error.message : error);
    if (!res.headersSent) {
      res.writeHead(500).end("Internal server error");
    }
  });
});

app.listen(port, () => {
  console.log("PDF Pro Editor MCP server listening on http://localhost:" + port + MCP_PATH);
  console.log(`Max file size: ${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)}MB`);
});
