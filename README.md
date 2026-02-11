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

- **Node/Express API (`server.js`)** as the canonical backend. This single API surface owns auth, `/api/me`, chat proxying, artifacts, analytics, and billing webhooks.
- **Cloudflare Worker (`src/index.ts`)** is optional and now acts only as an edge passthrough. If used, set `CANONICAL_API_ORIGIN` to your Express API base URL.

If you host the UI on a static site, keep the API key on the server.

## Features

- **Chat**: Responses appear in the chat panel.
- **Code editor**: Write or modify JavaScript snippets.
- **Console output**: Run code with `eval()` and inspect results or errors.

## Monaco loading note

Monaco is loaded via AMD only through `editorManager.js`, which manages a singleton loader bootstrap and mount/unmount lifecycle for editors. Do not import `editor.main.js`/`editor.main.css` directly or inject additional Monaco script tags at runtime.

If you add a Vite build, keep Monaco externalized in `vite.config.js` (`external: ["monaco-editor"]`) so the CDN AMD runtime remains the single source of Monaco modules.

## Documentation

- [Glyph schema v1](docs/glyph-schema.md)
- [User storage schema](data/USERS_SCHEMA.md)
- [Artifact + profile storage schema](data/ARTIFACTS_SCHEMA.md)

## User storage migration

User accounts, billing, and credits are stored in Postgres. To bootstrap a new database:

1. Apply `data/migrations/001_create_user_storage.sql`.
2. Apply `data/migrations/002_create_artifacts_profiles.sql`.
3. (Optional) Import legacy CSV users:

   ```bash
   node scripts/import-users.js
   ```

## Object storage configuration

Artifact screenshots and profile avatars can be stored in local disk (default) or S3-compatible storage.

Set the following environment variables to enable object storage:

- `OBJECT_STORAGE_DRIVER`: `local` (default) or `s3`.
- `OBJECT_STORAGE_BUCKET`: Bucket name.
- `OBJECT_STORAGE_REGION`: Region (default: `us-east-1`).
- `OBJECT_STORAGE_ENDPOINT`: Optional custom endpoint for R2/GCS/S3-compatible storage.
- `OBJECT_STORAGE_ACCESS_KEY_ID`: Access key.
- `OBJECT_STORAGE_SECRET_ACCESS_KEY`: Secret key.
- `OBJECT_STORAGE_FORCE_PATH_STYLE`: `true` for path-style URLs when required.
- `OBJECT_STORAGE_PUBLIC_URL`: Optional public base URL used in returned media URLs.

## Stripe plan tier configuration

For multi-tier subscriptions, set Stripe price IDs so users can choose Starter, Pro, or Enterprise:

- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_PRO`
- `STRIPE_PRICE_ENTERPRISE`

You can also override plan metadata with `STRIPE_PLAN_CATALOG` or `STRIPE_PLAN_MAP` if needed.

## Next steps

Consider swapping in a richer editor (CodeMirror/Monaco), capturing `console.error`/`console.warn`, or adding a server-side sandbox for safer code execution.
