import crypto from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const APP_NAME = "Stirling PDF for ChatGPT";
const APP_VERSION = "1.0.0";
const WIDGET_URI = "ui://widget/stirling-pdf-chatgpt-v1.html";
const APP_MIME_TYPE = "text/html;profile=mcp-app";

const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");
const STIRLING_BASE_URL = (process.env.STIRLING_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const STIRLING_PUBLIC_URL = (process.env.STIRLING_PUBLIC_URL ?? STIRLING_BASE_URL).replace(/\/$/, "");
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB ?? 50);
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const API_KEY = process.env.API_KEY;

type FileReference = {
  download_url: string;
  file_id: string;
  file_name?: string;
  mime_type?: string;
};

type StoredDownload = {
  bytes: Buffer;
  filename: string;
  contentType: string;
  createdAt: number;
};

type StirlingResult = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  downloadUrl: string;
};

const downloads = new Map<string, StoredDownload>();
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, file] of downloads.entries()) {
    if (file.createdAt < cutoff) downloads.delete(id);
  }
}, 10 * 60 * 1000).unref();

const fileReferenceSchema = z.object({
  download_url: z.string().url(),
  file_id: z.string().min(1),
  file_name: z.string().optional(),
  mime_type: z.string().optional()
});

const angleSchema = z.union([z.literal(90), z.literal(180), z.literal(270), z.literal(-90), z.literal(-180), z.literal(-270)]);

function sanitizeFilename(name: string | undefined, fallback: string) {
  const base = (name || fallback).split(/[\\/]/).pop() || fallback;
  return base.replace(/[^\w.\-() ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 180) || fallback;
}

function parseContentDispositionFilename(header: string | null, fallback: string) {
  if (!header) return fallback;
  const utfMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) return sanitizeFilename(decodeURIComponent(utfMatch[1]), fallback);
  const match = header.match(/filename="?([^";]+)"?/i);
  return sanitizeFilename(match?.[1], fallback);
}

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!API_KEY) return next();
  const auth = req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : req.header("x-api-key");
  if (token === API_KEY) return next();
  res.status(401).json({ error: "Unauthorized" });
}

function rateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > 120) {
    res.status(429).json({ error: "Rate limit exceeded" });
    return;
  }
  next();
}

