import { issueSession } from '../../../src/auth/session';

export async function onRequestPost({ env, request }: { env: Env; request: Request }) {
  if (env.ENVIRONMENT !== 'dev') {
    return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  const user = {
    id: 'dev-user',
    email: 'dev@example.com',
    name: 'Dev User',
    provider: 'dev'
  };

  return issueSession(user, env, request);
}
