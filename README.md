# Maya Dev UI

This repository provides a lightweight, browser-based LLM playground with three core surfaces: a chat panel, a code editor, and a console output area. The UI talks to a single backend proxy endpoint so API keys stay server-side.

## Project structure

```
maya-dev-ui/
├── index.html         # UI layout for chat + editor + output
├── styles.css         # Styling for the three-panel workspace
├── app.js             # Client-side logic for streaming chat + code execution
├── api/credits.js     # Credit calculation helper for usage tracking
├── server.js          # Express proxy for streaming LLM responses
├── package.json       # Server dependencies and start script
└── README.md          # This file
```

## Running locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the server:

   ```bash
   npm start
   ```

3. Visit http://localhost:3000 in your browser.

## Deployment notes (important)

This UI **must** talk to a backend endpoint that proxies requests to OpenAI. A static host such as GitHub Pages can serve the HTML/CSS/JS, but it cannot call the OpenAI API directly. If you deploy the UI without a backend, you will see `405 Not Allowed` or CORS errors by design.

Recommended deployment option for the backend:

- **Cloudflare Workers** (the UI is configured to call `https://maya-llm-proxy.workers.dev/chat`)

If you host the UI on a static site, keep the API key on the server (for example, as a Worker secret).

## Features

- **Chat**: Responses appear in the chat panel.
- **Code editor**: Write or modify JavaScript snippets.
- **Console output**: Run code with `eval()` and inspect results or errors.

## Next steps

Consider swapping in a richer editor (CodeMirror/Monaco), capturing `console.error`/`console.warn`, or adding a server-side sandbox for safer code execution.
