import express from 'express';
import cors from 'cors';

const app = express();

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
 * CHAT (stub)
 */
app.post('/api/chat', (req, res) => {
  res.json({
    choices: [
      { message: { content: 'Backend is working.' } }
    ]
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
