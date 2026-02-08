import { handleGoogle } from '../../../src/auth/providers/google';

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  return handleGoogle(request, env);
}
