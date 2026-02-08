import jwt from '@tsndr/cloudflare-worker-jwt';
import { issueSession } from '../session';
import { jsonError } from '../errors';

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

  // Short-lived, single-purpose token
  const token = await jwt.sign(
    {
      sub: email,
      type: 'email_magic',
      exp: Math.floor(Date.now() / 1000) + 15 * 60
    },
    env.EMAIL_TOKEN_SECRET
  );

  const magicLink = `${env.FRONTEND_URL}/auth/email?token=${encodeURIComponent(token)}`;

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

  const valid = await jwt.verify(token, env.EMAIL_TOKEN_SECRET);
  if (!valid) {
    return jsonError('Invalid or expired token', 401);
  }

  const payload: any = jwt.decode(token).payload;

  if (payload.type !== 'email_magic') {
    return jsonError('Invalid token type', 401);
  }

  const user = {
    id: `email:${payload.sub}`,
    email: payload.sub,
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
