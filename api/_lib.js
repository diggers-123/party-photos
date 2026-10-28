// Shared helpers for the API functions.
// Files whose names start with "_" are not turned into web addresses by Vercel.
import { PARTY } from './_config.js';

export { PARTY };

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

// Wraps an endpoint so unexpected problems become a tidy JSON error.
// Full details go to the Vercel logs; set-up problems get a plain-English hint for the host.
export function endpoint(fn) {
  return async (request) => {
    try {
      return await fn(request);
    } catch (err) {
      console.error(err);
      if (err instanceof SetupError) return fail(500, 'not_configured', err.message);
      const hint = setupHint(err);
      if (hint) return fail(500, 'not_configured', `The album isn't set up correctly. ${hint}`);
      return fail(500, 'server_error', 'Something went wrong on the server. Please try again.');
    }
  };
}

class SupabaseError extends Error {
  constructor(status, path, text) {
    super(`Supabase ${path} failed (${status}): ${text.slice(0, 300)}`);
    this.status = status;
    this.path = path;
    this.text = text;
  }
}

// Turns the usual set-up mistakes into a message the host can act on.
// Only says which setting is wrong, never what the secret values are.
function setupHint(err) {
  if (!(err instanceof SupabaseError)) {
    if (err instanceof TypeError || /fetch failed|ENOTFOUND|getaddrinfo/i.test(String(err?.cause || err))) {
      return "Host: the server can't reach Supabase. Check SUPABASE_URL in Vercel (it should look like https://abcd1234.supabase.co).";
    }
    return null;
  }
  const t = err.text || '';
  if (/<html|<!doctype/i.test(t)) return 'Host: SUPABASE_URL looks wrong. It should look like https://abcd1234.supabase.co with nothing after ".co".';
  if (err.status === 401 || err.status === 403 || /invalid api key|jwt|unauthori[sz]ed/i.test(t)) {
    return 'Host: Supabase rejected the key. Check SUPABASE_SECRET_KEY in Vercel is the SECRET key (sb_secret_… or service_role), then redeploy.';
  }
  if (/is_favourite/.test(t)) return 'Host: the database is missing the favourites column. Run supabase-setup.sql again in Supabase → SQL Editor.';
  if (err.path.startsWith('/rest/') && (err.status === 404 || /PGRST205|42P01|could not find the table|does not exist/i.test(t))) {
    return 'Host: the photos table is missing. Run supabase-setup.sql in Supabase → SQL Editor.';
  }
  if (err.path.startsWith('/storage/') && /bucket not found/i.test(t)) {
    return 'Host: the "photos" storage bucket is missing. Run supabase-setup.sql again, or create a private bucket called photos.';
  }
  return `Host: Supabase said "${t.replace(/<[^>]*>/g, '').slice(0, 160)}" (status ${err.status}).`;
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

function supabaseKey() {
  const key = env('SUPABASE_SECRET_KEY');
  if (key.startsWith('sb_publishable_')) {
    throw new SetupError('SUPABASE_SECRET_KEY is the publishable key. Use the SECRET key (sb_secret_…) from Supabase → Project Settings → API Keys, then redeploy.');
  }
  if (key.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role === 'anon') {
        throw new SetupError('SUPABASE_SECRET_KEY is the "anon" key. Use the "service_role" key (or a sb_secret_… key) instead, then redeploy.');
      }
    } catch (err) {
      if (err instanceof SetupError) throw err;
    }
  }
  return key;
}

function supabaseUrl() {
  const url = env('SUPABASE_URL').replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url)) {
    throw new SetupError('SUPABASE_URL should look like https://abcd1234.supabase.co, with nothing before "https" or after ".co". Fix it in Vercel, then redeploy.');
  }
  return url;
}

async function supabase(path, { method = 'GET', headers = {}, body } = {}) {
  const base = supabaseUrl();
  const key = supabaseKey();
  // New-style keys (sb_secret_…) go in the apikey header only;
  // older "service_role" keys are JWTs (eyJ…) and also go in Authorization.
  const auth = key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {};
  const res = await fetch(base + path, {
    method,
    body,
    headers: { apikey: key, ...auth, ...headers },
  });
  const text = await res.text();
  if (!res.ok) throw new SupabaseError(res.status, path.split('?')[0], text);
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
    const base = supabaseUrl() + '/storage/v1';
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
