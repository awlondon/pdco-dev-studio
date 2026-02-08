import { handleAuth } from './auth';
import { handleMe } from './auth/me';

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const pathname = url.pathname.startsWith('/api/')
      ? url.pathname.slice(4)
      : url.pathname;

    if (pathname.startsWith('/auth/')) {
      return handleAuth(request, env);
    }

    if (pathname === '/me') {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleMe(request, env);
    }

    return new Response('Not found', { status: 404 });
  }
};
