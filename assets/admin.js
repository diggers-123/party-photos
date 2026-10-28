'use strict';

/* =========================================================================
   Party photo album — host dashboard
   ========================================================================= */

const ZIP_PART_SIZE = 250;
const ZIP_PARALLEL = 6;
const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

const $ = (sel, root = document) => root.querySelector(sel);

const session = {
  get() { try { return sessionStorage.getItem('party.admin') || ''; } catch { return ''; } },
  set(v) { try { sessionStorage.setItem('party.admin', v); } catch {} },
  clear() { try { sessionStorage.removeItem('party.admin'); } catch {} },
};

const admin = {
  password: session.get(),
  party: null,
  total: 0,
  photos: [],
  next: null,
  selected: new Set(),
  link: '',
};

async function call(action, extra = {}) {
  let res;
  try {
    res = await fetch('/api/admin', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-admin-password': admin.password },
      body: JSON.stringify({ action, ...extra }),
    });
  } catch {
    throw Object.assign(new Error('No internet connection. Check your signal and try again.'), { code: 'offline' });
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (data.error === 'bad_password') logout();
    throw Object.assign(new Error(data.message || 'Something went wrong on the server.'), { code: data.error });
  }
  return data;
}

/* ---------- login ---------- */

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  admin.password = $('#password-input').value;
  $('#login-button').disabled = true;
  $('#login-error').textContent = '';
  try {
    await start();
    session.set(admin.password);
  } catch (err) {
    $('#login-error').textContent = err.message;
  } finally {
    $('#login-button').disabled = false;
  }
});

function logout() {
  admin.password = '';
  session.clear();
  $('#dashboard').hidden = true;
  $('#login-screen').hidden = false;
}

$('#logout').addEventListener('click', logout);

async function start() {
  const summary = await call('summary');
  admin.party = summary.party;
  admin.total = summary.total;
  admin.favourites = summary.favourites;
  for (const el of document.querySelectorAll('[data-party]')) el.textContent = admin.party[el.dataset.party] || '';
  $('#login-screen').hidden = true;
  $('#dashboard').hidden = false;
  renderStats();
  loadPhotos(true);
  loadQr();
}

/* ---------- stats & zip download ---------- */

function renderStats() {
  $('#stat-total').textContent = admin.total;
  $('#stat-favourites').textContent = `★ ${admin.favourites} picked as favourites (everyone can see these)`;
  const box = $('#zip-buttons');
  box.replaceChildren();
  const parts = Math.ceil(admin.total / ZIP_PART_SIZE);
  if (!parts) {
    box.innerHTML = '<span class="small">No photos to download yet.</span>';
    return;
  }
  for (let i = 0; i < parts; i++) {
    const from = i * ZIP_PART_SIZE + 1;
    const to = Math.min(admin.total, (i + 1) * ZIP_PART_SIZE);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = i === 0 ? 'btn btn-primary btn-small' : 'btn btn-small';
    btn.textContent = parts === 1 ? '⬇︎ Download all (.zip)' : `⬇︎ Part ${i + 1} (photos ${from}–${to})`;
    btn.addEventListener('click', () => downloadZip(i, parts, btn));
    box.append(btn);
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't load the zip tool. Check your internet connection."));
    document.head.append(s);
  });
}

function fileNameFor(item) {
  const d = new Date(item.at);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const who = item.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'guest';
  return `${stamp}_${who}_${item.id}.jpg`;
}

