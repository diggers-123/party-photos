'use strict';

window.albumStarted = true; // tells the safety net in index.html that this file loaded

/* =========================================================================
   Party photo album — guest page
   Two albums:
     ★ Favourites — the (up to) 5 photos each guest has starred; everyone sees these
     My photos    — everything uploaded from this phone; only this phone and the host see these
   ========================================================================= */

const MAX_SIDE = 1600;       // longest side of uploaded photos, in pixels
const JPEG_QUALITY = 0.8;
const THUMB_SIDE = 480;      // gallery thumbnails
const THUMB_QUALITY = 0.72;
const PARALLEL_UPLOADS = 2;
const REFRESH_EVERY_MS = 30 * 1000;
const RELOAD_LINKS_AFTER_MS = 4 * 60 * 60 * 1000; // image links expire after 6 h, so refresh well before

const MSG = {
  offline: 'No signal right now. Check your Wi-Fi or mobile data and try again.',
  server: 'Something went wrong on our side. Please try again in a moment.',
  unsupported: "That file isn't a photo we can read.",
  notConfigured: "The album isn't set up yet. (Host: check the environment variables in Vercel.)",
};

const $ = (sel, root = document) => root.querySelector(sel);

// localStorage can be blocked (private browsing etc.), so fall back to memory
const store = {
  mem: {},
  get(k) {
    try { const v = localStorage.getItem(k); if (v !== null) return v; } catch {}
    return k in this.mem ? this.mem[k] : null;
  },
  set(k, v) { this.mem[k] = v; try { localStorage.setItem(k, v); } catch {} },
};

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function readJson(key) {
  try { return JSON.parse(store.get(key) || 'null'); } catch { return null; }
}

const newList = () => ({ photos: [], total: null, next: null, loading: false, loadedAt: 0, tiles: new Map() });

const state = {
  deviceId: store.get('party.device') || randomId(),
  name: store.get('party.name') || '',
  party: readJson('party.info'),
  tab: store.get('party.tab') === 'mine' ? 'mine' : 'favourites',
  lists: { favourites: newList(), mine: newList() },
  myFavourites: 0,
  screen: 'loading',
};
store.set('party.device', state.deviceId);

const currentList = () => state.lists[state.tab];

/* ---------- talking to the server ---------- */

class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function authHeaders(extra = {}) {
  return { 'x-device-id': state.deviceId, ...extra };
}

function errorFrom(status, data) {
  if (data.error === 'not_configured') return new ApiError('not_configured', data.message || MSG.notConfigured, status);
  if (status === 413) return new ApiError('too_big', 'That photo is too large to upload.', status);
  return new ApiError(data.error || 'server_error', data.message || MSG.server, status);
}

async function api(path, { method = 'GET', body } = {}) {
  let res;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000); // give up on a hopeless signal
  try {
    res = await fetch(path, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: authHeaders(body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('offline', MSG.offline);
  } finally {
    clearTimeout(timer);
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 404 && !data.error) {
    throw new ApiError('missing', "The album's server files are missing. (Host: the api folder didn't upload — see Troubleshooting in the guide.)", 404);
  }
  if (!res.ok) throw errorFrom(res.status, data);
  return data;
}

/* ---------- screens ---------- */

function show(screen) {
  state.screen = screen;
  for (const el of document.querySelectorAll('[data-screen]')) el.hidden = el.dataset.screen !== screen;
}

function applyParty(party) {
  if (!party) return;
  for (const el of document.querySelectorAll('[data-party]')) el.textContent = party[el.dataset.party] || '';
  document.title = `${party.title} · Photos`;
}

function showProblem(err) {
  $('#problem-text').textContent = err.message || MSG.server;
  show('problem');
}

function showWelcome(editing = false) {
  const input = $('#name-input');
  input.value = state.name;
  $('#welcome-submit').textContent = editing ? 'Save' : "Let's go ✨";
  $('#welcome-cancel').hidden = !editing;
  show('welcome');
  if (!editing) setTimeout(() => input.focus(), 50);
}

function enterAlbum() {
  $('#name-chip-text').textContent = state.name;
  show('album');
  renderGallery();
  startAutoRefresh();
  loadMoreIfNearBottom();
}

function handleError(err, { quiet = false } = {}) {
  if (!quiet) toast(err.message || MSG.server, 'error');
}

/* ---------- start-up ---------- */

async function boot() {
  applyParty(state.party);
  show('loading');
  try {
    await Promise.all([loadFirstPage('favourites'), loadFirstPage('mine')]);
  } catch (err) {
    return showProblem(err);
  }
  if (state.name) enterAlbum();
  else showWelcome();
}

$('#problem-retry').addEventListener('click', boot);

$('#welcome-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#name-input').value.replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) {
    toast('Please type your first name', 'error');
    $('#name-input').focus();
    return;
  }
  state.name = name;
  store.set('party.name', name);
  enterAlbum();
});

