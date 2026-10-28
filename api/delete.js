// POST /api/delete {id}  →  deletes a photo, but only from the phone that uploaded it
import { endpoint, deviceIdFrom, photos, removePhotos, json, fail } from './_lib.js';

export const POST = endpoint(async (request) => {
  const deviceId = deviceIdFrom(request);
  const { id } = await request.json().catch(() => ({}));
  const photoId = Number(id);
  if (!deviceId || !Number.isInteger(photoId)) return fail(400, 'bad_request', 'Please reload the page and try again.');

  const [row] = await photos.byIds([photoId]);
  if (!row) return json({ ok: true }); // already gone
  if (row.device_id !== deviceId) return fail(403, 'not_yours', 'You can only delete photos you uploaded.');

  await removePhotos([row]);
  return json({ ok: true });
});
