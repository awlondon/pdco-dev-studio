import { handleAuth } from './auth';
import { handleMe } from './auth/me';
import { corsHeaders } from './cors';

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS' && (url.pathname.startsWith('/auth/') || url.pathname === '/me')) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname.startsWith('/auth/')) {
      return handleAuth(request, env);
    }

    if (url.pathname === '/me') {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405, headers: corsHeaders });
      }
      return handleMe(request, env);
    }

    return new Response('Not found', { status: 404 });
  }
};
