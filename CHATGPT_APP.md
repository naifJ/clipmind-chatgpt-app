# ChatGPT Apps SDK Bridge

This repository is still Stirling-PDF. The ChatGPT app layer lives in:

```text
chatgpt-app/
```

The bridge exposes Stirling-PDF as ChatGPT Apps SDK / MCP tools while keeping the original Stirling-PDF idea intact.

## Run Everything Locally

```bash
docker compose -f docker/compose/docker-compose-chatgpt-app.yml up --build
```

Then use:

- Stirling-PDF: `http://localhost:8080`
- ChatGPT widget preview: `http://localhost:8787/preview`
- ChatGPT MCP endpoint: `http://localhost:8787/mcp`

If port `8787` is already used, run the bridge manually:

```bash
cd chatgpt-app
PORT=8788 PUBLIC_BASE_URL=http://localhost:8788 npm run dev
```

## ChatGPT Developer Mode

Use this URL when creating the app:

```text
https://YOUR-DOMAIN/mcp
```

The server supports no-auth testing by default. Set `API_KEY` if you want bearer-token protection.
