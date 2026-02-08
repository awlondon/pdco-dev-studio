const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncodeBytes(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeString(value: string) {
  return base64UrlEncodeBytes(encoder.encode(value));
}

function base64UrlDecodeToString(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(padded + padding);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return decoder.decode(bytes);
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function signHmac(data: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

export async function createSignedToken(payload: Record<string, unknown>, secret: string) {
  const data = JSON.stringify(payload);
  const signature = await signHmac(data, secret);
  return `${base64UrlEncodeString(data)}.${signature}`;
}

export async function verifySignedToken(token: string, secret: string) {
  const [payloadPart, signature] = token.split('.');
  if (!payloadPart || !signature) {
    return null;
  }
  const payloadJson = base64UrlDecodeToString(payloadPart);
  const expected = await signHmac(payloadJson, secret);
  if (!constantTimeEqual(signature, expected)) {
    return null;
  }
  try {
    return JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function decodeJwtPayload(token: string) {
  const [, payloadPart] = token.split('.');
  if (!payloadPart) {
    return null;
  }
  try {
    return JSON.parse(base64UrlDecodeToString(payloadPart)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
