/**
 * core.js: fondasi SPA. Klien API, sesi OAuth2 (Authorization Code + PKCE), router, dan utilitas tampilan.
 * Access token hanya disimpan di memori. Refresh token ada di cookie HttpOnly yang tidak bisa dibaca JavaScript.
 */
export const CLIENT_ID = 'rangkai-web';
const REDIRECT_URI = `${location.origin}/auth/callback`;

/* ---------- Utilitas ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const rupiah = (n) => `Rp${Number(n || 0).toLocaleString('id-ID')}`;
const fmt = (opts) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', ...opts });
export const timeOf = (v) => fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v)).replace('.', ':');
export const dateLong = (v) => fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(v));
export const dateShort = (v) => fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(v));
export const duration = (min) => `${Math.floor(min / 60)}j ${String(min % 60).padStart(2, '0')}m`;
export const wibToday = (plus = 0) => new Date(Date.now() + 7 * 3600000 + plus * 86400000).toISOString().slice(0, 10);
export const uuid = () => crypto.randomUUID();

export function toast(message, kind = 'info') {
  const box = $('#toasts');
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = message;
  box.append(t);
  setTimeout(() => t.classList.add('out'), 4200);
  setTimeout(() => t.remove(), 4700);
}

/** Dialog konfirmasi yang bisa dioperasikan papan ketik. Mengembalikan true bila dikonfirmasi. */
export function confirmDialog({ title, body, confirm = 'Ya, lanjutkan', cancel = 'Tidak jadi', danger = false }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dlg';
    d.innerHTML = `<h2>${esc(title)}</h2><div class="dlg-body">${body}</div>
      <div class="dlg-act"><button class="btn ghost" value="no">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'pri'}" value="yes">${esc(confirm)}</button></div>`;
    document.body.append(d);
    d.addEventListener('click', (e) => {
      const v = e.target.closest('button')?.value;
      if (v) { d.close(); resolve(v === 'yes'); }
    });
    d.addEventListener('cancel', () => resolve(false));
    d.addEventListener('close', () => setTimeout(() => d.remove(), 200));
    d.showModal();
    $('.btn.ghost', d).focus();
  });
}

/* ---------- Sesi ---------- */
const session = { token: null, exp: 0, user: null, listeners: new Set(), restored: null };

const decode = (jwt) => JSON.parse(decodeURIComponent(escape(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))));

function setToken(token) {
  session.token = token;
  if (token) {
    const c = decode(token);
    session.exp = c.exp * 1000;
    session.user = { id: c.sub, name: c.name, role: c.role, scope: String(c.scope || '').split(' ') };
  } else {
    session.exp = 0;
    session.user = null;
  }
  session.listeners.forEach((fn) => fn(session.user));
}

export const currentUser = () => session.user;
export const hasScope = (s) => Boolean(session.user?.scope.includes(s));
export const onSession = (fn) => { session.listeners.add(fn); return () => session.listeners.delete(fn); };

let refreshing = null;
async function refresh() {
  refreshing ||= fetch('/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, credentials: 'same-origin',
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID }),
  }).then(async (r) => {
    if (!r.ok) { setToken(null); return false; }
    setToken((await r.json()).access_token);
    return true;
  }).catch(() => false).finally(() => { refreshing = null; });
  return refreshing;
}

