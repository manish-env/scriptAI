interface Env { BUCKET: R2Bucket }

export default defineEventHandler(async (event) => {
  const env = (event.context.cloudflare?.env ?? {}) as Env
  const path = (getRouterParam(event, 'path') as unknown as string[]).join('/')

  if (!env.BUCKET) throw createError({ statusCode: 404 })

  const obj = await env.BUCKET.get(path)
  if (!obj) throw createError({ statusCode: 404 })

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')

  return new Response(obj.body as ReadableStream, { headers })
})
