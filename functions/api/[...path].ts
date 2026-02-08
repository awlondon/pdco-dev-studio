export async function onRequest(): Promise<Response> {
  return new Response(
    JSON.stringify({ ok: true, from: 'pages-function' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