let zipping = false;
async function downloadZip(part, parts, button) {
  if (zipping) return;
  zipping = true;
  const status = $('#zip-status');
  status.classList.remove('error');
  for (const b of document.querySelectorAll('#zip-buttons button')) b.disabled = true;
  try {
    if (!window.JSZip) await loadScript(JSZIP_URL);
    status.textContent = 'Getting the list of photos…';
    const items = [];
    const start = part * ZIP_PART_SIZE;
    while (items.length < ZIP_PART_SIZE) {
      const { items: batch } = await call('export', { offset: start + items.length, limit: Math.min(200, ZIP_PART_SIZE - items.length) });
      items.push(...batch);
      if (batch.length < 200) break;
    }
    if (!items.length) throw new Error('No photos to download.');

    const zip = new JSZip();
    const failed = [];
    let done = 0;
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const item = items[next++];
        let blob = null;
        for (let attempt = 0; attempt < 3 && !blob; attempt++) {
          try {
            const res = await fetch(item.url);
            if (res.ok) blob = await res.blob();
          } catch {}
        }
        if (blob) zip.file(fileNameFor(item), blob, { binary: true });
        else failed.push(item);
        done++;
        status.textContent = `Downloading photos… ${done} of ${items.length}`;
      }
    }
    await Promise.all(Array.from({ length: ZIP_PARALLEL }, worker));

    status.textContent = 'Packing the zip file…';
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = parts === 1 ? 'party-photos.zip' : `party-photos-part-${part + 1}-of-${parts}.zip`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    status.textContent = failed.length
      ? `Saved ${items.length - failed.length} photos. ${failed.length} couldn't be downloaded — try this part again.`
      : `✓ Saved ${items.length} photos to ${a.download}`;
    if (failed.length) status.classList.add('error');
    button.textContent = `✓ ${button.textContent.replace(/^✓ /, '')}`;
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('error');
  } finally {
    zipping = false;
    for (const b of document.querySelectorAll('#zip-buttons button')) b.disabled = false;
  }
}

/* ---------- QR poster ---------- */

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2; // the white card adds more space around it
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet},${r + quiet}h1v1h-1z`;
  }
  const size = n + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#0a1721"/></svg>`;
}

// The poster's mirror ball, drawn as vector shapes so it prints crisply
// (the CSS-gradient ball used on screen bands and glitches on printers).
let ballCount = 0;
function discoBallSvg() {
  // each copy needs its own ids: the hidden preview's copy would otherwise be used when printing
  const id = `ball${++ballCount}`;
  let seed = 7; // fixed, so the preview and the print look identical
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cx = 50, cy = 79, r = 47;
  const rows = 14, cols = 16;
  const light = [-0.45, -0.6, 0.66]; // from the top left, towards the viewer
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const dark = [30, 58, 78], bright = [236, 246, 251], coral = [255, 183, 168];
  const rad = (d) => (d * Math.PI) / 180;
  const point = (lat, lon) => [cx + r * Math.cos(rad(lat)) * Math.sin(rad(lon)), cy - r * Math.sin(rad(lat))];
  let tiles = '';
  for (let i = 0; i < rows; i++) {
    const lat0 = -90 + (180 / rows) * i;
    const lat1 = lat0 + 180 / rows;
    for (let j = 0; j < cols; j++) {
      const lon0 = -90 + (180 / cols) * j;
      const lon1 = lon0 + 180 / cols;
      const corners = [point(lat0, lon0), point(lat0, lon1), point(lat1, lon1), point(lat1, lon0)];
      // how much this tile faces the light
      const latM = rad((lat0 + lat1) / 2), lonM = rad((lon0 + lon1) / 2);
      const n = [Math.cos(latM) * Math.sin(lonM), -Math.sin(latM), Math.cos(latM) * Math.cos(lonM)];
      const lit = Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
      const roll = rand();
      let rgb;
      if (roll < 0.03) rgb = coral;
      else if (roll < 0.09) rgb = [255, 255, 255];
      else rgb = mix(dark, bright, Math.min(1, Math.max(0, 0.15 + 0.85 * lit + (rand() - 0.5) * 0.35)));
      tiles += `<polygon points="${corners.map((c) => c.map((v) => v.toFixed(2)).join(',')).join(' ')}" fill="rgb(${rgb})"/>`;
    }
  }
  const star = (x, y, s) => `<path d="M${x},${y - s} L${x + s * 0.18},${y - s * 0.18} L${x + s},${y} L${x + s * 0.18},${y + s * 0.18} L${x},${y + s} L${x - s * 0.18},${y + s * 0.18} L${x - s},${y} L${x - s * 0.18},${y - s * 0.18} Z" fill="#fff"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 128" role="img" aria-label="Mirror ball">
    <defs>
      <radialGradient id="${id}-shade" cx="0.35" cy="0.3" r="0.75">
        <stop offset="0" stop-color="#fff" stop-opacity="0.35"/>
        <stop offset="0.55" stop-color="#fff" stop-opacity="0"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.45"/>
      </radialGradient>
      <clipPath id="${id}-clip"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
    </defs>
    <line x1="50" y1="0" x2="50" y2="${cy - r}" stroke="#9fb6c4" stroke-width="0.8"/>
    <g clip-path="url(#${id}-clip)" stroke="#0c1a25" stroke-width="0.45" stroke-linejoin="round">${tiles}</g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-shade)"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#0c1a25" stroke-width="0.8"/>
    ${star(70, 52, 9)}${star(32, 98, 4)}
  </svg>`;
}

