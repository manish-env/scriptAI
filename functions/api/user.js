import { json, err, uuid } from '../_helpers.js';

// GET /api/user?id=xxx  — fetch profile
// POST /api/user        — upsert profile { id?, name, niche, photo_key? }
export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return err('id required');

  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!user) return json(null, 404);
  return json(user);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { name, niche, photo_key } = body;
  const id = body.id || uuid();

  if (!name) return err('name required');

  await env.DB.prepare(`
    INSERT INTO users (id, name, niche, photo_key, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      niche = excluded.niche,
      photo_key = COALESCE(excluded.photo_key, photo_key),
      updated_at = datetime('now')
  `).bind(id, name, niche || null, photo_key || null).run();

  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  return json(user);
}
