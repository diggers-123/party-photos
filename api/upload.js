// POST /api/upload  →  saves one photo
// The browser sends the small thumbnail and the full photo back-to-back in one body;
// the x-thumb-size header says where the thumbnail ends.
import { endpoint, deviceIdFrom, photos, storage, thumbPath, toClientPhotos, json, fail } from './_lib.js';

const MAX_BYTES = 4 * 1024 * 1024; // Vercel accepts up to 4.5 MB per request

export const POST = endpoint(async (request) => {
  const deviceId = deviceIdFrom(request);
  if (!deviceId) return fail(400, 'bad_device', 'Please reload the page and try again.');

  const name = cleanName(request.headers.get('x-uploader-name'));
  if (!name) return fail(400, 'name_required', 'Please tell us your first name first.');

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > MAX_BYTES) return fail(413, 'too_big', 'That photo is too large to upload.');

  const thumbSize = Number(request.headers.get('x-thumb-size'));
  if (!Number.isInteger(thumbSize) || thumbSize <= 0 || thumbSize >= body.length) {
    return fail(400, 'bad_upload', 'The upload was incomplete. Please try again.');
  }
  const thumb = body.slice(0, thumbSize);
  const full = body.slice(thumbSize);
  if (!isJpeg(thumb) || !isJpeg(full)) return fail(415, 'not_a_photo', 'Only photos can be uploaded.');

  const path = `full/${crypto.randomUUID()}.jpg`;
  await Promise.all([storage.upload(path, full), storage.upload(thumbPath(path), thumb)]);

  let row;
  try {
    row = await photos.insert({ path, uploader_name: name, device_id: deviceId });
  } catch (err) {
    await storage.remove([path, thumbPath(path)]).catch(() => {});
    throw err;
  }

  const [photo] = await toClientPhotos([row], deviceId);
  return json({ photo }, 201);
});

function isJpeg(bytes) {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function cleanName(raw) {
  let name = '';
  try {
    name = decodeURIComponent(raw || '');
  } catch {
    return '';
  }
  return name.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}
