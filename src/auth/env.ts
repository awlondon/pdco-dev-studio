export function requireEnv(env: Env, keys: (keyof Env)[]) {
  const missing: string[] = [];
  for (const k of keys) {
    const v = (env as any)[k];
    if (v === undefined || v === null || String(v).trim() === '') {
      missing.push(String(k));
    }
  }
  return missing;
}