$('#welcome-cancel').addEventListener('click', enterAlbum);
$('#name-chip').addEventListener('click', () => showWelcome(true));

/* ---------- sharing the link ---------- */

$('#btn-share').addEventListener('click', async () => {
  const url = `${location.origin}/`;
  const title = state.party ? `${state.party.title} · Photos` : 'Party photos';
  if (navigator.share) {
    try {
      await navigator.share({ title, text: `Add your photos from ${state.party?.title || 'the party'} 🪩`, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // they closed the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied — paste it into a message 💌');
  } catch {
    toast(`Share this address: ${location.host}`);
  }
});

/* ---------- loading photos ---------- */

function applyCounts(data) {
  if (data.myFavourites != null) state.myFavourites = data.myFavourites;
}

async function loadFirstPage(view) {
  const data = await api(`/api/photos?view=${view}`);
  state.party = data.party;
  store.set('party.info', JSON.stringify(data.party));
  applyParty(data.party);
  applyCounts(data);
  const list = state.lists[view];
  list.photos = data.photos;
  list.total = data.total;
  list.next = data.next;
  list.loadedAt = Date.now();
  renderGallery();
}

async function loadMore(view = state.tab) {
  const list = state.lists[view];
  if (!list.next || list.loading) return;
  list.loading = true;
  if (view === state.tab) $('#load-more-text').textContent = 'Loading more photos…';
  try {
    const data = await api(`/api/photos?view=${view}&before=${encodeURIComponent(list.next)}`);
    const known = new Set(list.photos.map((p) => p.id));
    list.photos.push(...data.photos.filter((p) => !known.has(p.id)));
    list.next = data.next;
    renderGallery();
    if (viewer.open) refreshViewer();
  } catch (err) {
    handleError(err, { quiet: true });
  } finally {
    list.loading = false;
    $('#load-more-text').textContent = '';
  }
  loadMoreIfNearBottom(); // big screens may need another page straight away
}

// Picks up photos added (or removed) since we last looked
async function refreshNewest(view = state.tab, { quiet = true } = {}) {
  if (state.screen !== 'album') return;
  const list = state.lists[view];
  try {
    if (Date.now() - list.loadedAt > RELOAD_LINKS_AFTER_MS) {
      await loadFirstPage(view);
      return;
    }
    const data = await api(`/api/photos?view=${view}`);
    applyCounts(data);
    const fresh = new Set(data.photos.map((p) => p.id));
    const oldest = data.photos.length ? data.photos[data.photos.length - 1].id : Infinity;
    const known = new Map(list.photos.map((p) => [p.id, p]));
    // anything in the range we just fetched that's missing has been deleted or un-starred
    const kept = list.photos.filter((p) => fresh.has(p.id) || (data.next !== null && p.id < oldest));
    const added = data.photos.filter((p) => !known.has(p.id));
    for (const p of data.photos) if (known.has(p.id)) known.get(p.id).favourite = p.favourite;
    list.photos = [...added, ...kept].sort((a, b) => b.id - a.id);
    list.total = data.total;
    renderGallery();
    if (viewer.open) refreshViewer();
    if (!quiet && !added.length) toast("You're all caught up ✨");
  } catch (err) {
    handleError(err, { quiet });
  }
}

/* ---------- tabs & gallery ---------- */

function switchTab(tab) {
  if (tab === state.tab) return;
  if (selection.on) setSelecting(false);
  state.tab = tab;
  store.set('party.tab', tab);
  $('#grid').replaceChildren();
  renderGallery();
  window.scrollTo({ top: $('.gallery').offsetTop - 70, behavior: 'smooth' });
  refreshNewest(tab);
}

for (const btn of document.querySelectorAll('.tab')) btn.addEventListener('click', () => switchTab(btn.dataset.tab));

function starLabel(photo) {
  return photo.favourite ? 'Remove from Favourites' : 'Add to Favourites';
}

function tileFor(photo, view) {
  const list = state.lists[view];
  let el = list.tiles.get(photo.id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'tile';
    el.dataset.id = photo.id;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'tile-open';
    open.setAttribute('aria-label', `Open photo by ${photo.name}`);
    const img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onload = () => { el.classList.add('loaded'); el.classList.remove('broken'); };
    img.onerror = () => el.classList.add('broken');
    img.src = photo.thumb;
    open.append(img);
    el.append(open);
    if (view === 'favourites') {
      const by = document.createElement('span');
      by.className = 'by';
      by.textContent = photo.mine ? `${photo.name} · you` : photo.name;
      const check = document.createElement('span');
      check.className = 'check';
      check.setAttribute('aria-hidden', 'true');
      el.append(by, check);
    } else {
      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'star';
      el.append(star);
    }
    list.tiles.set(photo.id, el);
  } else {
    // refresh an expired link on a thumbnail that never loaded
    const img = el.querySelector('img');
    if (!el.classList.contains('loaded') && img.getAttribute('src') !== photo.thumb) img.src = photo.thumb;
  }
  const star = el.querySelector('.star');
  if (star) {
    star.textContent = photo.favourite ? '★' : '☆';
    star.classList.toggle('on', photo.favourite);
    star.setAttribute('aria-pressed', String(photo.favourite));
    star.setAttribute('aria-label', starLabel(photo));
  }
  return el;
}

function renderTabs() {
  for (const btn of document.querySelectorAll('.tab')) {
    const on = btn.dataset.tab === state.tab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  }
  const fav = state.lists.favourites.total;
  const mine = state.lists.mine.total;
  $('#count-favourites').textContent = fav ? fav : '';
  $('#count-mine').textContent = mine ? mine : '';
  const shared = state.myFavourites;
  $('#tab-hint').textContent = state.tab === 'favourites'
    ? "Everyone's top picks, with who took them. Star your own in My photos to add them here."
    : `Only you and the host can see these. Tap ☆ on any photo to share it with everyone${shared ? ` — ${shared} shared so far ✨` : ''}.`;
}

function renderGallery() {
  renderTabs();
  const list = currentList();
  const grid = $('#grid');
  const ids = new Set(list.photos.map((p) => p.id));
  for (const [id, el] of list.tiles) {
    if (!ids.has(id)) { el.remove(); list.tiles.delete(id); }
  }
  // place tiles in order, only moving the ones that are out of place
  let cursor = grid.firstElementChild;
  for (const photo of list.photos) {
    const el = tileFor(photo, state.tab);
    if (el === cursor) cursor = cursor.nextElementSibling;
    else grid.insertBefore(el, cursor);
  }
  const empty = $('#gallery-empty');
  empty.hidden = list.photos.length > 0;
  empty.innerHTML = state.tab === 'favourites'
    ? '<span class="big">★</span>No favourites yet.<br>Upload your photos, then star your best ones to show them here.'
    : '<span class="big">📸</span>You haven\'t added any photos yet.<br>Tap <b>Choose photos</b> above to start.';
  $('#btn-select').hidden = state.tab !== 'favourites' || !list.photos.length || selection.on;
  renderSelection();
}

$('#grid').addEventListener('click', (e) => {
  const tile = e.target.closest('.tile');
  if (!tile) return;
  const list = currentList();
  const photo = list.photos.find((p) => String(p.id) === tile.dataset.id);
  if (!photo) return;
  if (selection.on) toggleSelected(photo);
  else if (e.target.closest('.star')) toggleFavourite(photo);
  else if (e.target.closest('.tile-open')) openViewer(state.tab, list.photos.indexOf(photo));
});

$('#btn-refresh').addEventListener('click', () => refreshNewest(state.tab, { quiet: false }));

// Load the next page when the bottom of the gallery comes near
function loadMoreIfNearBottom() {
  if (state.screen !== 'album' || !currentList().next || currentList().loading) return;
  if ($('#sentinel').getBoundingClientRect().top < window.innerHeight + 900) loadMore();
}
window.addEventListener('scroll', loadMoreIfNearBottom, { passive: true });
window.addEventListener('resize', loadMoreIfNearBottom);

let refreshTimer;
function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && !viewer.open) refreshNewest();
  }, REFRESH_EVERY_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !viewer.open) refreshNewest();
});

