import { handleGoogle } from './providers/google';
import { requestEmailLink, verifyEmailToken } from './providers/email';
import { jsonError } from './errors';

export async function handleAuth(request: Request, env: Env) {
  const url = new URL(request.url);

  if (request.method !== 'POST') {
    return jsonError('Method not allowed', 405);
  }

  switch (url.pathname) {
    case '/auth/google':
      return handleGoogle(request, env);

    case '/auth/email/request':
      return requestEmailLink(request, env);

    case '/auth/email/verify':
      return verifyEmailToken(request, env);

    // future
    // case '/auth/apple':
    //   return handleApple(request, env);

    default:
      return jsonError('Unknown auth provider', 404);
  }
}
