// GET /api/photos?view=favourites|mine&before=<id>  →  a page of photos, newest first
//   favourites: the photos every guest has starred (everyone can see these)
//   mine:       all photos uploaded from this phone (only this phone and the host see them)
// Other guests' un-starred photos are never sent to guests; only the host dashboard shows them.
import { endpoint, deviceIdFrom, photos, toClientPhotos, favouritesOf, json, fail, PARTY, MAX_FAVOURITES } from './_lib.js';

const PAGE_SIZE = 48;

export const GET = endpoint(async (request) => {
  const params = new URL(request.url).searchParams;
  const view = params.get('view') === 'mine' ? 'mine' : 'favourites';
  const deviceId = deviceIdFrom(request);
  if (view === 'mine' && !deviceId) return fail(400, 'bad_device', 'Please reload the page and try again.');

  const where = view === 'mine' ? { device_id: `eq.${deviceId}` } : { is_favourite: 'eq.true' };
  const before = Number(params.get('before')) || null;
  const firstPage = !before;
  const [rows, total, myFavourites] = await Promise.all([
    photos.page({ beforeId: before, limit: PAGE_SIZE + 1, where }),
    firstPage ? photos.count(where) : null,
    firstPage && deviceId ? photos.count(favouritesOf(deviceId)) : null,
  ]);
  const pageRows = rows.slice(0, PAGE_SIZE);

  return json({
    party: PARTY,
    view,
    total,
    myFavourites,
    maxFavourites: MAX_FAVOURITES,
    photos: await toClientPhotos(pageRows, deviceId),
    next: rows.length > PAGE_SIZE ? pageRows[pageRows.length - 1].id : null,
  });
});