function buildPoster() {
  const poster = $('#poster-template').content.firstElementChild.cloneNode(true);
  const paper = document.querySelector('input[name="paper"]:checked').value;
  poster.classList.toggle('a5', paper === 'a5');
  poster.classList.toggle('ink-saver', $('#ink-saver').checked);
  for (const el of poster.querySelectorAll('[data-party]')) el.textContent = admin.party?.[el.dataset.party] || '';
  poster.querySelector('.poster-ball').innerHTML = discoBallSvg();
  poster.querySelector('.poster-qr').innerHTML = admin.link ? qrSvg(admin.link) : '';
  poster.querySelector('.poster-host').textContent = location.host;
  return { poster, paper };
}

function renderPosterPreview() {
  const box = $('#poster-preview');
  const { poster, paper } = buildPoster();
  box.replaceChildren(poster);
  box.style.aspectRatio = paper === 'a5' ? '148 / 210' : '210 / 297';
  requestAnimationFrame(() => {
    poster.style.transform = `scale(${box.clientWidth / poster.offsetWidth})`;
  });
}

function loadQr() {
  // The link uses whatever address this page is open on, so open the admin page on your real site address
  admin.link = `${location.origin}/`;
  $('#secret-link').textContent = admin.link;
  renderPosterPreview();
}

for (const input of document.querySelectorAll('input[name="paper"], #ink-saver')) input.addEventListener('change', renderPosterPreview);
window.addEventListener('resize', () => { if (admin.link) renderPosterPreview(); });

$('#print-poster').addEventListener('click', async () => {
  if (!admin.link) return toast('The QR code is still loading', 'error');
  const { poster, paper } = buildPoster();
  $('#print-root').replaceChildren(poster);
  let pageStyle = $('#page-size');
  if (!pageStyle) {
    pageStyle = document.createElement('style');
    pageStyle.id = 'page-size';
    document.head.append(pageStyle);
  }
  pageStyle.textContent = `@page { size: ${paper === 'a5' ? 'A5' : 'A4'} portrait; margin: 0; }`;
  await document.fonts.ready;
  window.print();
});

$('#copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(admin.link);
    toast('Link copied');
  } catch {
    toast("Couldn't copy — select the link and copy it by hand", 'error');
  }
});

/* ---------- photo grid ---------- */

async function loadPhotos(reset = false) {
  const more = $('#admin-more');
  more.disabled = true;
  try {
    const favourites = $('#only-favourites').checked;
    const data = await call('list', reset ? { favourites } : { before: admin.next, favourites });
    if (reset) {
      admin.photos = [];
      admin.selected.clear();
      $('#admin-grid').replaceChildren();
    }
    admin.photos.push(...data.photos);
    admin.next = data.next;
    for (const photo of data.photos) $('#admin-grid').append(adminTile(photo));
    if (!admin.photos.length) $('#admin-grid').innerHTML = '<p class="small">No photos yet.</p>';
    more.hidden = !admin.next;
    updateSelection();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    more.disabled = false;
  }
}

const timeFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

