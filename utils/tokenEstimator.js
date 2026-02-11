import { createRequire } from 'node:module';

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const require = createRequire(import.meta.url);
const encoderCache = new Map();

let tiktokenModule = null;
try {
  tiktokenModule = require('tiktoken');
} catch {
  tiktokenModule = null;
}

function fallbackEstimate(text) {
  const tokens = String(text || '').match(/[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_]/g);
  return tokens ? tokens.length : 0;
}

function resolveEncoder(model = DEFAULT_MODEL) {
  if (!tiktokenModule) {
    return null;
  }

  const normalizedModel = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL;
  if (encoderCache.has(normalizedModel)) {
    return encoderCache.get(normalizedModel);
  }

  let encoder;
  try {
    encoder = tiktokenModule.encoding_for_model(normalizedModel);
  } catch {
    encoder = tiktokenModule.get_encoding('cl100k_base');
  }

  encoderCache.set(normalizedModel, encoder);
  return encoder;
}

export function estimateTokens(text, model = DEFAULT_MODEL) {
  if (text === null || text === undefined) {
    return 0;
  }

  const value = typeof text === 'string' ? text : JSON.stringify(text);
  if (!value) {
    return 0;
  }

  const encoder = resolveEncoder(model);
  if (!encoder) {
    return fallbackEstimate(value);
  }

  return encoder.encode(value).length;
}

export function isTokenizerAccurate() {
  return Boolean(tiktokenModule);
}
