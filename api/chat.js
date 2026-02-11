import { buildPlayablePrompt } from '../server/utils/playableWrapper.js';
import { buildRetryPrompt } from '../server/utils/retryWrapper.js';

function applyPlayableWrapper(messages, { userPrompt = '', code = '' } = {}) {
  const wrappedPrompt = buildPlayablePrompt({ prompt: userPrompt, code });
  if (!Array.isArray(messages) || messages.length === 0) {
    return [{ role: 'user', content: wrappedPrompt }];
  }

  const next = [...messages];
  const lastIndex = next.length - 1;
  if (next[lastIndex]?.role === 'user') {
    next[lastIndex] = {
      ...next[lastIndex],
      content: wrappedPrompt
    };
  } else {
    next.push({ role: 'user', content: wrappedPrompt });
  }
  return next;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const {
    messages,
    playableMode = false,
    retryMode = false,
    userPrompt = '',
    originalPrompt = '',
    previousResponse = '',
    currentCode = ''
  } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'Missing messages.' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Missing OPENAI_API_KEY on the server.' });
    return;
  }

  try {
    let finalPrompt = userPrompt;
    if (retryMode) {
      finalPrompt = buildRetryPrompt({ originalPrompt, previousResponse });
      if (playableMode) {
        finalPrompt += '\n\nAlso improve gameplay depth and mechanics.';
      }
    }

    const outboundMessages = playableMode
      ? applyPlayableWrapper(messages, { userPrompt: finalPrompt, code: currentCode })
      : (() => {
        if (!retryMode) {
          return messages;
        }
        const next = [...messages];
        if (next[next.length - 1]?.role === 'user') {
          next[next.length - 1] = { ...next[next.length - 1], content: finalPrompt };
        } else {
          next.push({ role: 'user', content: finalPrompt });
        }
        return next;
      })();

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: outboundMessages,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      res.status(response.status).send(errorText || 'Upstream error.');
      return;
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected server error.'
    });
  }
}
