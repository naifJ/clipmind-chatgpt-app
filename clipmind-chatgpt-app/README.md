# PDF Pro Editor

PDF Pro Editor is a production-style ChatGPT Apps SDK application for PDF workflows inside ChatGPT.

Main value proposition:

```text
Edit, convert, OCR, and repair PDFs directly inside ChatGPT.
```

The app uses:

- TypeScript + Node.js
- Express-compatible MCP HTTP/SSE server
- OpenAI Apps SDK / MCP tool architecture
- A minimal iframe widget for upload, status, result, and download
- React component source in `src/ui/PdfProEditor.tsx`
- Local temporary file storage with upgrade path to S3/R2
- Docker and docker-compose support

## Implemented Tools

- `upload_pdf`
- `analyze_pdf`
- `merge_pdfs`
- `split_pdf`
- `reorder_pages`
- `rotate_pages`
- `delete_pages`
- `compress_pdf` basic safe rewrite, Ghostscript-quality compression is TODO
- `add_watermark` text watermark
- `add_signature` PNG/JPG signature image placement
- `fill_pdf_form` text fields and checkboxes
- `ocr_pdf` Tesseract text output for limited pages
- `extract_text`
- `extract_images`
- `convert_pdf_to_images`
- `compare_pdfs` text diff MVP
- `export_pdf`
- `extract_invoice_data` retained from prior PDF workflow

## Commercial Placeholders

These are registered as explicit not-enabled tools so ChatGPT can explain availability without pretending they work:

- `edit_pdf_text`
- `export_to_word`
- `export_to_powerpoint`
- `repair_pdf`
- `advanced_visual_diff`

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

Run tests:

```bash
npm test
```

MCP endpoint:

```text
http://localhost:8787/mcp
```

Widget preview:

```text
http://localhost:8787/preview
```

## ChatGPT Developer Mode

1. Run the server locally.
2. Expose it with HTTPS:

```bash
ngrok http 8787
```

3. In ChatGPT, enable Developer Mode under Apps & Connectors advanced settings.
4. Create a new app with:

```text
https://YOUR-TUNNEL.ngrok-free.app/mcp
```

5. Authentication: `No authentication`.

## Docker

```bash
docker compose up --build
```

## Render Deployment

The repo includes a root `Dockerfile`.

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

Tools accept ChatGPT file references:

```json
{
  "file_id": "optional-id",
  "download_url": "https://temporary-download-url",
  "file_name": "document.pdf",
  "mime_type": "application/pdf"
}
```

## Security

- Validates MIME and PDF magic bytes.
- Rejects malformed/non-PDF inputs for PDF tools.
- Sanitizes output filenames.
- Prevents path traversal through generated file IDs.
- Limits file size and request counts.
- Deletes temporary output files after TTL.
- Adds rate limiting on app routes.
- Includes plan/credit hooks in `src/lib/usageLimits.ts` for future pricing.
- Logs operational errors without file content.
- External OCR/AI providers are not used unless explicitly configured later.

## TODO

- Direct PDF text editing with layout preservation.
- PDF to Word/PowerPoint with high-fidelity formatting.
- Ghostscript-backed compression.
- Searchable PDF output after OCR.
- Corrupted PDF repair.
- Advanced visual diff.
- Image-to-PDF tool.
- Usage credits, plan limits, paid plan hooks, team billing.
