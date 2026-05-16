import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
import { fileReferenceSchema, MAX_FILE_SIZE_BYTES, MAX_FILES_PER_REQUEST } from "./lib/validation.js";
import { extractInvoiceData } from "./tools/extractInvoiceData.js";
import { mergePdfs } from "./tools/mergePdfs.js";
import { splitPdf } from "./tools/splitPdf.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const WIDGET_URI = "ui://widget/smart-pdf-assistant-v1.html";
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

const port = Number(process.env.PORT ?? "8787");
const MCP_PATH = "/mcp";
const SSE_PATH = "/sse";
const MESSAGES_PATH = "/messages";
const sseSessions = new Map<string, { transport: SSEServerTransport; server: McpServer }>();

function createAppServer(publicBaseUrl: string): McpServer {
  const server = new McpServer({
    name: "Smart PDF Assistant",
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
            "Smart PDF Assistant provides a minimal Arabic-first file processing panel for PDF operations and download results.",
        },
      },
    ],
  }));

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

await ensureStorage();
startCleanupTimer();

createServer(async (req, res) => {
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
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("Smart PDF Assistant MCP server");
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
}).listen(port, () => {
  console.log("Smart PDF Assistant MCP server listening on http://localhost:" + port + MCP_PATH);
  console.log(`Max file size: ${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)}MB`);
});
