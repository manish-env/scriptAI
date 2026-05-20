export async function onRequestGet(context) {
  const { params, env } = context;

  const response = await fetch(`https://api.replicate.com/v1/predictions/${params.id}`, {
    headers: { 'Authorization': `Token ${env.REPLICATE_API_KEY}` },
  });

  const data = await response.json();
  return Response.json(data, { status: response.status });
}
