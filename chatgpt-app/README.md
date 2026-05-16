# Stirling PDF ChatGPT App

This folder turns the existing Stirling-PDF project into a ChatGPT Apps SDK app without replacing Stirling-PDF itself.

Stirling remains the PDF engine. This Node/TypeScript app is a small MCP bridge that:

- exposes ChatGPT tools for common PDF operations;
- accepts ChatGPT file references through `openai/fileParams`;
- calls the existing Stirling-PDF HTTP API;
- returns structured tool output and downloadable result links;
- serves a lightweight widget that can render inside ChatGPT.

## Architecture

```text
ChatGPT
  -> MCP tool call / file reference
  -> chatgpt-app on /mcp
  -> Stirling-PDF API
  -> result file returned through /downloads/:id
```

## Implemented Tools

- `open_pdf_editor`
- `merge_pdfs`
- `split_pdf`
- `reorder_pages`
- `delete_pages`
- `rotate_pdf`
- `compress_pdf`
- `ocr_pdf`
- `add_watermark`
- `extract_images`

## Local Setup

Start Stirling-PDF first:

```bash
docker compose -f docker/compose/docker-compose-chatgpt-app.yml up stirling-pdf
```

Then run the ChatGPT app bridge:

```bash
cd chatgpt-app
npm install
npm run dev
```

Open:

- Health: `http://localhost:8787/`
- Widget preview: `http://localhost:8787/preview`
- MCP endpoint for ChatGPT Developer Mode: `http://localhost:8787/mcp`

## Docker Compose

From the repository root:

```bash
docker compose -f docker/compose/docker-compose-chatgpt-app.yml up --build
```

This starts:

- Stirling-PDF at `http://localhost:8080`
- ChatGPT app bridge at `http://localhost:8787`

## Environment

Copy `.env.example` when running outside Docker:

```bash
cp chatgpt-app/.env.example chatgpt-app/.env
```

Important variables:

- `PUBLIC_BASE_URL`: public HTTPS URL for this MCP bridge.
- `STIRLING_BASE_URL`: internal URL used by the bridge to call Stirling.
- `STIRLING_PUBLIC_URL`: URL users can open for the full Stirling interface.
- `MAX_FILE_MB`: max input file size.
- `API_KEY`: optional bearer token for `/mcp`.

For ChatGPT app testing on the public internet, `PUBLIC_BASE_URL` must be HTTPS.

## ChatGPT Developer Mode

1. Deploy or tunnel this bridge over HTTPS.
2. In ChatGPT Apps settings, create a custom MCP app.
3. Use the MCP URL:

```text
https://YOUR-DOMAIN/mcp
```

4. Use **No auth** while testing, or set `API_KEY` and pass it as a bearer token if your ChatGPT setup supports it.
5. Ask ChatGPT:

```text
افتح محرر PDF
ادمج هذه الملفات بالترتيب
اضغط هذا الملف إلى أقل حجم ممكن
أضف علامة مائية باسم Confidential
```

## Notes

- Files are held in memory for one hour for download, then deleted.
- The bridge does not permanently store uploaded PDFs.
- Large binary outputs are not sent inline to ChatGPT.
- Advanced editing still depends on Stirling-PDF capabilities and installed system tools such as OCR dependencies.

## Official Apps SDK Docs Used

- https://developers.openai.com/apps-sdk/build/mcp-server
- https://developers.openai.com/apps-sdk/quickstart
- https://developers.openai.com/apps-sdk/build/mcp-server#file-handling
