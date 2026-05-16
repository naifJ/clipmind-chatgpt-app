# PDF Pro Editor MCP Examples

These examples assume the server is running at `http://localhost:8787`.

The `download_url` values must point to app-authorized PDF files. In ChatGPT, file references are supplied by the app/file system. For local manual tests, use reachable URLs for sample PDFs.

## List Tools

```bash
curl -sS -X POST http://localhost:8787/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## merge_pdfs

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "merge_pdfs",
    "arguments": {
      "sort_by_name": true,
      "output_name": "merged.pdf",
      "files": [
        {
          "download_url": "https://example.com/a.pdf",
          "file_name": "a.pdf",
          "mime_type": "application/pdf"
        },
        {
          "download_url": "https://example.com/b.pdf",
          "file_name": "b.pdf",
          "mime_type": "application/pdf"
        }
      ]
    }
  }
}
```

## split_pdf

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "split_pdf",
    "arguments": {
      "ranges": "1-3,4-8",
      "output_prefix": "section",
      "file": {
        "download_url": "https://example.com/source.pdf",
        "file_name": "source.pdf",
        "mime_type": "application/pdf"
      }
    }
  }
}
```

## extract_invoice_data

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "extract_invoice_data",
    "arguments": {
      "file": {
        "download_url": "https://example.com/invoice.pdf",
        "file_name": "invoice.pdf",
        "mime_type": "application/pdf"
      }
    }
  }
}
```
