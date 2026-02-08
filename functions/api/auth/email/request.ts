import { requestEmailLink } from '../../../../src/auth/providers/email';

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  return requestEmailLink(request, env);
}