async function fetchFile(file: FileReference, expected: "pdf" | "any" = "pdf") {
  const response = await fetch(file.download_url);
  if (!response.ok) {
    throw new Error(`Unable to download ${file.file_name ?? file.file_id}: ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_FILE_BYTES) {
    throw new Error(`File is larger than the ${MAX_FILE_MB}MB limit.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_FILE_BYTES) {
    throw new Error(`File is larger than the ${MAX_FILE_MB}MB limit.`);
  }

  const filename = sanitizeFilename(file.file_name, expected === "pdf" ? "document.pdf" : "upload.bin");
  const mimeType = file.mime_type ?? response.headers.get("content-type") ?? "application/octet-stream";
  if (expected === "pdf") {
    const looksPdf = filename.toLowerCase().endsWith(".pdf") || mimeType.includes("pdf");
    if (!looksPdf) throw new Error(`${filename} is not a PDF file.`);
  }

  return {
    bytes: Buffer.from(arrayBuffer),
    filename,
    mimeType
  };
}

async function postToStirling(endpoint: string, parts: Array<{ name: string; value: string | number | boolean } | { name: string; file: Awaited<ReturnType<typeof fetchFile>> }>, fallbackFilename: string): Promise<StirlingResult> {
  const form = new FormData();
  for (const part of parts) {
    if ("file" in part) {
      form.append(part.name, new Blob([part.file.bytes], { type: part.file.mimeType }), part.file.filename);
    } else if (part.value !== undefined && part.value !== null) {
      form.append(part.name, String(part.value));
    }
  }

  const response = await fetch(`${STIRLING_BASE_URL}${endpoint}`, {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Stirling-PDF returned ${response.status}: ${text.slice(0, 500) || response.statusText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const filename = parseContentDispositionFilename(response.headers.get("content-disposition"), fallbackFilename);
  const id = crypto.randomUUID();
  downloads.set(id, { bytes, filename, contentType, createdAt: Date.now() });

  return {
    id,
    filename,
    contentType,
    sizeBytes: bytes.byteLength,
    downloadUrl: `${PUBLIC_BASE_URL}/downloads/${id}`
  };
}

function toolResult(operation: string, result: StirlingResult) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${operation} completed. Download: ${result.downloadUrl}`
      }
    ],
    structuredContent: {
      operation,
      status: "completed",
      filename: result.filename,
      mime_type: result.contentType,
      size_bytes: result.sizeBytes,
      download_url: result.downloadUrl,
      file_id: result.id
    },
    _meta: {
      result,
      stirlingPublicUrl: STIRLING_PUBLIC_URL
    }
  };
}

function errorResult(operation: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `${operation} failed: ${message}` }],
    structuredContent: {
      operation,
      status: "error",
      error: message
    },
    _meta: { error: message }
  };
}

function createServer() {
  const server = new McpServer({ name: APP_NAME, version: APP_VERSION });

  server.registerResource(
    "stirling_pdf_widget",
    WIDGET_URI,
    {
      title: APP_NAME,
      description: "A ChatGPT widget for editing PDFs through Stirling-PDF.",
      mimeType: APP_MIME_TYPE
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: APP_MIME_TYPE,
          text: widgetHtml(),
          _meta: {
            "openai/widgetDescription": "Edit, merge, split, compress, OCR, watermark, and export PDFs using Stirling-PDF inside ChatGPT.",
            "openai/widgetPrefersBorder": true,
            "openai/widgetCSP": {
              connect_domains: [PUBLIC_BASE_URL, STIRLING_BASE_URL, STIRLING_PUBLIC_URL],
              resource_domains: [PUBLIC_BASE_URL, STIRLING_PUBLIC_URL],
              frame_domains: [STIRLING_PUBLIC_URL]
            },
            "ui.csp": {
              connectDomains: [PUBLIC_BASE_URL, STIRLING_BASE_URL, STIRLING_PUBLIC_URL],
              resourceDomains: [PUBLIC_BASE_URL, STIRLING_PUBLIC_URL],
              frameDomains: [STIRLING_PUBLIC_URL]
            },
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains: [PUBLIC_BASE_URL, STIRLING_BASE_URL, STIRLING_PUBLIC_URL],
                resourceDomains: [PUBLIC_BASE_URL, STIRLING_PUBLIC_URL],
                frameDomains: [STIRLING_PUBLIC_URL]
              }
            }
          }
        }
      ]
    })
  );

  server.registerTool(
    "open_pdf_editor",
    {
      title: "Open Stirling PDF editor",
      description: "Use this when the user wants to open the PDF editor interface inside ChatGPT before choosing a PDF operation.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "Opening PDF editor",
        "openai/toolInvocation/invoked": "PDF editor opened",
        "ui.resourceUri": WIDGET_URI
      }
    },
    async () => ({
      content: [{ type: "text" as const, text: "Stirling PDF editor is ready." }],
      structuredContent: {
        operation: "open_editor",
        status: "ready",
        stirling_public_url: STIRLING_PUBLIC_URL
      },
      _meta: { stirlingPublicUrl: STIRLING_PUBLIC_URL }
    })
  );

  server.registerTool(
    "merge_pdfs",
    {
      title: "Merge PDFs",
      description: "Use this when the user asks to merge multiple PDF files into one PDF.",
      inputSchema: {
        files: z.array(fileReferenceSchema).min(2).describe("PDF files in the order they should be merged.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: commonToolMeta(["files"], "Merging PDFs", "PDFs merged")
    },
    async ({ files }) => {
      try {
        const uploads = await Promise.all(files.map((file) => fetchFile(file, "pdf")));
        const result = await postToStirling(
          "/api/v1/general/merge-pdfs",
          [
            ...uploads.map((file) => ({ name: "fileInput", file })),
            { name: "sortType", value: "orderProvided" }
          ],
          "merged.pdf"
        );
        return toolResult("merge_pdfs", result);
      } catch (error) {
        return errorResult("merge_pdfs", error);
      }
    }
  );

  server.registerTool(
    "split_pdf",
    {
      title: "Split PDF",
      description: "Use this when the user asks to split a PDF by page numbers or ranges, such as 1-3,4-8 or all.",
      inputSchema: {
        file: fileReferenceSchema.describe("The PDF file to split."),
        page_numbers: z.string().default("all").describe("Pages or ranges to split at, for example 1-3,4-8,10 or all.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: commonToolMeta(["file"], "Splitting PDF", "PDF split")
    },
    async ({ file, page_numbers }) => {
      try {
        const upload = await fetchFile(file, "pdf");
        const result = await postToStirling(
          "/api/v1/general/split-pages",
          [
            { name: "fileInput", file: upload },
            { name: "pageNumbers", value: page_numbers || "all" }
          ],
          "split.zip"
        );
        return toolResult("split_pdf", result);
      } catch (error) {
        return errorResult("split_pdf", error);
      }
    }
  );

  server.registerTool(
    "reorder_pages",
    {
      title: "Reorder PDF pages",
      description: "Use this when the user asks to reorder pages in a PDF using a page order like 3,1,2 or 1-3,7,4-6.",
      inputSchema: {
        file: fileReferenceSchema,
        page_order: z.string().min(1).describe("New page order, for example 3,1,2 or 1-3,7,4-6.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: commonToolMeta(["file"], "Reordering pages", "Pages reordered")
    },
    async ({ file, page_order }) => {
      try {
        const upload = await fetchFile(file, "pdf");
        const result = await postToStirling(
          "/api/v1/general/rearrange-pages",
          [
            { name: "fileInput", file: upload },
            { name: "pageNumbers", value: page_order },
            { name: "customMode", value: "custom" }
          ],
          "reordered.pdf"
        );
        return toolResult("reorder_pages", result);
      } catch (error) {
        return errorResult("reorder_pages", error);
      }
    }
  );

  server.registerTool(
    "delete_pages",
    {
      title: "Delete PDF pages",
      description: "Use this when the user asks to remove pages from a PDF.",
      inputSchema: {
        file: fileReferenceSchema,
        page_numbers: z.string().min(1).describe("Pages or ranges to delete, for example 2,5-7.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: commonToolMeta(["file"], "Deleting pages", "Pages deleted")
    },
    async ({ file, page_numbers }) => {
      try {
        const upload = await fetchFile(file, "pdf");
        const result = await postToStirling(
          "/api/v1/general/remove-pages",
          [
            { name: "fileInput", file: upload },
            { name: "pageNumbers", value: page_numbers }
          ],
          "removed-pages.pdf"
        );
        return toolResult("delete_pages", result);
      } catch (error) {
        return errorResult("delete_pages", error);
      }
    }
  );

  server.registerTool(
    "rotate_pdf",
    {
      title: "Rotate PDF",
      description: "Use this when the user asks to rotate every page in a PDF by a multiple of 90 degrees.",
      inputSchema: {
        file: fileReferenceSchema,
        angle: angleSchema.default(90).describe("Rotation angle. Must be a multiple of 90.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: commonToolMeta(["file"], "Rotating PDF", "PDF rotated")
    },
    async ({ file, angle }) => {
      try {
        const upload = await fetchFile(file, "pdf");
        const result = await postToStirling(
          "/api/v1/general/rotate-pdf",
          [
            { name: "fileInput", file: upload },
            { name: "angle", value: angle }
          ],
          "rotated.pdf"
        );
        return toolResult("rotate_pdf", result);
      } catch (error) {
        return errorResult("rotate_pdf", error);
      }
    }
  );

  server.registerTool(
    "compress_pdf",
    {
      title: "Compress PDF",
      description: "Use this when the user asks to reduce a PDF file size.",
      inputSchema: {
        file: fileReferenceSchema,
        optimize_level: z.number().int().min(1).max(9).default(3).describe("Compression level from 1 to 9."),
        expected_output_size: z.string().optional().describe("Optional target size such as 2MB.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: commonToolMeta(["file"], "Compressing PDF", "PDF compressed")
    },
    async ({ file, optimize_level, expected_output_size }) => {
      try {
        const upload = await fetchFile(file, "pdf");
        const parts: Parameters<typeof postToStirling>[1] = [{ name: "fileInput", file: upload }];
        if (expected_output_size) parts.push({ name: "expectedOutputSize", value: expected_output_size });
        else parts.push({ name: "optimizeLevel", value: optimize_level });
        const result = await postToStirling("/api/v1/misc/compress-pdf", parts, "compressed.pdf");
        return toolResult("compress_pdf", result);
      } catch (error) {
        return errorResult("compress_pdf", error);
      }
    }
  );

  server.registerTool(
    "ocr_pdf",
    {
      title: "OCR PDF",
      description: "Use this when the user asks to make a scanned PDF searchable with OCR.",
      inputSchema: {
        file: fileReferenceSchema,
        languages: z.array(z.string()).default(["eng"]).describe("Tesseract language codes, for example eng, ara, eng+ara as separate values."),
        ocr_render_type: z.enum(["sandwich", "hocr"]).default("sandwich")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: commonToolMeta(["file"], "Running OCR", "OCR completed")
    },
    async ({ file, languages, ocr_render_type }) => {
      try {
        const upload = await fetchFile(file, "pdf");
        const result = await postToStirling(
          "/api/v1/misc/ocr-pdf",
          [
            { name: "fileInput", file: upload },
            ...languages.map((language) => ({ name: "languages", value: language })),
            { name: "ocrType", value: "skip-text" },
            { name: "ocrRenderType", value: ocr_render_type },
            { name: "sidecar", value: false },
            { name: "deskew", value: true },
            { name: "clean", value: false },
            { name: "cleanFinal", value: false },
            { name: "removeImagesAfter", value: false }
          ],
          "ocr.pdf"
        );
        return toolResult("ocr_pdf", result);
      } catch (error) {
        return errorResult("ocr_pdf", error);
      }
    }
  );

  server.registerTool(
    "add_watermark",
    {
      title: "Add watermark",
      description: "Use this when the user asks to add a text watermark to a PDF.",
      inputSchema: {
        file: fileReferenceSchema,
        text: z.string().min(1).describe("Watermark text."),
        opacity: z.number().min(0.05).max(1).default(0.3),
        rotation: z.number().default(45),
        font_size: z.number().min(8).max(160).default(48),
        color: z.string().default("#808080")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: commonToolMeta(["file"], "Adding watermark", "Watermark added")
    },
    async ({ file, text, opacity, rotation, font_size, color }) => {
      try {
        const upload = await fetchFile(file, "pdf");
        const result = await postToStirling(
          "/api/v1/security/add-watermark",
          [
            { name: "fileInput", file: upload },
            { name: "watermarkType", value: "text" },
            { name: "watermarkText", value: text },
            { name: "alphabet", value: "roman" },
            { name: "fontSize", value: font_size },
            { name: "rotation", value: rotation },
            { name: "opacity", value: opacity },
            { name: "widthSpacer", value: 50 },
            { name: "heightSpacer", value: 50 },
            { name: "customColor", value: color },
            { name: "convertPDFToImage", value: false }
          ],
          "watermarked.pdf"
        );
        return toolResult("add_watermark", result);
      } catch (error) {
        return errorResult("add_watermark", error);
      }
    }
  );

  server.registerTool(
    "extract_images",
    {
      title: "Extract images",
      description: "Use this when the user asks to extract embedded images from a PDF.",
      inputSchema: {
        file: fileReferenceSchema,
        format: z.enum(["png", "jpeg", "gif"]).default("png")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: commonToolMeta(["file"], "Extracting images", "Images extracted")
    },
    async ({ file, format }) => {
      try {
        const upload = await fetchFile(file, "pdf");
        const result = await postToStirling(
          "/api/v1/misc/extract-images",
          [
            { name: "fileInput", file: upload },
            { name: "format", value: format }
          ],
          "images.zip"
        );
        return toolResult("extract_images", result);
      } catch (error) {
        return errorResult("extract_images", error);
      }
    }
  );

  return server;
}

function commonToolMeta(fileParams: string[], invoking: string, invoked: string) {
  return {
    "openai/outputTemplate": WIDGET_URI,
    "openai/fileParams": fileParams,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
    "ui.resourceUri": WIDGET_URI,
    ui: { resourceUri: WIDGET_URI }
  };
}

function widgetHtml() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Stirling PDF</title>
  <style>
    :root { color-scheme: light dark; --accent:#e84444; --line:#d8dee8; --soft:#f6f7f9; --ink:#172033; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:var(--ink); background:#fff; }
    .app { min-height:100vh; display:flex; flex-direction:column; }
    .top { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 18px; border-bottom:1px solid var(--line); background:#fff; position:sticky; top:0; z-index:2; }
    .brand { display:flex; align-items:center; gap:10px; font-weight:800; font-size:18px; letter-spacing:0; }
    .mark { width:32px; height:32px; border-radius:8px; background:var(--accent); color:white; display:grid; place-items:center; font-weight:900; font-size:24px; line-height:1; }
    .actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    button, a.button { border:1px solid var(--line); background:white; color:var(--ink); min-height:36px; padding:8px 12px; border-radius:8px; font-weight:650; cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:6px; white-space:nowrap; }
    button.primary, a.primary { background:var(--accent); border-color:var(--accent); color:white; }
    button:disabled { opacity:.55; cursor:not-allowed; }
    .shell { display:grid; grid-template-columns:220px minmax(0,1fr); min-height:0; flex:1; }
    .sidebar { border-inline-end:1px solid var(--line); background:var(--soft); padding:14px; overflow:auto; }
    .thumb { background:#fff; border:1px solid var(--line); border-radius:8px; aspect-ratio:3/4; margin-bottom:12px; display:grid; place-items:center; color:#7b8495; font-size:13px; text-align:center; padding:10px; }
    .workspace { min-width:0; display:flex; flex-direction:column; background:#eef2f6; }
    .toolbar { display:flex; gap:6px; padding:10px 14px; border-bottom:1px solid var(--line); background:#fff; overflow:auto; }
    .canvas { flex:1; min-height:420px; padding:18px; overflow:auto; display:grid; place-items:start center; }
    .page { width:min(100%, 900px); min-height:560px; background:white; border:1px solid #cfd6e2; box-shadow:0 8px 30px rgba(17,24,39,.12); border-radius:4px; overflow:hidden; display:flex; flex-direction:column; }
    .empty { flex:1; display:grid; place-items:center; text-align:center; padding:32px; color:#536073; }
    .empty h1 { margin:0 0 8px; font-size:24px; letter-spacing:0; }
    .empty p { margin:0; max-width:540px; line-height:1.6; }
    .result { padding:18px; border-top:1px solid var(--line); background:#fff; display:grid; gap:10px; }
    .status { font-size:14px; color:#536073; }
    iframe, embed { border:0; width:100%; min-height:620px; background:#fff; }
    @media (max-width: 780px) {
      .shell { grid-template-columns:1fr; }
      .sidebar { display:none; }
      .top { align-items:flex-start; flex-direction:column; }
      .canvas { padding:10px; }
      .page { min-height:480px; }
    }
    @media (prefers-color-scheme: dark) {
      body, .top, button, a.button, .result { background:#101216; color:#edf0f6; }
      .workspace { background:#171b22; }
      .sidebar { background:#12151b; }
      .thumb, .page { background:#151922; border-color:#2d3442; }
      :root { --line:#2d3442; --soft:#12151b; --ink:#edf0f6; }
      .status, .empty { color:#aab2c2; }
    }
  </style>
</head>
<body>
  <main class="app">
    <header class="top">
      <div class="brand"><span class="mark">+</span><span>Stirling PDF داخل ChatGPT</span></div>
      <div class="actions">
        <button id="lang" type="button">English</button>
        <a class="button" id="full" href="${STIRLING_PUBLIC_URL}" target="_blank" rel="noreferrer">فتح المحرر الكامل</a>
        <button class="primary" id="ask" type="button">اطلب من ChatGPT تنفيذ العملية</button>
      </div>
    </header>
    <section class="shell">
      <aside class="sidebar" aria-label="Pages">
        <div class="thumb">الملف الحالي</div>
        <div class="thumb">تظهر المعاينة هنا بعد تنفيذ أداة PDF</div>
      </aside>
      <section class="workspace">
        <div class="toolbar" aria-label="PDF tools">
          <button data-prompt="ادمج ملفات PDF المرفوعة بالترتيب.">دمج</button>
          <button data-prompt="اقسم ملف PDF حسب الصفحات التي سأحددها.">تقسيم</button>
          <button data-prompt="اضغط ملف PDF لتقليل حجمه.">ضغط</button>
          <button data-prompt="شغّل OCR على ملف PDF واجعله قابلًا للبحث.">OCR</button>
          <button data-prompt="أضف علامة مائية نصية إلى ملف PDF.">علامة مائية</button>
          <button data-prompt="رتب صفحات ملف PDF حسب طلبي.">ترتيب الصفحات</button>
          <button data-prompt="احذف صفحات محددة من ملف PDF.">حذف صفحات</button>
        </div>
        <div class="canvas">
          <article class="page" id="page">
            <div class="empty" id="empty">
              <div>
                <h1>محرر PDF جاهز</h1>
                <p>ارفع ملف PDF في المحادثة أو اطلب العملية مباشرة. ChatGPT سيختار أداة Stirling المناسبة، ثم تظهر النتيجة ورابط التحميل هنا.</p>
              </div>
            </div>
          </article>
        </div>
        <div class="result">
          <strong id="operation">جاهز</strong>
          <div class="status" id="status">لم يتم تنفيذ عملية بعد.</div>
          <div id="download"></div>
        </div>
      </section>
    </section>
  </main>
  <script>
    const state = {
      ar: true,
      last: window.openai?.toolOutput || null,
      meta: window.openai?.toolResponseMetadata || null
    };
    const t = {
      ar: {
        ready: "جاهز",
        idle: "لم يتم تنفيذ عملية بعد.",
        ask: "اطلب من ChatGPT تنفيذ العملية",
        full: "فتح المحرر الكامل",
        en: "English",
        title: "محرر PDF جاهز",
        body: "ارفع ملف PDF في المحادثة أو اطلب العملية مباشرة. ChatGPT سيختار أداة Stirling المناسبة، ثم تظهر النتيجة ورابط التحميل هنا.",
        done: "اكتملت العملية",
        download: "تحميل الملف الناتج"
      },
      en: {
        ready: "Ready",
        idle: "No PDF operation has run yet.",
        ask: "Ask ChatGPT to run the action",
        full: "Open full editor",
        en: "العربية",
        title: "PDF editor ready",
        body: "Upload a PDF in the conversation or ask for an action. ChatGPT will choose the right Stirling tool, then the result and download link appear here.",
        done: "Operation completed",
        download: "Download result"
      }
    };

    function copy() { return state.ar ? t.ar : t.en; }

    function render() {
      const c = copy();
      document.getElementById("lang").textContent = c.en;
      document.getElementById("ask").textContent = c.ask;
      document.getElementById("full").textContent = c.full;
      const output = state.last || window.openai?.toolOutput || null;
      const page = document.getElementById("page");
      const empty = document.getElementById("empty");
      const op = document.getElementById("operation");
      const status = document.getElementById("status");
      const dl = document.getElementById("download");
      if (!output || output.status !== "completed") {
        op.textContent = c.ready;
        status.textContent = output?.error || c.idle;
        if (empty) {
          empty.querySelector("h1").textContent = c.title;
          empty.querySelector("p").textContent = c.body;
        }
        dl.innerHTML = "";
        return;
      }
      op.textContent = output.operation || c.done;
      status.textContent = output.filename ? c.done + ": " + output.filename : c.done;
      dl.innerHTML = '<a class="button primary" href="' + output.download_url + '" target="_blank" rel="noreferrer">' + c.download + '</a>';
      if (output.mime_type && output.mime_type.includes("pdf")) {
        page.innerHTML = '<embed src="' + output.download_url + '" type="application/pdf" />';
      }
    }

    function sendPrompt(text) {
      if (window.openai?.sendFollowUpMessage) {
        window.openai.sendFollowUpMessage({ prompt: text });
      } else {
        document.getElementById("status").textContent = text;
      }
    }

    window.addEventListener("message", (event) => {
      const result = event.data?.params?.result || event.data?.result;
      if (result?.structuredContent) {
        state.last = result.structuredContent;
        render();
      }
    });

    document.getElementById("lang").addEventListener("click", () => {
      state.ar = !state.ar;
      document.documentElement.dir = state.ar ? "rtl" : "ltr";
      document.documentElement.lang = state.ar ? "ar" : "en";
      render();
    });
    document.getElementById("ask").addEventListener("click", () => sendPrompt("افتح أداة PDF واسألني عن العملية والملفات المطلوبة."));
    document.querySelectorAll("[data-prompt]").forEach((button) => {
      button.addEventListener("click", () => sendPrompt(button.getAttribute("data-prompt")));
    });
    render();
  </script>
</body>
</html>`;
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.json({
    name: APP_NAME,
    status: "ok",
    mcp: `${PUBLIC_BASE_URL}/mcp`,
    preview: `${PUBLIC_BASE_URL}/preview`,
    stirling: STIRLING_PUBLIC_URL
  });
});

app.get("/preview", (_req, res) => {
  res.type("html").send(widgetHtml());
});

app.get("/downloads/:id", (req, res) => {
  const file = downloads.get(req.params.id);
  if (!file) {
    res.status(404).json({ error: "File expired or not found" });
    return;
  }
  res.setHeader("content-type", file.contentType);
  res.setHeader("content-disposition", `attachment; filename="${file.filename.replace(/"/g, "")}"`);
  res.send(file.bytes);
});

app.options("/mcp", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, x-api-key, mcp-session-id");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.sendStatus(204);
});

app.post("/mcp", requireApiKey, rateLimit, async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close().catch(() => undefined);
    server.close().catch(() => undefined);
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", requireApiKey, rateLimit, async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close().catch(() => undefined);
    server.close().catch(() => undefined);
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

app.delete("/mcp", requireApiKey, (_req, res) => {
  res.sendStatus(204);
});

app.get("/.well-known/oauth-protected-resource", (_req, res) => res.sendStatus(404));
app.get("/.well-known/oauth-authorization-server", (_req, res) => res.sendStatus(404));

app.listen(PORT, () => {
  console.log(`${APP_NAME} listening on ${PUBLIC_BASE_URL}`);
  console.log(`Proxying Stirling-PDF at ${STIRLING_BASE_URL}`);
});
