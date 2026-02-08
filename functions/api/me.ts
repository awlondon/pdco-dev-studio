import { handleMe } from '../../src/auth/me';

export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  return handleMe(request, env);
}
