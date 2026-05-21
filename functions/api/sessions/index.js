import { json, err, uuid } from '../../_helpers.js';

// GET /api/sessions?user_id=xxx  — list sessions
// POST /api/sessions              — create session { user_id }
export async function onRequestGet({ request, env }) {
  const user_id = new URL(request.url).searchParams.get('user_id');
  if (!user_id) return err('user_id required');

  const { results } = await env.DB.prepare(
    'SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC'
  ).bind(user_id).all();

  return json(results);
}

export async function onRequestPost({ request, env }) {
  const { user_id } = await request.json();
  if (!user_id) return err('user_id required');

  const id = uuid();
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id) VALUES (?, ?)'
  ).bind(id, user_id).run();

  return json({ id, user_id });
}