/* ---------- favourites ---------- */

// Keeps the Favourites album in step with a photo that was just starred or un-starred
function syncFavourites(photo) {
  const fav = state.lists.favourites;
  const i = fav.photos.findIndex((p) => p.id === photo.id);
  if (photo.favourite && i < 0) {
    const { busy, ...copy } = photo;
    fav.photos.push(copy);
    fav.photos.sort((a, b) => b.id - a.id);
    fav.total = (fav.total ?? 0) + 1;
  } else if (!photo.favourite && i >= 0) {
    fav.photos.splice(i, 1);
    if (fav.total) fav.total--;
  }
}

async function toggleFavourite(photo) {
  if (!photo || !photo.mine || photo.busy) return;
  const want = !photo.favourite;
  // update straight away so it feels instant, then confirm with the server
  photo.busy = true;
  const mine = state.lists.mine.photos.find((p) => p.id === photo.id) || photo;
  const setFav = (value) => {
    photo.favourite = value;
    mine.favourite = value;
    syncFavourites(mine);
  };
  setFav(want);
  state.myFavourites += want ? 1 : -1;
  renderGallery();
  if (viewer.open) refreshViewer();
  try {
    const data = await api('/api/favourite', { method: 'POST', body: { id: photo.id, favourite: want } });
    applyCounts(data);
    setFav(data.photo.favourite);
    toast(want ? '★ Added to Favourites — everyone can see it' : 'Removed from Favourites');
  } catch (err) {
    setFav(!want);
    state.myFavourites += want ? -1 : 1;
    handleError(err);
  } finally {
    photo.busy = false;
    renderGallery();
    if (viewer.open) refreshViewer();
  }
}

