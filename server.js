import express from 'express';

const app = express();
const port = process.env.PORT || 3000;
const apiUrl = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

app.use(express.json({ limit: '1mb' }));
app.use(express.static('.'));

app.post('/api/chat', async (req, res) => {
  const { messages, prompt } = req.body || {};
  const payloadMessages = Array.isArray(messages) && messages.length
    ? messages
    : prompt
      ? [{ role: 'user', content: prompt }]
      : [];

  if (!payloadMessages.length) {
    res.status(400).json({ error: 'Missing messages or prompt.' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Missing OPENAI_API_KEY on the server.' });
    return;
  }

  try {
    console.log('LLM REQUEST:', {
      model,
      messages: payloadMessages
    });
    const upstream = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: payloadMessages
      })
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(upstream.status).send(text || 'Upstream error.');
      return;
    }

    const data = await upstream.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected server error.'
    });
  }
});

app.listen(port, () => {
  console.log(`Maya Dev UI listening on http://localhost:${port}`);
});
