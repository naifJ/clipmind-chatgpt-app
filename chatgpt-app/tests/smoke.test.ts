import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("ChatGPT app scaffold", () => {
  it("documents the MCP endpoint and Stirling proxy architecture", () => {
    const readme = fs.readFileSync(path.join(process.cwd(), "README.md"), "utf8");
    expect(readme).toContain("/mcp");
    expect(readme).toContain("Stirling-PDF API");
  });

  it("registers core PDF tools in the server source", () => {
    const server = fs.readFileSync(path.join(process.cwd(), "src/server.ts"), "utf8");
    for (const tool of ["merge_pdfs", "split_pdf", "compress_pdf", "ocr_pdf", "add_watermark"]) {
      expect(server).toContain(tool);
    }
  });
});
