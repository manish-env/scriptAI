import { json, err, uuid } from '../_helpers.js';

// POST /api/upload
// body: { url, type, user_id, session_id? }
// Fetches the remote image and stores it in R2. Returns { key, assetUrl }.
export async function onRequestPost({ request, env }) {
  const { url, type, user_id, session_id } = await request.json();
  if (!url || !type || !user_id) return err('url, type and user_id required');

  const allowed = ['photo', 'scene_image', 'video'];
  if (!allowed.includes(type)) return err('invalid type');

  // Fetch the remote asset
  const remote = await fetch(url);
  if (!remote.ok) return err('could not fetch remote asset', 502);

  const contentType = remote.headers.get('content-type') || 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webm') ? 'webm' : 'jpg';
  const key = `${type}/${user_id}/${uuid()}.${ext}`;

  // Upload to R2
  await env.ASSETS.put(key, remote.body, {
    httpMetadata: { contentType },
  });

  // Record in D1
  const id = uuid();
  await env.DB.prepare(
    'INSERT INTO assets (id, user_id, session_id, type, r2_key) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, user_id, session_id || null, type, key).run();

  return json({ id, key, assetUrl: `/api/assets/${key}` });
}
