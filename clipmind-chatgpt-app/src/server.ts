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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const WIDGET_URI = "ui://widget/main-v4.html";
const WIDGET_HTML = readFileSync(
  path.join(ROOT_DIR, "public", "widget.html"),
  "utf8"
);
const PRIVACY_HTML = readFileSync(
  path.join(ROOT_DIR, "public", "privacy.html"),
  "utf8"
);
const TERMS_HTML = readFileSync(
  path.join(ROOT_DIR, "public", "terms.html"),
  "utf8"
);

const sourceTypeSchema = z.enum([
  "text",
  "youtube",
  "article",
  "podcast",
  "meeting",
  "lecture",
]);

const outputStyleSchema = z.enum([
  "executive",
  "student",
  "creator",
  "research",
]);

const languageSchema = z.enum(["bilingual", "english", "arabic"]);

const analysisOutputSchema = {
  title: z.string(),
  sourceType: sourceTypeSchema,
  outputStyle: outputStyleSchema,
  language: languageSchema,
  summary: z.string(),
  summaryAr: z.string(),
  keyPoints: z.array(z.string()),
  keyPointsAr: z.array(z.string()),
  actionItems: z.array(z.string()),
  actionItemsAr: z.array(z.string()),
  reusablePost: z.string(),
  reusablePostAr: z.string(),
  stats: z.object({
    characters: z.number().int(),
    words: z.number().int(),
    estimatedReadingMinutes: z.number().int(),
  }),
};

type SourceType = z.infer<typeof sourceTypeSchema>;
type OutputStyle = z.infer<typeof outputStyleSchema>;
type Language = z.infer<typeof languageSchema>;

function splitSentences(content: string): string[] {
  return content
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?؟])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function wordCount(content: string): number {
  return content.trim().split(/\s+/).filter(Boolean).length;
}

function makeTitle(content: string, fallback?: string): string {
  if (fallback?.trim()) {
    return fallback.trim().slice(0, 90);
  }

  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return (firstLine || "ClipMind analysis").slice(0, 90);
}

function createSummary(content: string, style: OutputStyle): string {
  const sentences = splitSentences(content);
  const opening = sentences.slice(0, 2).join(" ");
  const styleLabel = {
    executive: "Business brief",
    student: "Study notes",
    creator: "Creator brief",
    research: "Research brief",
  }[style];

  if (!opening) {
    return `${styleLabel}: Add source text, a transcript, or notes and ClipMind will turn it into a concise working brief.`;
  }

  return `${styleLabel}: ${opening}`;
}

function createArabicSummary(content: string, style: OutputStyle): string {
  const sentences = splitSentences(content);
  const opening = sentences.slice(0, 2).join(" ");
  const styleLabel = {
    executive: "ملخص تنفيذي",
    student: "ملاحظات مذاكرة",
    creator: "ملخص لصانع محتوى",
    research: "ملخص بحثي",
  }[style];

  if (!opening) {
    return `${styleLabel}: أضف نصًا أو تفريغًا أو ملاحظات وسيحوّلها ClipMind إلى ملخص عملي ومنظم.`;
  }

  return `${styleLabel}: ${opening}`;
}

function createKeyPoints(content: string): string[] {
  const sentences = splitSentences(content);
  const candidates = sentences.length > 0 ? sentences : [content.trim()];

  return candidates
    .slice(0, 5)
    .map((sentence) => sentence.replace(/^[\-*]\s*/, "").trim())
    .filter(Boolean)
    .map((sentence) => (sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence));
}

function createArabicKeyPoints(keyPoints: string[]): string[] {
  return keyPoints.map((point) => `نقطة مهمة: ${point}`);
}

function createActionItems(sourceType: SourceType, style: OutputStyle): string[] {
  const base = [
    "Ask ChatGPT to expand the brief into a cleaner final summary.",
    "Save the key points that matter and remove anything off-topic.",
  ];

  if (sourceType === "youtube" || sourceType === "podcast") {
    base.push("Turn the strongest point into a short social post or study note.");
  }

  if (style === "creator") {
    base.push("Convert the brief into a hook, outline, and caption.");
  }

  if (style === "student") {
    base.push("Ask for quiz questions to test recall.");
  }

  return base.slice(0, 4);
}

function createArabicActionItems(sourceType: SourceType, style: OutputStyle): string[] {
  const base = [
    "اطلب من ChatGPT توسيع الملخص وتحويله إلى نسخة نهائية أوضح.",
    "احفظ النقاط المهمة واحذف أي تفاصيل غير مرتبطة بهدفك.",
  ];

  if (sourceType === "youtube" || sourceType === "podcast") {
    base.push("حوّل أقوى فكرة إلى منشور قصير أو ملاحظة مذاكرة.");
  }

  if (style === "creator") {
    base.push("حوّل الملخص إلى hook وخطوط عريضة وتعليق جاهز للنشر.");
  }

  if (style === "student") {
    base.push("اطلب أسئلة اختبار قصيرة للتأكد من الفهم.");
  }

  return base.slice(0, 4);
}

function createReusablePost(title: string, keyPoints: string[]): string {
  const lead = keyPoints[0] || "Here is the core idea worth remembering.";
  const support = keyPoints[1] || "The source has enough signal to turn into a practical brief.";

  return `${title}\n\n${lead}\n\n${support}\n\nSaved as a clean ClipMind summary.`;
}

