// POST /api/favourite {id, favourite: true|false}  →  stars or un-stars one of your own photos.
// Starred photos appear in the Favourites album for everyone.
import { endpoint, deviceIdFrom, photos, toClientPhotos, favouritesOf, json, fail } from './_lib.js';

export const POST = endpoint(async (request) => {
  const deviceId = deviceIdFrom(request);
  const { id, favourite } = await request.json().catch(() => ({}));
  const photoId = Number(id);
  if (!deviceId || !Number.isInteger(photoId) || typeof favourite !== 'boolean') {
    return fail(400, 'bad_request', 'Please reload the page and try again.');
  }

  const [row] = await photos.byIds([photoId]);
  if (!row) return fail(404, 'not_found', 'That photo has been deleted.');
  if (row.device_id !== deviceId) return fail(403, 'not_yours', 'You can only pick your own photos as favourites.');

  const updated = row.is_favourite === favourite ? row : await photos.update(photoId, { is_favourite: favourite });
  const [photo] = await toClientPhotos([updated], deviceId);
  return json({ photo, myFavourites: await photos.count(favouritesOf(deviceId)) });
});
