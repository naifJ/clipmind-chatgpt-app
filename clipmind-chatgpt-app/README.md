# Smart PDF Assistant

Smart PDF Assistant is a minimal ChatGPT Apps SDK application for PDF workflows inside ChatGPT. It exposes MCP tools for PDF operations and a simple RTL iframe widget for upload/status/result/download.

## MVP Tools

- `merge_pdfs`: merge two or more PDFs into one PDF.
- `split_pdf`: split one PDF using page ranges such as `1-3,4-8`.
- `extract_invoice_data`: extract invoice fields as JSON with confidence scores.

## TODO

- `compress_pdf`: PDF compression with Ghostscript or another replaceable service.
- `ocr_pdf`: OCR for scanned PDFs/images with Tesseract.js or a configurable OCR service.
- `analyze_contract`: Arabic contract summary, key terms, risky clauses, dates, parties, and obligations.

## Local Setup

```bash
npm install
npm run dev
```

Production-style local run:

```bash
npm run build
npm start
```

The MCP endpoint runs at:

```text
http://localhost:8787/mcp
```

Preview the iframe widget:

```text
http://localhost:8787/preview
```

## ChatGPT Developer Mode

1. Run the server locally.
2. Expose it with HTTPS, for example:

```bash
ngrok http 8787
```

3. In ChatGPT, enable Developer Mode from Apps & Connectors advanced settings.
4. Create a new app and use:

```text
https://YOUR-TUNNEL.ngrok-free.app/mcp
```

5. Authentication: `No authentication`.

## Render Deployment

This project is ready for Render through the repository `Dockerfile`.

Recommended environment variables:

```text
PUBLIC_BASE_URL=https://your-service.onrender.com
MAX_FILE_SIZE_MB=20
MAX_FILES_PER_REQUEST=10
OUTPUT_TTL_MINUTES=30
RATE_LIMIT_PER_MINUTE=40
ALLOW_EXTERNAL_OCR=false
```

## File Input Shape

Tools accept ChatGPT file references in this shape:

```json
{
  "file_id": "optional-id",
  "download_url": "https://temporary-download-url",
  "file_name": "invoice.pdf",
  "mime_type": "application/pdf"
}
```

## Example Tool Calls

See [tests/mcp-examples.md](../tests/mcp-examples.md).

## Security

- Files are fetched from app-authorized temporary URLs.
- Only PDF MIME/type/magic bytes are accepted for PDF tools.
- Executable uploads are not accepted.
- Temporary output files expire automatically.
- Logs avoid file content and only log operational errors.
- The current MVP does not send files to external OCR or AI services.
