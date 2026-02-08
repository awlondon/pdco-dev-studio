import { verifyEmailToken } from '../../../../src/auth/providers/email';

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'POST' }
    });
  }

  return verifyEmailToken(request, env);
}
