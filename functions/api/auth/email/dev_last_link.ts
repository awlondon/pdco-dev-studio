import { getLastDevMagicLink } from '../../../../src/auth/providers/email';

export async function onRequestGet({ env }: { env: Env }) {
  if (env.ENVIRONMENT !== 'dev') {
    return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  const link = getLastDevMagicLink();
  return Response.json({ ok: true, link });
}
