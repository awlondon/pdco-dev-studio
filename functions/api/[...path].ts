import { handleAuth } from '../../src/auth';
import { handleMe } from '../../src/auth/me';

export async function onRequest(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api', '');

  if (path === '/me') {
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }
    return handleMe(request, env);
  }

  if (path.startsWith('/auth/')) {
    const rewritten = new Request(
      new URL(url.pathname.replace('/api', ''), request.url),
      request
    );
    return handleAuth(rewritten, env);
  }

  return new Response('Not found', { status: 404 });
}
