import { handleAuth } from './auth';
import { handleMe } from './auth/me';
import { corsHeaders } from './cors';

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const pathname = url.pathname.startsWith('/api/')
      ? url.pathname.slice(4)
      : url.pathname;

    if (request.method === 'OPTIONS' && (pathname.startsWith('/auth/') || pathname === '/me')) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (pathname.startsWith('/auth/')) {
      return handleAuth(request, env);
    }

    if (pathname === '/me') {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405, headers: corsHeaders });
      }
      return handleMe(request, env);
    }

    return new Response('Not found', { status: 404 });
  }
};
