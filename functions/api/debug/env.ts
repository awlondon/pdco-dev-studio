const REQUIRED_ENV_KEYS: (keyof Env)[] = [
  'GOOGLE_CLIENT_ID',
  'SESSION_SECRET',
  'COOKIE_DOMAIN',
  'EMAIL_TOKEN_SECRET',
  'RESEND_API_KEY',
  'FRONTEND_URL'
];

function isPresent(env: Env, key: keyof Env) {
  const value = (env as any)[key];
  return value !== undefined && value !== null && String(value).trim() !== '';
}

export async function onRequestGet({ env }: { env: Env }) {
  if (env.ENVIRONMENT !== 'dev') {
    return new Response('Not Found', { status: 404 });
  }

  const env_present = Object.fromEntries(
    REQUIRED_ENV_KEYS.map((key) => [key, isPresent(env, key)])
  );

  return Response.json({
    ok: true,
    env_present
  });
}
