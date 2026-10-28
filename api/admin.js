// POST /api/admin {action, ...}  →  host-only tools, protected by ADMIN_PASSWORD
import { endpoint, requireAdmin, photos, removePhotos, toClientPhotos, storage, json, fail, PARTY } from './_lib.js';

const PAGE_SIZE = 60;

const actions = {
  // Checks the password and returns the headline numbers
  async summary() {
    const [total, favourites] = await Promise.all([photos.count(), photos.count({ is_favourite: 'eq.true' })]);
    return { party: PARTY, total, favourites };
  },

  // Every photo, or only the starred ones with {favourites: true}
  async list({ before, favourites }) {
    const where = favourites ? { is_favourite: 'eq.true' } : {};
    const rows = await photos.page({ beforeId: Number(before) || null, limit: PAGE_SIZE + 1, where });
    const pageRows = rows.slice(0, PAGE_SIZE);
    return {
      photos: await toClientPhotos(pageRows, null),
      next: rows.length > PAGE_SIZE ? pageRows[pageRows.length - 1].id : null,
    };
  },

  async delete({ ids }) {
    const clean = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger).slice(0, 200);
    if (!clean.length) return { deleted: 0 };
    const rows = await photos.byIds(clean);
    await removePhotos(rows);
    return { deleted: rows.length };
  },

  // Full-size links for the zip download, oldest first
  async export({ offset, limit }) {
    const rows = await photos.range({
      offset: Math.max(0, Number(offset) || 0),
      limit: Math.min(200, Math.max(1, Number(limit) || 100)),
    });
    const urls = await storage.signedUrls(rows.map((r) => r.path));
    return {
      items: rows.filter((r) => urls[r.path]).map((r) => ({ id: r.id, name: r.uploader_name, at: r.created_at, url: urls[r.path], favourite: r.is_favourite })),
    };
  },
};

export const POST = endpoint(async (request) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const action = actions[body.action];
  if (!action) return fail(400, 'bad_action', 'Unknown action.');
  return json(await action(body));
});
