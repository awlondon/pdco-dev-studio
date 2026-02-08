import { getSessionFromRequest } from './session';

export async function handleMe(request: Request, env: Env) {
  const session = await getSessionFromRequest(request, env);

  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const resolvedUser = {
    id: session.user?.sub ?? session.user?.id,
    email: session.user?.email,
    name: session.user?.name ?? session.user?.email?.split('@')[0] ?? 'User',
    plan: session.user?.plan ?? 'Free',
    creditsRemaining: session.user?.creditsRemaining ?? 500,
    provider: session.user?.provider
  };

  return new Response(JSON.stringify({
    token: session.token,
    user: resolvedUser,
    session
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
