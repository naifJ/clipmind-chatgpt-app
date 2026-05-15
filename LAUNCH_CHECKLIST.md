# AI Summarizer Launch Checklist

## App Archetype

`vanilla-widget`

The app uses one MCP server and one vanilla HTML widget. This is the fastest stable shape for the current MVP.

## Tool Plan

### `analyze_content`

Use this when the user wants to turn pasted text, transcript notes, YouTube transcript notes, article notes, podcast notes, meeting notes, or lecture notes into a concise bilingual AI Summarizer brief in Arabic and English.

Inputs:

- `content`
- `title`
- `sourceType`: `text`, `youtube`, `article`, `podcast`, `meeting`, `lecture`
- `outputStyle`: `executive`, `student`, `creator`, `research`
- `language`: `bilingual`, `english`, `arabic`

Outputs:

- English summary
- Arabic summary
- English key points
- Arabic key points
- English action items
- Arabic action items
- English reusable post
- Arabic reusable post
- source stats

## Render Settings

Use the included `render.yaml`, or create a Web Service manually:

```txt
Root Directory: clipmind-chatgpt-app
Runtime: Node
Build Command: npm install && npm run build
Start Command: npm start
Health Check Path: /
```

Environment variables:

```txt
NODE_ENV=production
```

No OpenAI API key is required for the current MVP because ChatGPT supplies the reasoning layer.

## ChatGPT Developer Mode Settings

Name:

```txt
AI Summarizer
```

Description:

```txt
Summarize text, YouTube transcripts, meeting notes, lectures, and articles in Arabic and English. Get key points, action items, and reusable posts.
```

MCP URL after Render deploy:

```txt
https://YOUR-RENDER-SERVICE.onrender.com/mcp
```

Authentication:

```txt
No authentication
```

## Test Prompts

```txt
Use AI Summarizer to analyze this content in Arabic and English:

Telegram Mini Apps and ChatGPT Apps let builders distribute software inside apps people already use. The best early products are focused tools, not generic assistants.
```

```txt
Use AI Summarizer to summarize these meeting notes in executive style in Arabic and English:

We reviewed product launch priorities, agreed to focus on onboarding, and assigned follow-up tasks for analytics, landing page copy, and user interviews.
```

```txt
Use AI Summarizer to turn this lecture into study notes:

Artificial intelligence systems can classify, summarize, translate, and generate content. Students should compare model outputs, verify facts, and save concise notes for review.
```

## Submission Gaps Before Public Directory Review

- Stable production domain
- Privacy policy URL
- Terms of use URL
- App icon
- Screenshots
- Support contact
- Submission metadata
- End-to-end ChatGPT Developer Mode test with hosted Render URL

## Docs Used

- https://developers.openai.com/apps-sdk/quickstart
- https://developers.openai.com/apps-sdk/build/mcp-server
- https://developers.openai.com/apps-sdk/build/chatgpt-ui
- https://developers.openai.com/apps-sdk/deploy/submission
- https://developers.openai.com/apps-sdk/app-submission-guidelines

