const DEFAULT_ALLOWED_ORIGINS = [
  'https://maya-dev-ui.pages.dev',
  'https://dev.primarydesignco.com',
  'http://localhost:3000',
  'http://localhost:5173'
];

function parseEnvOriginList(raw = '') {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function allowedOrigins(env) {
  return [
    ...new Set([
      ...DEFAULT_ALLOWED_ORIGINS,
      ...parseEnvOriginList(env.CORS_ALLOWED_ORIGINS || ''),
      ...parseEnvOriginList(env.FRONTEND_URL || '')
    ])
  ];
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowOrigin = allowedOrigins(env).includes(origin)
    ? origin
    : DEFAULT_ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers')
      || 'Content-Type,Authorization',
    Vary: 'Origin'
  };
}

function normalizePathname(pathname) {
  const withoutApiPrefix = pathname.startsWith('/api/') ? pathname.slice(4) : pathname;
  return withoutApiPrefix.startsWith('/v1/')
    ? withoutApiPrefix.slice(3)
    : withoutApiPrefix;
}

function canonicalApiOrigin(env) {
  const origin = env.CANONICAL_API_ORIGIN || env.API_ORIGIN || env.API_BASE_URL;
  if (!origin) {
    throw new Error('Missing CANONICAL_API_ORIGIN');
  }
  return origin.replace(/\/$/, '');
}

function withCors(response, headers) {
  const nextHeaders = new Headers(response.headers);
  Object.entries(headers).forEach(([key, value]) => nextHeaders.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: nextHeaders
  });
}

export default {
  async fetch(request, env) {
    const baseCorsHeaders = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: baseCorsHeaders
      });
    }

    let origin;
    try {
      origin = canonicalApiOrigin(env);
    } catch (error) {
      return withCors(
        new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Bad gateway' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' }
        }),
        baseCorsHeaders
      );
    }

    const url = new URL(request.url);
    const upstreamPath = normalizePathname(url.pathname);
    const upstreamUrl = new URL(`${origin}${upstreamPath}${url.search}`);

    const headers = new Headers(request.headers);
    headers.set('x-forwarded-host', url.host);
    headers.set('x-forwarded-proto', url.protocol.replace(':', ''));

    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual'
    });

    return withCors(upstreamResponse, baseCorsHeaders);
  }
};
