import { deleteR2Keys, gatherSessionAssetKeys } from '../../../utils/sessionAssets'

interface Env { DB: D1Database; BUCKET: R2Bucket }

export default defineEventHandler(async (event) => {
  const env = (event.context.cloudflare?.env ?? {}) as Env
  const session_id = getRouterParam(event, 'id')!
  if (!session_id) throw createError({ statusCode: 400, message: 'session id required' })

  const keys = await gatherSessionAssetKeys(env, session_id)
  await deleteR2Keys(env.BUCKET, keys)

  if (env.DB) {
    await env.DB.prepare(
      'UPDATE scenes SET image_key = NULL, frame_keys = NULL WHERE session_id = ?',
    ).bind(session_id).run()
    await env.DB.prepare('DELETE FROM assets WHERE session_id = ?').bind(session_id).run()
  }

  return { ok: true, cleared: keys.length }
})