/* ---------- making photos smaller before upload ---------- */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, release: () => URL.revokeObjectURL(url) });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ApiError('unsupported', MSG.unsupported));
    };
    img.src = url;
  });
}

function drawScaled(source, maxSide) {
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs get a white background
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ApiError('unsupported', MSG.unsupported))), 'image/jpeg', quality);
  });
}

// Re-encoding also strips hidden location data (EXIF) from the photo
async function compressPhoto(file) {
  const { img, release } = await loadImage(file);
  if (!img.naturalWidth) { release(); throw new ApiError('unsupported', MSG.unsupported); }
  const big = drawScaled(img, MAX_SIDE);
  release();
  let full = await toJpeg(big, JPEG_QUALITY);
  if (full.size > 3.5 * 1024 * 1024) full = await toJpeg(big, 0.6);
  const small = drawScaled(big, THUMB_SIDE);
  const thumb = await toJpeg(small, THUMB_QUALITY);
  big.width = big.height = small.width = small.height = 0; // frees memory on older iPhones
  return { full, thumb };
}

// One photo at a time through the shrinking step keeps phones from running out of memory
let compressChain = Promise.resolve();
function compressInTurn(file) {
  const run = compressChain.then(() => compressPhoto(file));
  compressChain = run.catch(() => {});
  return run;
}

/* ---------- uploading ---------- */

const uploads = { jobs: [], running: 0, hideTimer: null };