function createArabicReusablePost(title: string, keyPoints: string[]): string {
  const lead = keyPoints[0] || "هذه هي الفكرة الأساسية التي تستحق الحفظ.";
  const support = keyPoints[1] || "المصدر يحتوي على نقاط كافية لتحويلها إلى ملخص عملي.";

  return `${title}\n\n${lead}\n\n${support}\n\nتم حفظه كملخص منظم من ClipMind.`;
}

function createAppServer(): McpServer {
  const server = new McpServer({
    name: "ClipMind",
    version: "0.1.0",
  });

  registerAppResource(
    server,
    "main-widget",
    WIDGET_URI,
    {},
    async () => ({
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
              "ClipMind shows bilingual English and Arabic summaries, key points, action items, and reusable posts from source content.",
          },
        },
      ],
    })
  );

  registerAppTool(
    server,
    "analyze_content",
    {
      title: "Analyze content",
      description:
        "Use this when the user wants to turn pasted text, transcript notes, a YouTube transcript, article notes, podcast notes, meeting notes, or lecture notes into a concise bilingual ClipMind brief in Arabic and English.",
      inputSchema: {
        content: z
          .string()
          .min(1)
          .describe("The source text, transcript, notes, or link context to analyze."),
        title: z
          .string()
          .optional()
          .describe("Optional source title. If absent, ClipMind derives one from the content."),
        sourceType: sourceTypeSchema
          .default("text")
          .describe("The kind of source being analyzed."),
        outputStyle: outputStyleSchema
          .default("executive")
          .describe("The format and tone of the brief."),
        language: languageSchema
          .default("bilingual")
          .describe("The display language for the brief. Use bilingual unless the user asks for one language only."),
      },
      outputSchema: analysisOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "Building ClipMind brief / جاري إنشاء الملخص",
        "openai/toolInvocation/invoked": "ClipMind brief ready / الملخص جاهز",
      },
    },
    async ({
      content,
      title,
      sourceType = "text",
      outputStyle = "executive",
      language = "bilingual",
    }: {
      content: string;
      title?: string;
      sourceType?: SourceType;
      outputStyle?: OutputStyle;
      language?: Language;
    }) => {
      const normalizedContent = content.trim();
      const resolvedTitle = makeTitle(normalizedContent, title);
      const keyPoints = createKeyPoints(normalizedContent);
      const keyPointsAr = createArabicKeyPoints(keyPoints);
      const summary = createSummary(normalizedContent, outputStyle);
      const summaryAr = createArabicSummary(normalizedContent, outputStyle);
      const actionItems = createActionItems(sourceType, outputStyle);
      const actionItemsAr = createArabicActionItems(sourceType, outputStyle);
      const words = wordCount(normalizedContent);

      const structuredContent = {
        title: resolvedTitle,
        sourceType,
        outputStyle,
        language,
        summary,
        summaryAr,
        keyPoints,
        keyPointsAr,
        actionItems,
        actionItemsAr,
        reusablePost: createReusablePost(resolvedTitle, keyPoints),
        reusablePostAr: createArabicReusablePost(resolvedTitle, keyPoints),
        stats: {
          characters: normalizedContent.length,
          words,
          estimatedReadingMinutes: Math.max(1, Math.ceil(words / 220)),
        },
      };

      return {
        content: [
          {
            type: "text" as const,
            text:
              "ClipMind created a bilingual structured brief. / أنشأ ClipMind ملخصًا منظمًا بالعربي والإنجليزي.",
          },
        ],
        structuredContent,
        _meta: {
          rawPreview: normalizedContent.slice(0, 1200),
        },
      };
    }
  );

  return server;
}

const port = Number(process.env.PORT ?? "8787");
const MCP_PATH = "/mcp";
const SSE_PATH = "/sse";
const MESSAGES_PATH = "/messages";
const sseSessions = new Map<
  string,
  { transport: SSEServerTransport; server: McpServer }
>();

createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, "http://" + (req.headers.host ?? "localhost"));
  const isMcpRoute = url.pathname === MCP_PATH || url.pathname.startsWith(MCP_PATH + "/");
  const isSseRoute = url.pathname === SSE_PATH || url.pathname === MESSAGES_PATH;

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
    res.writeHead(200, { "content-type": "text/plain" }).end("ClipMind MCP server");
    return;
  }

  if (req.method === "GET" && url.pathname === "/preview") {
    res.writeHead(200, { "content-type": RESOURCE_MIME_TYPE }).end(WIDGET_HTML);
    return;
  }

  if (
    req.method === "GET" &&
    (url.pathname === "/privacy" || url.pathname === "/privacy-policy")
  ) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PRIVACY_HTML);
    return;
  }

  if (
    req.method === "GET" &&
    (url.pathname === "/terms" || url.pathname === "/terms-of-use")
  ) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(TERMS_HTML);
    return;
  }

  const transportMethods = new Set(["GET", "POST", "DELETE"]);
  if (req.method === "GET" && url.pathname === SSE_PATH) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const transport = new SSEServerTransport(MESSAGES_PATH, res);
    const server = createAppServer();
    sseSessions.set(transport.sessionId, { transport, server });

    res.on("close", () => {
      sseSessions.delete(transport.sessionId);
      server.close();
    });

    try {
      await server.connect(transport);
    } catch (error) {
      console.error("Failed to open SSE transport:", error);
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
      console.error("Failed to handle SSE message:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  if (isMcpRoute && req.method && transportMethods.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createAppServer();
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
      console.error("Failed to handle MCP request:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  res.writeHead(404).end("Not Found");
}).listen(port, () => {
  console.log("ClipMind MCP server listening on http://localhost:" + port + MCP_PATH);
  console.log("ClipMind SSE endpoint available on http://localhost:" + port + SSE_PATH);
});
