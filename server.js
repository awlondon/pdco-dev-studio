import express from 'express';
import cors from 'cors';

const app = express();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const CHAT_SYSTEM_PROMPT = `You are an assistant embedded in a live coding UI.

Return valid JSON only, with this schema:

{
  "assistant": { "text": string },
  "ui": {
    "html": string (optional),
    "css": string (optional),
    "js": string (optional)
  }
}

If the user asks a question, respond with assistant.text.
If the user asks to modify or generate UI, include ui.html/css/js.`;

/**
 * 🔴 CORS MUST BE FIRST
 */
app.use(cors({
  origin: [
    'https://maya-dev-ui.pages.dev',
    'https://dev.primarydesignco.com'
  ],
  credentials: true
}));

app.options('*', cors());

app.use(express.json());

/**
 * 🔍 DIAGNOSTIC HEADERS (prove code is live)
 */
app.use((req, res, next) => {
  res.setHeader('X-MAYA-BACKEND', 'alive');
  next();
});

/**
 * HEALTH
 */
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

/**
 * SESSION CHECK
 */
app.get('/api/me', (req, res) => {
  res.json({ user: null });
});

/**
 * CHAT
 */
app.post('/api/chat', (req, res) => {
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
    return;
  }

  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const inputMessages = [
    { role: 'system', content: CHAT_SYSTEM_PROMPT },
    ...messages
  ];

  fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: inputMessages
    })
  })
    .then(async (response) => {
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message = data?.error?.message || 'OpenAI API request failed';
        throw new Error(message);
      }

      const outputText =
        data?.output_text
        ?? data?.output?.[0]?.content?.[0]?.text
        ?? '';
      let payload;
      try {
        payload = JSON.parse(outputText);
      } catch {
        payload = { assistant: { text: outputText || '' } };
      }
      res.json(payload);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        assistant: { text: message || 'Sorry, something went wrong.' }
      });
    });
});

/**
 * GOOGLE AUTH STUB
 */
app.post('/api/auth/google', (req, res) => {
  res.json({ ok: true });
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log('Maya API listening on', port);
});