function uploadPhoto({ full, thumb }, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    const headers = authHeaders({
      'content-type': 'application/octet-stream',
      'x-uploader-name': encodeURIComponent(state.name),
      'x-thumb-size': String(thumb.size),
    });
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.timeout = 120000;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && data.photo) resolve(data.photo);
      else reject(errorFrom(xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError('offline', MSG.offline));
    xhr.ontimeout = () => reject(new ApiError('offline', 'The upload timed out — the signal may be weak.'));
    xhr.send(new Blob([thumb, full], { type: 'application/octet-stream' }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const canRetry = (err) => err.code === 'offline' || err.code === 'server_error' || err.status >= 500;

function addFiles(fileList) {
  const files = [...fileList];
  const photos = files.filter((f) => f.type.startsWith('image/') || (!f.type && /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(f.name)));
  const skipped = files.length - photos.length;
  if (skipped) toast(`${skipped} file${skipped === 1 ? ' was' : 's were'} skipped — photos only, no videos`, 'error');
  if (!photos.length) return;

  // start a fresh progress bar if the last batch has finished
  if (!uploads.jobs.some((j) => j.status === 'waiting' || j.status === 'working')) {
    uploads.jobs = uploads.jobs.filter((j) => j.status === 'failed');
  }
  clearTimeout(uploads.hideTimer);
  for (const file of photos) uploads.jobs.push({ file, status: 'waiting', progress: 0, error: null, blobs: null });
  switchTab('mine'); // show their photos so they can star the best ones
  pump();
}

function pump() {
  while (uploads.running < PARALLEL_UPLOADS) {
    const job = uploads.jobs.find((j) => j.status === 'waiting');
    if (!job) break;
    job.status = 'working';
    uploads.running++;
    processJob(job).finally(() => {
      uploads.running--;
      pump();
    });
  }
  renderUploads();
}

async function processJob(job) {
  for (let attempt = 0; ; attempt++) {
    try {
      if (!job.blobs) job.blobs = await compressInTurn(job.file);
      job.progress = 0.1;
      renderUploads();
      const photo = await uploadPhoto(job.blobs, (f) => { job.progress = 0.1 + 0.9 * f; renderUploads(); });
      job.status = 'done';
      job.progress = 1;
      job.blobs = null;
      addUploadedPhoto(photo);
      return;
    } catch (err) {
      if (canRetry(err) && attempt < 2 && navigator.onLine !== false) {
        await sleep(attempt === 0 ? 2000 : 5000);
        continue;
      }
      job.status = 'failed';
      job.error = err;
      job.progress = 0;
      return;
    }
  }
}

function addUploadedPhoto(photo) {
  const list = state.lists.mine;
  if (list.photos.some((p) => p.id === photo.id)) return;
  list.photos.unshift(photo);
  list.total = (list.total ?? 0) + 1;
  renderGallery();
  list.tiles.get(photo.id)?.classList.add('is-new');
}

function retryFailed({ onlyOffline = false } = {}) {
  let any = false;
  for (const job of uploads.jobs) {
    if (job.status === 'failed' && (!onlyOffline || job.error?.code === 'offline') && job.error?.code !== 'unsupported') {
      job.status = 'waiting';
      job.error = null;
      any = true;
    }
  }
  if (any) pump();
}

function renderUploads() {
  const panel = $('#upload-panel');
  const jobs = uploads.jobs;
  if (!jobs.length) { panel.hidden = true; return; }

  const done = jobs.filter((j) => j.status === 'done').length;
  const failed = jobs.filter((j) => j.status === 'failed');
  const active = jobs.filter((j) => j.status === 'waiting' || j.status === 'working').length;
  const counted = jobs.filter((j) => j.status !== 'failed');
  const pct = counted.length ? (counted.reduce((s, j) => s + j.progress, 0) / counted.length) * 100 : 100;

  panel.hidden = false;
  panel.classList.toggle('is-done', !active && !failed.length);
  panel.classList.toggle('is-error', !active && failed.length > 0);
  $('#upload-bar').style.width = `${Math.round(pct)}%`;
  panel.querySelector('.progress').setAttribute('aria-valuenow', String(Math.round(pct)));

  let text;
  const retryable = failed.filter((j) => j.error?.code !== 'unsupported');
  if (active) {
    text = `Uploading ${Math.min(done + 1, jobs.length)} of ${jobs.length}…`;
  } else if (!failed.length) {
    const nudge = ' Now star your favourites ☆ below to share them.';
    text = `🎉 ${done} photo${done === 1 ? '' : 's'} added — thank you!${nudge}`;
    clearTimeout(uploads.hideTimer);
    uploads.hideTimer = setTimeout(() => { uploads.jobs = []; renderUploads(); }, 6000);
  } else {
    const offline = failed.some((j) => j.error?.code === 'offline');
    const unreadable = failed.length - retryable.length;
    const start = done ? `${done} added. ` : '';
    if (offline) text = `${start}No signal — ${failed.length} photo${failed.length === 1 ? ' is' : 's are'} waiting. We'll retry when you're back online.`;
    else if (unreadable === failed.length) text = `${start}${failed.length} file${failed.length === 1 ? '' : 's'} couldn't be read — try a different photo.`;
    else text = `${start}${failed.length} upload${failed.length === 1 ? '' : 's'} failed. ${retryable[0]?.error?.message || ''}`;
  }
  $('#upload-text').textContent = text;
  $('#upload-retry').hidden = active > 0 || retryable.length === 0;
  $('#upload-dismiss').hidden = active > 0 || failed.length === 0;
}

$('#btn-library').addEventListener('click', () => $('#input-library').click());
$('#btn-camera').addEventListener('click', () => $('#input-camera').click());
for (const id of ['#input-library', '#input-camera']) {
  $(id).addEventListener('change', (e) => {
    addFiles(e.target.files);
    e.target.value = ''; // lets the same photo be picked again
  });
}
$('#upload-retry').addEventListener('click', () => retryFailed());
$('#upload-dismiss').addEventListener('click', () => {
  uploads.jobs = uploads.jobs.filter((j) => j.status === 'waiting' || j.status === 'working');
  renderUploads();
});

window.addEventListener('beforeunload', (e) => {
  if (uploads.jobs.some((j) => j.status === 'waiting' || j.status === 'working')) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ---------- full-screen viewer with swipe ---------- */

const viewer = {
  open: false,
  view: 'favourites',
  index: 0,
  currentId: null,
  busy: false,
  pushedHistory: false,
  el: $('#viewer'),
  stage: $('#viewer-stage'),
  track: $('#viewer-track'),
};

const viewerPhotos = () => state.lists[viewer.view].photos;
const timeFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

function fillSlide(slide, photo) {
  const [ph, full] = slide.querySelectorAll('img');
  if (!photo) {
    slide.dataset.id = '';
    slide.classList.remove('ready');
    ph.removeAttribute('src');
    full.removeAttribute('src');
    return;
  }
  if (slide.dataset.id === String(photo.id)) return;
  slide.dataset.id = photo.id;
  slide.classList.remove('ready');
  ph.src = photo.thumb;
  full.alt = `Photo by ${photo.name}`;
  full.onload = () => { if (slide.dataset.id === String(photo.id)) slide.classList.add('ready'); };
  full.src = photo.full;
  if (full.complete && full.naturalWidth) slide.classList.add('ready');
}

function fillAll() {
  const photos = viewerPhotos();
  const [prev, current, next] = viewer.track.children;
  const i = viewer.index;
  fillSlide(prev, photos[i - 1]);
  fillSlide(current, photos[i]);
  fillSlide(next, photos[i + 1]);
  updateViewerInfo();
}

// After the list changes under the viewer (delete, un-star, more loaded), stay on the same photo if it's still there
function refreshViewer() {
  const photos = viewerPhotos();
  if (!photos.length) return closeViewer();
  const i = photos.findIndex((p) => p.id === viewer.currentId);
  viewer.index = i >= 0 ? i : Math.min(viewer.index, photos.length - 1);
  fillAll();
}

function updateViewerInfo() {
  const photos = viewerPhotos();
  const photo = photos[viewer.index];
  if (!photo) return;
  viewer.currentId = photo.id;
  const total = Math.max(state.lists[viewer.view].total ?? 0, photos.length);
  $('#viewer-count').textContent = `${viewer.view === 'favourites' ? '★ Favourites · ' : ''}${viewer.index + 1} / ${total}`;
  $('#viewer-name').textContent = `📸 ${photo.mine ? `${photo.name} (you)` : photo.name}`;
  $('#viewer-time').textContent = photo.at ? timeFormat.format(new Date(photo.at)) : '';
  if (useShareSheet) photoFile(photo).catch(() => {}); // get it ready so Save opens instantly
  const star = $('#viewer-star');
  star.hidden = !photo.mine;
  star.textContent = photo.favourite ? '★ Favourite' : '☆ Favourite';
  star.classList.toggle('on', photo.favourite);
  star.setAttribute('aria-pressed', String(photo.favourite));
  star.setAttribute('aria-label', starLabel(photo));
  $('#viewer-delete').hidden = !photo.mine;
  $('#viewer-prev').disabled = viewer.index === 0;
  $('#viewer-next').disabled = viewer.index >= photos.length - 1;
}

function openViewer(view, index) {
  viewer.view = view;
  viewer.index = index;
  viewer.open = true;
  viewer.el.hidden = false;
  viewer.el.classList.remove('chrome-hidden');
  document.body.classList.add('no-scroll');
  fillAll();
  history.pushState({ viewer: true }, '');
  viewer.pushedHistory = true;
}

function closeViewer({ fromHistory = false } = {}) {
  if (!viewer.open) return;
  viewer.open = false;
  viewer.el.hidden = true;
  document.body.classList.remove('no-scroll');
  if (viewer.pushedHistory && !fromHistory) history.back();
  viewer.pushedHistory = false;
  state.lists[viewer.view].tiles.get(viewer.currentId)?.scrollIntoView({ block: 'nearest' });
}

// The phone's back button closes the viewer instead of leaving the site
window.addEventListener('popstate', () => {
  if (viewer.open) {
    viewer.pushedHistory = false;
    closeViewer({ fromHistory: true });
  }
});

function snapBack() {
  viewer.track.style.transition = 'transform 0.22s ease-out';
  viewer.track.style.transform = '';
}

function go(delta) {
  if (viewer.busy) return;
  const photos = viewerPhotos();
  const target = viewer.index + delta;
  if (target < 0 || target >= photos.length) return snapBack();
  viewer.busy = true;
  viewer.track.style.transition = 'transform 0.25s ease-out';
  viewer.track.style.transform = `translate3d(${delta > 0 ? '-66.6667%' : '0%'}, 0, 0)`;
  setTimeout(() => {
    const track = viewer.track;
    viewer.index = target;
    // recycle the slide that just went off-screen for the next photo along
    if (delta > 0) track.append(track.firstElementChild);
    else track.prepend(track.lastElementChild);
    track.style.transition = 'none';
    track.style.transform = '';
    fillSlide(delta > 0 ? track.children[2] : track.children[0], viewerPhotos()[target + delta]);
    updateViewerInfo();
    viewer.busy = false;
    if (target >= viewerPhotos().length - 4) loadMore(viewer.view);
  }, 260);
}

let drag = null;

viewer.stage.addEventListener('pointerdown', (e) => {
  if (viewer.busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, axis: null, t: performance.now() };
});

viewer.stage.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag.dx = e.clientX - drag.x;
  drag.dy = e.clientY - drag.y;
  if (!drag.axis && Math.hypot(drag.dx, drag.dy) > 8) drag.axis = Math.abs(drag.dx) > Math.abs(drag.dy) ? 'x' : 'y';
  if (drag.axis === 'x') {
    const atEdge = (drag.dx > 0 && viewer.index === 0) || (drag.dx < 0 && viewer.index === viewerPhotos().length - 1);
    const dx = atEdge ? drag.dx / 3 : drag.dx;
    viewer.track.style.transition = 'none';
    viewer.track.style.transform = `translate3d(calc(-33.3333% + ${dx}px), 0, 0)`;
  } else if (drag.axis === 'y' && drag.dy > 0) {
    viewer.stage.style.transition = 'none';
    viewer.stage.style.transform = `translateY(${drag.dy}px)`;
    viewer.stage.style.opacity = String(Math.max(0.35, 1 - drag.dy / 500));
  }
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  if (!d.axis) {
    if (e.type === 'pointerup') viewer.el.classList.toggle('chrome-hidden'); // a tap shows/hides the buttons
    return;
  }
  if (d.axis === 'x') {
    const fast = Math.abs(d.dx) / (performance.now() - d.t) > 0.5;
    if (d.dx < -70 || (fast && d.dx < -20)) go(1);
    else if (d.dx > 70 || (fast && d.dx > 20)) go(-1);
    else snapBack();
  } else {
    viewer.stage.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
    viewer.stage.style.transform = '';
    viewer.stage.style.opacity = '';
    if (d.dy > 120) closeViewer(); // swipe down to close
  }
}

viewer.stage.addEventListener('pointerup', endDrag);
viewer.stage.addEventListener('pointercancel', endDrag);

$('#viewer-close').addEventListener('click', () => closeViewer());
$('#viewer-prev').addEventListener('click', () => go(-1));
$('#viewer-next').addEventListener('click', () => go(1));
$('#viewer-star').addEventListener('click', () => toggleFavourite(viewerPhotos()[viewer.index]));
$('#viewer-save').addEventListener('click', () => savePhoto(viewerPhotos()[viewer.index]));
$('#viewer-delete').addEventListener('click', () => deletePhoto(viewerPhotos()[viewer.index]));

document.addEventListener('keydown', (e) => {
  if (!viewer.open || !$('#modal').hidden) return;
  if (e.key === 'ArrowRight') go(1);
  else if (e.key === 'ArrowLeft') go(-1);
  else if (e.key === 'Escape') closeViewer();
});

/* ---------- saving a photo to the phone ---------- */

// iPhones save downloads to the Files app, so there we open the share sheet instead,
// where "Save Image" puts the photo in the camera roll. Android and computers download it
// (on Android it then shows up in the Gallery).
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const useShareSheet = isIOS && typeof navigator.canShare === 'function'
  && navigator.canShare({ files: [new File([''], 'test.jpg', { type: 'image/jpeg' })] });

function fileNameFor(photo) {
  const who = photo.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'guest';
  return `party-${who}-${photo.id}.jpg`;
}

const fileCache = new Map(); // photo id → Promise<File>, for the last few photos viewed
function photoFile(photo) {
  if (!fileCache.has(photo.id)) {
    const file = fetch(photo.full)
      .then((res) => { if (!res.ok) throw new Error('download failed'); return res.blob(); })
      .then((blob) => new File([blob], fileNameFor(photo), { type: 'image/jpeg' }));
    file.catch(() => fileCache.delete(photo.id));
    fileCache.set(photo.id, file);
    if (fileCache.size > 40) fileCache.delete(fileCache.keys().next().value);
  }
  return fileCache.get(photo.id);
}

async function savePhoto(photo) {
  if (!photo) return;
  if (useShareSheet) {
    let file;
    try {
      file = await photoFile(photo);
    } catch {
      return toast("Couldn't get the photo — check your signal and try again", 'error');
    }
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // closed the share sheet
      if (err.name === 'NotAllowedError') return toast('Tap Save again, then choose "Save Image"');
      // anything else: fall back to a normal download below
    }
  }
  downloadPhoto(photo);
  toast(isAndroid ? '⬇︎ Saving — it will appear in your Gallery' : '⬇︎ Downloading the photo');
}

const isAndroid = /Android/i.test(navigator.userAgent);

function downloadPhoto(photo) {
  const a = document.createElement('a');
  a.href = `${photo.full}&download=${encodeURIComponent(fileNameFor(photo))}`;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
}

/* ---------- picking several favourites to save at once ---------- */

const MAX_SAVE_AT_ONCE = 30; // keeps phones from running out of memory
const selection = { on: false, ids: new Set(), busy: false };

function setSelecting(on) {
  selection.on = on;
  selection.ids.clear();
  document.body.classList.toggle('selecting', on);
  renderGallery();
  if (on) toast('Tap the photos you want to save');
}

function toggleSelected(photo) {
  if (selection.busy) return;
  if (selection.ids.has(photo.id)) {
    selection.ids.delete(photo.id);
  } else {
    if (selection.ids.size >= MAX_SAVE_AT_ONCE) return toast(`You can save up to ${MAX_SAVE_AT_ONCE} at a time`, 'error');
    selection.ids.add(photo.id);
    if (useShareSheet) photoFile(photo).catch(() => {}); // start downloading so Save is quick
  }
  renderSelection();
}

function renderSelection() {
  const bar = $('#select-bar');
  bar.hidden = !selection.on;
  const tiles = state.lists.favourites.tiles;
  for (const id of selection.ids) if (!tiles.has(id)) selection.ids.delete(id); // deleted or un-starred meanwhile
  for (const [id, el] of tiles) el.classList.toggle('selected', selection.ids.has(id));
  if (!selection.on || selection.busy) return;
  const n = selection.ids.size;
  $('#select-count').textContent = n ? `${n} selected` : 'Tap photos';
  $('#select-save').disabled = n === 0;
  $('#select-save').textContent = n ? `⬇︎ Save ${n}` : '⬇︎ Save';
}

function selectAll() {
  const photos = state.lists.favourites.photos.slice(0, MAX_SAVE_AT_ONCE);
  const allChosen = photos.every((p) => selection.ids.has(p.id));
  selection.ids.clear();
  if (!allChosen) {
    for (const p of photos) {
      selection.ids.add(p.id);
      if (useShareSheet) photoFile(p).catch(() => {});
    }
    if (state.lists.favourites.photos.length > MAX_SAVE_AT_ONCE) toast(`Picked the newest ${MAX_SAVE_AT_ONCE} — you can save up to ${MAX_SAVE_AT_ONCE} at a time`);
  }
  renderSelection();
}

async function saveSelected() {
  const photos = state.lists.favourites.photos.filter((p) => selection.ids.has(p.id));
  if (!photos.length || selection.busy) return;
  const button = $('#select-save');

  if (useShareSheet) {
    // iPhone: one share sheet with every photo; "Save N Images" puts them in the camera roll
    selection.busy = true;
    button.disabled = true;
    let ready = 0;
    const pending = photos.map((p) => photoFile(p).then((file) => {
      ready++;
      button.textContent = `Getting ${ready}/${photos.length}…`;
      return file;
    }));
    let files;
    try {
      files = await Promise.all(pending);
    } catch {
      selection.busy = false;
      renderSelection();
      return toast("Couldn't get all the photos — check your signal and try again", 'error');
    }
    selection.busy = false;
    renderSelection();
    try {
      await navigator.share({ files });
      setSelecting(false);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // closed the share sheet; keep the selection
      // Downloading took a while, so iPhone wants a fresh tap before opening the share sheet
      if (err.name === 'NotAllowedError') return toast('Photos ready — tap Save again');
    }
  }

  // Android and computers: download them one after another
  selection.busy = true;
  button.disabled = true;
  for (let i = 0; i < photos.length; i++) {
    button.textContent = `Saving ${i + 1}/${photos.length}…`;
    downloadPhoto(photos[i]);
    if (i < photos.length - 1) await sleep(800);
  }
  selection.busy = false;
  toast(isAndroid ? `⬇︎ ${photos.length} photos saving — they'll appear in your Gallery` : `⬇︎ Downloading ${photos.length} photos`);
  setSelecting(false);
}

$('#btn-select').addEventListener('click', () => setSelecting(true));
$('#select-cancel').addEventListener('click', () => setSelecting(false));
$('#select-all').addEventListener('click', selectAll);
$('#select-save').addEventListener('click', saveSelected);

/* ---------- deleting your own photos ---------- */

async function deletePhoto(photo) {
  if (!photo || !photo.mine) return;
  const ok = await confirmDialog({
    title: 'Delete this photo?',
    text: photo.favourite ? 'It will also be removed from Favourites for everyone.' : 'It will be removed from the album.',
    ok: 'Delete',
  });
  if (!ok) return;
  try {
    await api('/api/delete', { method: 'POST', body: { id: photo.id } });
  } catch (err) {
    return handleError(err);
  }
  for (const list of Object.values(state.lists)) {
    const before = list.photos.length;
    list.photos = list.photos.filter((p) => p.id !== photo.id);
    if (list.photos.length < before && list.total) list.total--;
  }
  if (photo.favourite) state.myFavourites = Math.max(0, state.myFavourites - 1);
  renderGallery();
  toast('Photo deleted');
  if (viewer.open) refreshViewer();
}

/* ---------- little UI helpers ---------- */

let toastTimer;
function toast(text, kind = '') {
  const el = $('#toast');
  el.textContent = text;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = `toast ${kind}`; }, kind === 'error' ? 5000 : 3000);
}

function confirmDialog({ title, text, ok = 'OK' }) {
  const modal = $('#modal');
  $('#modal-title').textContent = title;
  $('#modal-text').textContent = text;
  $('#modal-ok').textContent = ok;
  modal.hidden = false;
  $('#modal-cancel').focus();
  return new Promise((resolve) => {
    const finish = (answer) => {
      modal.hidden = true;
      $('#modal-ok').onclick = $('#modal-cancel').onclick = modal.onclick = null;
      resolve(answer);
    };
    $('#modal-ok').onclick = () => finish(true);
    $('#modal-cancel').onclick = () => finish(false);
    modal.onclick = (e) => { if (e.target === modal) finish(false); };
  });
}

function updateNetBanner() {
  $('#net-banner').hidden = navigator.onLine !== false;
}

window.addEventListener('offline', updateNetBanner);
window.addEventListener('online', () => {
  updateNetBanner();
  retryFailed({ onlyOffline: true });
  refreshNewest();
});

updateNetBanner();
boot();
