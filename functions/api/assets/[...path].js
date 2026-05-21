// GET /api/assets/<key>  — serve R2 object
export async function onRequestGet({ params, env }) {
  const key = params.path.join('/');
  const obj = await env.ASSETS.get(key);

  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');

  return new Response(obj.body, { headers });
}
