import { handleMe } from '../../src/auth/me';

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET' }
    });
  }

  return handleMe(request, env);
}
