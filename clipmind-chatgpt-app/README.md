# AI Summarizer ChatGPT App

AI Summarizer is a starter ChatGPT App that turns source content into a structured brief with:

- summary
- key points
- action items
- reusable social post
- source stats

It is built as an Apps SDK/MCP app with a Node server and a vanilla HTML widget.

## Run Locally

```bash
npm install
npm run check
npm start
```

The MCP endpoint runs at:

```txt
http://localhost:8787/mcp
```

An SSE-compatible endpoint is also available for clients that still ask for `/sse`:

```txt
http://localhost:8787/sse
```

The health check runs at:

```txt
http://localhost:8787/
```

The local widget preview runs at:

```txt
http://localhost:8787/preview
```

## Connect In ChatGPT

1. Start the local server with `npm start`.
2. Expose it with an HTTPS tunnel, for example `ngrok http 8787`.
3. In ChatGPT, enable Developer Mode in Apps & Connectors advanced settings.
4. Create a new app/connector that points to the tunneled URL plus `/mcp`. If the UI specifically asks for an SSE URL, use `/sse`.
5. Ask ChatGPT to use AI Summarizer to analyze pasted content.

## Main Tool

`analyze_content`

Use this when the user wants to turn pasted text, transcript notes, YouTube transcript notes, article notes, podcast notes, meeting notes, or lecture notes into a concise AI Summarizer brief.

Inputs:

- `content`: source text or notes
- `title`: optional title
- `sourceType`: `text`, `youtube`, `article`, `podcast`, `meeting`, or `lecture`
- `outputStyle`: `executive`, `student`, `creator`, or `research`

## Notes

This MVP does not call the OpenAI API directly. ChatGPT supplies the reasoning layer, while this MCP server structures the content and renders the widget.
