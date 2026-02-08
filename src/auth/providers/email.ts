import { issueSession } from '../session';
import { jsonError } from '../errors';
import { createSignedToken, verifySignedToken } from '../token';
import { requireEnv } from '../env';

let lastDevMagicLink: string | null = null;

export function getLastDevMagicLink() {
  return lastDevMagicLink;
}

export async function requestEmailLink(request: Request, env: Env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const { email } = body;

  if (!email) {
    return jsonError('Email required', 400);
  }

  const missing = [
    ...requireEnv(env, ['EMAIL_TOKEN_SECRET']),
    ...(env.ENVIRONMENT === 'dev' ? [] : requireEnv(env, ['RESEND_API_KEY']))
  ];
  if (missing.length) {
    return jsonError(`Missing env: ${missing.join(', ')}`, 500);
  }

  // Short-lived, single-purpose token
  const token = await createSignedToken(
    {
      sub: email,
      type: 'email_magic',
      exp: Math.floor(Date.now() / 1000) + 15 * 60
    },
    env.EMAIL_TOKEN_SECRET
  );

  const origin = env.FRONTEND_URL || new URL(request.url).origin;
  const magicLink = `${origin}/auth/email?token=${encodeURIComponent(token)}`;

  if (env.ENVIRONMENT === 'dev') {
    lastDevMagicLink = magicLink;
    console.info('[DEV] Magic link generated:', magicLink);
    return Response.json({
      debug_magic_link: magicLink
    });
  }

  await sendMagicEmail(email, magicLink, env);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function verifyEmailToken(request: Request, env: Env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const { token } = body;

  if (!token) {
    return jsonError('Missing token', 400);
  }

  const missing = requireEnv(env, ['EMAIL_TOKEN_SECRET', 'SESSION_SECRET']);
  if (missing.length) {
    return jsonError(`Missing env: ${missing.join(', ')}`, 500);
  }

  const payload = await verifySignedToken(token, env.EMAIL_TOKEN_SECRET);
  if (!payload) {
    return jsonError('Invalid or expired token', 401);
  }

  const { sub, type, exp } = payload as {
    sub?: string;
    type?: string;
    exp?: number;
  };

  if (type !== 'email_magic' || !sub) {
    return jsonError('Invalid token type', 401);
  }
  if (typeof exp === 'number' && exp < Math.floor(Date.now() / 1000)) {
    return jsonError('Invalid or expired token', 401);
  }

  const user = {
    id: `email:${sub}`,
    email: sub,
    provider: 'email'
  };

  return issueSession(user, env, request);
}

async function sendMagicEmail(email: string, link: string, env: Env) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Maya <auth@primarydesignco.com>',
      to: email,
      subject: 'Sign in to Maya',
      html: `
        <p>Click to sign in:</p>
        <p><a href="${link}">Sign in to Maya</a></p>
        <p>This link expires in 15 minutes.</p>
      `
    })
  });

  if (!res.ok) {
    throw new Error('Failed to send email');
  }
}
