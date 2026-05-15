# AI Summarizer

AI Summarizer is a bilingual Arabic-English ChatGPT App that turns notes, transcripts, lectures, meetings, and articles into structured summaries, key points, action items, and reusable posts.

The app is built as:

- Node.js MCP server
- vanilla HTML ChatGPT widget
- Render-ready web service

## Project

```txt
clipmind-chatgpt-app/
```

## Local Run

```bash
cd clipmind-chatgpt-app
npm install
npm run build
npm start
```

Local endpoints:

```txt
http://localhost:8787/
http://localhost:8787/mcp
http://localhost:8787/sse
http://localhost:8787/preview
```

## Render Deploy

This repository includes `render.yaml`.

Recommended production endpoint for ChatGPT:

```txt
https://YOUR-RENDER-SERVICE.onrender.com/mcp
```

If the ChatGPT app setup screen specifically asks for an SSE endpoint:

```txt
https://YOUR-RENDER-SERVICE.onrender.com/sse
```

