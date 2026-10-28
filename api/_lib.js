// Shared helpers for the API functions.
// Files whose names start with "_" are not turned into web addresses by Vercel.
import { PARTY } from './_config.js';

export { PARTY };

export const MAX_FAVOURITES = 5; // photos each guest can share with everyone

const BUCKET = 'photos';
const SIGNED_URL_SECONDS = 6 * 60 * 60; // links to images stay valid for 6 hours
const COLUMNS = 'id,path,uploader_name,device_id,is_favourite,created_at';

class SetupError extends Error {}

function env(name) {
  const value = (process.env[name] || '').trim();
  if (!value) throw new SetupError(`Missing environment variable ${name}. Add it in Vercel → Settings → Environment Variables, then redeploy.`);
  return value;
}

/* ---------- responses ---------- */

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function fail(status, error, message) {
  return json({ error, message }, status);
}

// Wraps an endpoint so unexpected problems become a tidy JSON error
// (details go to the Vercel logs, not to guests).
export function endpoint(fn) {
  return async (request) => {
    try {
      return await fn(request);
    } catch (err) {
      console.error(err);
      if (err instanceof SetupError) return fail(500, 'not_configured', err.message);
      return fail(500, 'server_error', 'Something went wrong on the server. Please try again.');
    }
  };
}

/* ---------- access checks ---------- */

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// Compares two secrets without revealing how much of the guess was right.
async function secretMatches(given, expected) {
  if (!given) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Returns an error response if the admin password is wrong, otherwise null.
export async function requireAdmin(request) {
  if (await secretMatches(request.headers.get('x-admin-password'), env('ADMIN_PASSWORD'))) return null;
  await new Promise((resolve) => setTimeout(resolve, 1000)); // slows down password guessing
  return fail(401, 'bad_password', 'That admin password is not right.');
}

// Each phone gets a random ID the first time it opens the album. It's how the
// server knows which photos are "yours" (to show, star or delete them).
export function deviceIdFrom(request) {
  const id = request.headers.get('x-device-id') || '';
  return /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;
}

/* ---------- talking to Supabase (with the secret key, server-side only) ---------- */

async function supabase(path, { method = 'GET', headers = {}, body } = {}) {
  const base = env('SUPABASE_URL').replace(/\/+$/, '');
  const key = env('SUPABASE_SECRET_KEY');
  // New-style keys (sb_secret_…) go in the apikey header only;
  // older "service_role" keys are JWTs (eyJ…) and also go in Authorization.
  const auth = key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {};
  const res = await fetch(base + path, {
    method,
    body,
    headers: { apikey: key, ...auth, ...headers },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${method} ${path.split('?')[0]} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return { data: text ? JSON.parse(text) : null, headers: res.headers };
}

const jsonHeaders = { 'content-type': 'application/json' };

export const photos = {
  // Newest first, optionally only those older than `beforeId`.
  // `where` adds filters, e.g. { is_favourite: 'eq.true' }.
  async page({ beforeId, limit, where = {} }) {
    const q = new URLSearchParams({ select: COLUMNS, order: 'id.desc', limit: String(limit), ...where });
    if (beforeId) q.set('id', `lt.${beforeId}`);
    return (await supabase(`/rest/v1/photos?${q}`)).data;
  },

  // Oldest first, for the zip download.
  async range({ offset, limit }) {
    const q = new URLSearchParams({ select: COLUMNS, order: 'id.asc', offset: String(offset), limit: String(limit) });
    return (await supabase(`/rest/v1/photos?${q}`)).data;
  },

  async byIds(ids) {
    const q = new URLSearchParams({ select: COLUMNS, id: `in.(${ids.join(',')})` });
    return (await supabase(`/rest/v1/photos?${q}`)).data;
  },

  async insert(row) {
    const { data } = await supabase('/rest/v1/photos', {
      method: 'POST',
      headers: { ...jsonHeaders, prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    return data[0];
  },

  async update(id, changes) {
    const { data } = await supabase(`/rest/v1/photos?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders, prefer: 'return=representation' },
      body: JSON.stringify(changes),
    });
    return data[0];
  },

  async remove(ids) {
    await supabase(`/rest/v1/photos?id=in.(${ids.join(',')})`, { method: 'DELETE' });
  },

  async count(where = {}) {
    const q = new URLSearchParams({ select: 'id', limit: '1', ...where });
    const { headers } = await supabase(`/rest/v1/photos?${q}`, { headers: { prefer: 'count=exact' } });
    // Content-Range looks like "0-0/123" (or "*/0" when empty)
    return Number((headers.get('content-range') || '').split('/')[1]) || 0;
  },
};

export const thumbPath = (path) => path.replace(/^full\//, 'thumb/');

export const storage = {
  async upload(path, bytes) {
    await supabase(`/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=31536000', 'x-upsert': 'false' },
      body: bytes,
    });
  },

  // Returns { path: temporary viewing URL }
  async signedUrls(paths) {
    if (!paths.length) return {};
    const { data } = await supabase(`/storage/v1/object/sign/${BUCKET}`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS, paths }),
    });
    const base = env('SUPABASE_URL').replace(/\/+$/, '') + '/storage/v1';
    const urls = {};
    for (const item of data) if (item.signedURL) urls[item.path] = encodeURI(base + item.signedURL);
    return urls;
  },

  async remove(paths) {
    if (!paths.length) return;
    await supabase(`/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: jsonHeaders,
      body: JSON.stringify({ prefixes: paths }),
    });
  },
};

// Deletes the database rows first, so a half-finished delete never leaves a broken photo in the gallery.
export async function removePhotos(rows) {
  if (!rows.length) return;
  await photos.remove(rows.map((r) => r.id));
  await storage.remove(rows.flatMap((r) => [r.path, thumbPath(r.path)]));
}

export const favouritesOf = (deviceId) => ({ device_id: `eq.${deviceId}`, is_favourite: 'eq.true' });

// What the browser gets for each photo. Device IDs never leave the server;
// the browser only learns whether a photo is its own.
export async function toClientPhotos(rows, deviceId) {
  const urls = await storage.signedUrls(rows.flatMap((r) => [r.path, thumbPath(r.path)]));
  return rows
    .filter((r) => urls[r.path])
    .map((r) => ({
      id: r.id,
      name: r.uploader_name,
      at: r.created_at,
      full: urls[r.path],
      thumb: urls[thumbPath(r.path)] || urls[r.path],
      mine: Boolean(deviceId) && r.device_id === deviceId,
      favourite: Boolean(r.is_favourite),
    }));
}
