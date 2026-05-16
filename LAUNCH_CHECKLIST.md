# Smart PDF Assistant Launch Checklist

## App Archetype

`vanilla-widget`

The app uses one TypeScript MCP server and one minimal vanilla HTML widget.

## MVP Tools

- `merge_pdfs`: merge two or more PDF files.
- `split_pdf`: split a PDF by page ranges.
- `extract_invoice_data`: extract invoice fields into JSON with confidence scores.

## TODO Tools

- `compress_pdf`
- `ocr_pdf`
- `analyze_contract`

## Render Settings

The repository includes a root `Dockerfile`. Manual Render settings:

```txt
Runtime: Docker
Plan: Free or paid
Health Check Path: /
```

Recommended environment variables:

```txt
PUBLIC_BASE_URL=https://clipmind-chatgpt-app.onrender.com
MAX_FILE_SIZE_MB=20
MAX_FILES_PER_REQUEST=10
OUTPUT_TTL_MINUTES=30
RATE_LIMIT_PER_MINUTE=40
ALLOW_EXTERNAL_OCR=false
```

## ChatGPT App Settings

Name:

```txt
Smart PDF Assistant
```

Description:

```txt
Smart PDF Assistant merges, splits, and extracts invoice data from PDF files inside ChatGPT with a minimal Arabic-first interface.
```

MCP URL:

```txt
https://clipmind-chatgpt-app.onrender.com/mcp
```

Authentication:

```txt
No authentication
```

Privacy:

```txt
https://clipmind-chatgpt-app.onrender.com/privacy
```

Terms:

```txt
https://clipmind-chatgpt-app.onrender.com/terms
```
