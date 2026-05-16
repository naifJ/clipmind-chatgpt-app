# PDF Pro Editor Launch Checklist

## App Archetype

`vanilla-widget`

The app uses one TypeScript MCP server and one iframe widget. A React component source is included at `src/ui/PdfProEditor.tsx`.

## MVP Tools

- `upload_pdf`
- `analyze_pdf`
- `merge_pdfs`
- `split_pdf`
- `reorder_pages`
- `rotate_pages`
- `delete_pages`
- `compress_pdf`
- `add_watermark`
- `add_signature`
- `fill_pdf_form`
- `ocr_pdf`
- `extract_text`
- `extract_images`
- `convert_pdf_to_images`
- `compare_pdfs`
- `export_pdf`

## TODO Tools

- high-fidelity direct PDF text editing
- export to Word/PowerPoint with perfect formatting
- corrupted PDF repair
- advanced visual diff
- contract analysis

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
PDF Pro Editor
```

Description:

```txt
PDF Pro Editor lets users edit, convert, OCR, and export PDFs directly inside ChatGPT.
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
