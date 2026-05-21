import { resolveAssetPath } from '../../utils/helpers'

interface Env { BUCKET: R2Bucket }

export default defineEventHandler(async (event) => {
  const env = (event.context.cloudflare?.env ?? {}) as Env
  const path = resolveAssetPath(event)

  if (!path) throw createError({ statusCode: 404, message: 'asset path required' })
  if (!env.BUCKET) throw createError({ statusCode: 404, message: 'storage not configured' })

  const obj = await env.BUCKET.get(path)
  if (!obj) throw createError({ statusCode: 404, message: 'asset not found' })

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')

  return new Response(obj.body as ReadableStream, { headers })
})
