function getEnvHint(env: Env) {
  return env.ENVIRONMENT || env.ENV || env.NODE_ENV || 'unknown';
}

export async function onRequest({ env }: { env: Env }) {
  return new Response(
    JSON.stringify({
      ok: true,
      ts: new Date().toISOString(),
      envHint: getEnvHint(env)
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
