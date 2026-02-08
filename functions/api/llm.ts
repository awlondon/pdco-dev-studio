export async function onRequestPost({ request, env }: any) {
  const body = await request.json();

  return new Response(
    JSON.stringify({
      ok: true,
      reply: "LLM backend is alive",
      echo: body
    }),
    {
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );
}