/** Memulihkan sesi saat halaman dimuat, lewat cookie refresh token. */
export function restoreSession() {
  // Penanda ini bukan kredensial: hanya mencegah panggilan refresh yang pasti gagal bagi tamu.
  let known = false;
  try { known = localStorage.getItem('rk:session') === '1'; } catch { /* mode privat */ }
  session.restored ||= known ? refresh() : Promise.resolve(false);
  return session.restored;
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Tahap 1 PKCE: membuat verifier dan meminta auth_request. Verifier tidak pernah dikirim sampai tahap penukaran token. */
export async function beginLogin() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const q = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, code_challenge: challenge, code_challenge_method: 'S256', state });
  const r = await fetch(`/oauth/authorize?${q}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new ApiError(r.status, 'AUTHORIZE_FAILED', 'Sesi masuk tidak bisa dimulai. Coba muat ulang halaman.');
  const j = await r.json();
  return { verifier, state, authRequest: j.auth_request };
}

/** Tahap 2: kredensial ditukar kode, kode + verifier ditukar token. */
export async function completeLogin(flow, email, password) {
  const res = await api('/oauth/login', { method: 'POST', body: { auth_request: flow.authRequest, email, password }, noAuth: true });
  if (res.state !== flow.state) throw new ApiError(400, 'STATE_MISMATCH', 'Respons masuk tidak cocok. Coba lagi.');
  const r = await fetch('/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, credentials: 'same-origin',
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID, code: res.code, code_verifier: flow.verifier, redirect_uri: REDIRECT_URI }),
  });
  if (!r.ok) throw new ApiError(r.status, 'TOKEN_FAILED', 'Gagal menyelesaikan proses masuk.');
  setToken((await r.json()).access_token);
  session.restored = Promise.resolve(true);
  try { localStorage.setItem('rk:session', '1'); } catch { /* mode privat */ }
  return session.user;
}

export async function logout() {
  await fetch('/oauth/revoke', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, credentials: 'same-origin',
    body: new URLSearchParams({ client_id: CLIENT_ID }),
  }).catch(() => {});
  try { localStorage.removeItem('rk:session'); } catch { /* mode privat */ }
  setToken(null);
}

/* ---------- Klien API ---------- */
export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

export async function api(path, { method = 'GET', body, idem, noAuth = false, retried = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (idem) headers['idempotency-key'] = idem;
  if (!noAuth) {
    if (session.token && session.exp - Date.now() < 15000) await refresh();
    if (session.token) headers.authorization = `Bearer ${session.token}`;
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Koneksi terputus. Periksa jaringan Anda lalu coba lagi.');
  }
  if (res.status === 401 && !noAuth && !retried && (await refresh())) return api(path, { method, body, idem, retried: true });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* bukan JSON */ }
  if (!res.ok) {
    const e = json?.error || {};
    throw new ApiError(res.status, e.code || 'ERROR', e.message || 'Terjadi kesalahan. Coba lagi sebentar.', e.details);
  }
  return json;
}

export async function gql(query, variables) {
  const j = await api('/graphql', { method: 'POST', body: { query, variables } });
  if (j.errors?.length) {
    const e = j.errors[0];
    throw new ApiError(e.extensions?.status || 400, e.extensions?.code || 'GRAPHQL_ERROR', e.message, e.extensions?.details);
  }
  return j.data;
}

/* ---------- Penanda penerbangan pesanan: dipakai lintas halaman ---------- */
export const flow = {
  get: (k) => { try { return JSON.parse(sessionStorage.getItem(`rk:${k}`)); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(`rk:${k}`, JSON.stringify(v)); } catch { /* mode privat */ } },
  del: (k) => { try { sessionStorage.removeItem(`rk:${k}`); } catch { /* mode privat */ } },
};

/* ---------- Router ---------- */
const routes = [];
let cleanup = null;
export const route = (pattern, loader, opts = {}) => {
  const keys = [];
  const rx = new RegExp(`^${pattern.replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; })}$`);
  routes.push({ rx, keys, loader, opts });
};

export function go(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path);
  return render();
}

let renderCount = 0;
export async function render() {
  const id = ++renderCount;
  const url = new URL(location.href);
  const r = routes.find((x) => x.rx.test(url.pathname)) || routes.find((x) => x.opts.notFound);
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(url.pathname.match(r.rx)[i + 1])]));
  if (r.opts.auth) {
    await restoreSession();
    if (!session.user) return go(`/masuk?next=${encodeURIComponent(url.pathname + url.search)}`, { replace: true });
    if (r.opts.scope && !hasScope(r.opts.scope)) { toast('Halaman ini tidak tersedia untuk akun Anda.', 'warn'); return go('/', { replace: true }); }
  }
  const page = await r.loader();
  if (id !== renderCount) return undefined;
  const main = $('#main');
  const swap = () => {
    if (typeof cleanup === 'function') cleanup();
    cleanup = null;
    document.body.dataset.page = r.opts.name || 'page';
    main.innerHTML = '';
    main.scrollTop = 0;
    window.scrollTo(0, 0);
    cleanup = page.render(main, { params, query: url.searchParams, url });
    document.dispatchEvent(new CustomEvent('rk:route', { detail: { name: r.opts.name, path: url.pathname } }));
  };
  if (document.startViewTransition && !reduceMotion() && main.childElementCount) document.startViewTransition(swap);
  else swap();
  if (id > 1) main.focus({ preventScroll: true });
  return undefined;
}

export function startRouter() {
  addEventListener('popstate', render);
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    go(a.getAttribute('href'));
  });
  return render();
}
