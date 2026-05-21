import { deleteSessionRecords } from '../../../utils/sessionAssets'

interface Env { DB: D1Database; BUCKET: R2Bucket }

/** POST fallback — some Cloudflare Pages setups handle DELETE poorly. */
export default defineEventHandler(async (event) => {
  const env = (event.context.cloudflare?.env ?? {}) as Env
  const id = getRouterParam(event, 'id')!
  return deleteSessionRecords(env, id)
})
