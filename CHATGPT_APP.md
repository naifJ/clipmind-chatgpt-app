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

## Render Deployment

If the existing Render service is not managed by `render.yaml`, set these values in the Render dashboard:

- Root Directory: `chatgpt-app`
- Build Command: `npm ci && npm run build`
- Start Command: `npm start`
- Node Version: `22`
- Environment Variables:
  - `PUBLIC_BASE_URL=https://clipmind-chatgpt-app.onrender.com`
  - `STIRLING_BASE_URL=<your running Stirling-PDF backend URL>`
  - `STIRLING_PUBLIC_URL=<your public Stirling-PDF UI URL>`
  - `MAX_FILE_MB=50`

The root `package.json` also forwards old root-level Node commands to `chatgpt-app/`, which helps existing Render services that still build from the repository root.
