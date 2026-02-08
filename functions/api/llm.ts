export async function onRequest({ request }: { request: Request }) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const body = await request.json();

  return new Response(
    JSON.stringify({
      reply: 'LLM backend is alive',
      echo: body
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