function adminTile(photo) {
  const el = document.createElement('div');
  el.className = 'admin-tile';
  el.dataset.id = photo.id;
  el.tabIndex = 0;
  el.setAttribute('role', 'checkbox');
  el.setAttribute('aria-checked', 'false');
  el.innerHTML = '<img alt="" loading="lazy"><span class="tick" aria-hidden="true"></span><a class="open" target="_blank" rel="noopener" aria-label="Open full size">⤢</a><span class="meta"></span>';
  el.querySelector('img').src = photo.thumb;
  el.querySelector('.open').href = photo.full;
  el.querySelector('.meta').textContent = `${photo.favourite ? '★ ' : ''}${photo.name} · ${timeFormat.format(new Date(photo.at))}`;
  el.classList.toggle('favourite', photo.favourite);
  return el;
}

function toggleTile(el) {
  const id = Number(el.dataset.id);
  if (admin.selected.has(id)) admin.selected.delete(id);
  else admin.selected.add(id);
  updateSelection();
}

$('#admin-grid').addEventListener('click', (e) => {
  if (e.target.closest('.open')) return;
  const el = e.target.closest('.admin-tile');
  if (el) toggleTile(el);
});

$('#admin-grid').addEventListener('keydown', (e) => {
  const el = e.target.closest('.admin-tile');
  if (el && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); toggleTile(el); }
});

function updateSelection() {
  for (const el of document.querySelectorAll('.admin-tile')) {
    const on = admin.selected.has(Number(el.dataset.id));
    el.classList.toggle('selected', on);
    el.setAttribute('aria-checked', String(on));
  }
  const n = admin.selected.size;
  $('#selected-count').textContent = n ? `${n} selected` : '';
  $('#delete-selected').disabled = !n;
  $('#clear-selection').hidden = !n;
}

$('#clear-selection').addEventListener('click', () => { admin.selected.clear(); updateSelection(); });

$('#delete-selected').addEventListener('click', async () => {
  const ids = [...admin.selected];
  const ok = await confirmDialog({
    title: `Delete ${ids.length} photo${ids.length === 1 ? '' : 's'}?`,
    text: 'They will be removed for everyone. This cannot be undone.',
    ok: 'Delete',
  });
  if (!ok) return;
  try {
    let deleted = 0;
    for (let i = 0; i < ids.length; i += 200) deleted += (await call('delete', { ids: ids.slice(i, i + 200) })).deleted;
    for (const id of ids) document.querySelector(`.admin-tile[data-id="${id}"]`)?.remove();
    admin.photos = admin.photos.filter((p) => !admin.selected.has(p.id));
    admin.selected.clear();
    admin.total = Math.max(0, admin.total - deleted);
    renderStats();
    updateSelection();
    toast(`Deleted ${deleted} photo${deleted === 1 ? '' : 's'}`);
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#admin-more').addEventListener('click', () => loadPhotos(false));
$('#only-favourites').addEventListener('change', () => loadPhotos(true));

$('#admin-refresh').addEventListener('click', async () => {
  try {
    const summary = await call('summary');
    admin.total = summary.total;
    admin.favourites = summary.favourites;
    renderStats();
    loadPhotos(true);
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ---------- helpers ---------- */

let toastTimer;
function toast(text, kind = '') {
  const el = $('#toast');
  el.textContent = text;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = `toast ${kind}`; }, 4000);
}

function confirmDialog({ title, text, ok = 'OK' }) {
  const modal = $('#modal');
  $('#modal-title').textContent = title;
  $('#modal-text').textContent = text;
  $('#modal-ok').textContent = ok;
  modal.hidden = false;
  return new Promise((resolve) => {
    const finish = (answer) => {
      modal.hidden = true;
      $('#modal-ok').onclick = $('#modal-cancel').onclick = null;
      resolve(answer);
    };
    $('#modal-ok').onclick = () => finish(true);
    $('#modal-cancel').onclick = () => finish(false);
  });
}

// Stay logged in for this browser tab
if (admin.password) start().catch(() => logout());
