const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

function tokenizeText(text) {
  if (!text) {
    return [];
  }
  const value = String(text);
  return value
    .match(/[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_]/g)
    ?.filter(Boolean)
    || [];
}

export function estimateTokensWithTokenizer(text, model = DEFAULT_MODEL) {
  const _model = model;
  void _model;
  return tokenizeText(text).length;
}

export function estimateMessageTokens(messages = [], model = DEFAULT_MODEL) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 0;
  }
  return messages.reduce((sum, message) => {
    const role = message?.role ? String(message.role) : 'user';
    const content = typeof message?.content === 'string'
      ? message.content
      : JSON.stringify(message?.content ?? '');
    return sum + estimateTokensWithTokenizer(`${role}:\n${content}`, model);
  }, 0);
}

export async function summarizeMessagesWithModel({
  messages,
  llmProxyUrl,
  model = process.env.SUMMARY_MODEL || 'gpt-4.1-nano'
}) {
  if (!llmProxyUrl || !Array.isArray(messages) || messages.length === 0) {
    return '';
  }
  const transcript = messages
    .map((entry) => `${entry.role || 'user'}: ${String(entry.content || '').slice(0, 1200)}`)
    .join('\n');

  try {
    const response = await fetch(llmProxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'Summarize prior chat context as concise bullet points preserving requirements, constraints, and pending tasks. Max 220 words.'
          },
          { role: 'user', content: transcript }
        ],
        temperature: 0.1
      })
    });
    if (!response.ok) {
      return '';
    }
    const data = await response.json();
    return String(
      data?.choices?.[0]?.message?.content
      ?? data?.candidates?.[0]?.content
      ?? data?.output_text
      ?? ''
    ).trim();
  } catch {
    return '';
  }
}

export async function buildTrimmedContext({
  systemPrompt = '',
  messages = [],
  codeSegments = [],
  maxTokens = 6000,
  model = DEFAULT_MODEL,
  maxRecentMessages = 6,
  summaryTriggerTokens = 5000,
  maxCodeChars = 3000,
  llmProxyUrl
}) {
  const normalizedMessages = Array.isArray(messages)
    ? messages
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        role: entry.role === 'assistant' ? 'assistant' : entry.role === 'system' ? 'system' : 'user',
        content: typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content ?? '')
      }))
      .filter((entry) => entry.content.trim())
    : [];

  const normalizedSegments = Array.isArray(codeSegments)
    ? codeSegments
      .filter((segment) => segment && typeof segment === 'object')
      .map((segment) => ({
        name: String(segment.name || segment.module || 'code'),
        content: String(segment.content || '').slice(0, maxCodeChars)
      }))
      .filter((segment) => segment.content)
    : [];

  const systemTokens = estimateTokensWithTokenizer(systemPrompt, model);
  const naiveTokens = systemTokens
    + estimateMessageTokens(normalizedMessages, model)
    + normalizedSegments.reduce((sum, segment) => {
      return sum + estimateTokensWithTokenizer(`[${segment.name}]\n${segment.content}`, model);
    }, 0);

  const recentMessages = normalizedMessages.slice(-maxRecentMessages);
  const olderMessages = normalizedMessages.slice(0, -maxRecentMessages);
  const olderTokens = estimateMessageTokens(olderMessages, model);

  let summaryText = '';
  if (olderMessages.length && olderTokens > summaryTriggerTokens) {
    summaryText = await summarizeMessagesWithModel({
      messages: olderMessages,
      llmProxyUrl,
      model
    });
  }

  const built = [];
  let usedTokens = 0;

  if (systemPrompt) {
    built.push({ role: 'system', content: systemPrompt });
    usedTokens += systemTokens;
  }

  if (summaryText) {
    const summaryMessage = `Conversation summary:\n${summaryText}`;
    const summaryTokens = estimateTokensWithTokenizer(summaryMessage, model);
    if (usedTokens + summaryTokens <= maxTokens) {
      built.push({ role: 'system', content: summaryMessage });
      usedTokens += summaryTokens;
    }
  }

  for (let index = 0; index < recentMessages.length; index += 1) {
    const message = recentMessages[index];
    const messageTokens = estimateTokensWithTokenizer(`${message.role}:\n${message.content}`, model);
    if (usedTokens + messageTokens > maxTokens) {
      break;
    }
    built.push(message);
    usedTokens += messageTokens;
  }

  for (const segment of normalizedSegments) {
    const block = `Relevant code (${segment.name}):\n${segment.content}`;
    const segmentTokens = estimateTokensWithTokenizer(block, model);
    if (usedTokens + segmentTokens > maxTokens) {
      break;
    }
    built.push({ role: 'system', content: block });
    usedTokens += segmentTokens;
  }

  return {
    messages: built,
    tokenCount: usedTokens,
    naiveTokenCount: naiveTokens,
    savedTokens: Math.max(0, naiveTokens - usedTokens),
    summaryText
  };
}
