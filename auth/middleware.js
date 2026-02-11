export const ALLOWED_ROLES = new Set(['user', 'admin', 'internal']);

export function normalizeRole(value) {
  const role = typeof value === 'string' ? value.trim().toLowerCase() : 'user';
  return ALLOWED_ROLES.has(role) ? role : 'user';
}

export function resolveRoleForUser(user, { adminEmails = [], internalEmails = [] } = {}) {
  const explicit = normalizeRole(user?.role);
  if (explicit !== 'user') {
    return explicit;
  }
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  if (email && internalEmails.includes(email)) {
    return 'internal';
  }
  if (email && adminEmails.includes(email)) {
    return 'admin';
  }
  return 'user';
}

export function requireAuth(session) {
  if (!session?.user?.id) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      })
    };
  }
  return { ok: true };
}

export function requireRole(session, role) {
  const required = normalizeRole(role);
  const current = normalizeRole(session?.user?.role);
  if (current !== required) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json' }
      })
    };
  }
  return { ok: true };
}
