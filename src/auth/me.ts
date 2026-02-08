import { corsHeaders } from '../cors';
import { getSessionFromRequest } from './session';

export async function handleMe(request: Request, env: Env) {
  const session = await getSessionFromRequest(request, env);

  if (!session) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }

  return new Response(JSON.stringify({
    token: session.token,
    user: session.user,
    session
  }), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}
