import { getSessionFromRequest } from './session';

export async function handleMe(request: Request, env: Env) {
  const session = await getSessionFromRequest(request, env);

  if (!session) {
    return Response.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  return Response.json({
    ok: true,
    user: session.user,
    token: session.token
  });
}
