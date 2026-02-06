# Maya Dev UI

This repository provides a lightweight, browser-based LLM playground with three core surfaces: a streaming chat panel, a code editor, and a console output area. A small Express server proxies requests to your LLM provider so API keys stay server-side.

## Project structure

```
maya-dev-ui/
├── index.html         # UI layout for chat + editor + output
├── styles.css         # Styling for the three-panel workspace
├── app.js             # Client-side logic for streaming chat + code execution
├── server.js          # Express proxy for streaming LLM responses
├── package.json       # Server dependencies and start script
└── README.md          # This file
```

## Running locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Provide your API key (OpenAI by default):

   ```bash
   export OPENAI_API_KEY=your_key_here
   ```

3. Start the server:

   ```bash
   npm start
   ```

4. Visit http://localhost:3000 in your browser.

## Configuration

The server uses the OpenAI Chat Completions endpoint with streaming enabled by default. You can override settings with environment variables:

- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (default: `gpt-4o-mini`)
- `OPENAI_API_URL` (default: `https://api.openai.com/v1/chat/completions`)
- `PORT` (default: `3000`)

## Features

- **Streaming chat**: Responses appear token-by-token in the chat panel.
- **Code editor**: Write or modify JavaScript snippets.
- **Console output**: Run code with `eval()` and inspect results or errors.

## Next steps

Consider swapping in a richer editor (CodeMirror/Monaco), capturing `console.error`/`console.warn`, or adding a server-side sandbox for safer code execution.
