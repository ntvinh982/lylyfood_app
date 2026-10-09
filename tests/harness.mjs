// Khung test giao diện: chạy web/app.js trong jsdom với một Supabase GIẢ lưu trong bộ nhớ.
// Dữ liệu `data` ở dạng "tài liệu" (camelCase) để assert cho dễ; harness tự đổi qua lại với dạng cột (snake_case) như DB thật.
// Edge Function staff-admin chạy bằng CHÍNH mã thật (handler.ts) trên dữ liệu giả này.
// (Luật quyền phía máy chủ được test riêng, trên Postgres thật, trong tests/rls.test.mjs.)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'esbuild';

const here = path.dirname(new URL(import.meta.url).pathname);
const WEB = path.join(here, '../web');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const pad = n => String(n).padStart(2, '0');
const t = new Date();
export const TODAY = t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());

await build({ entryPoints: [path.join(here, '../supabase/functions/staff-admin/handler.ts')], bundle: true, format: 'esm', platform: 'node', outfile: '/tmp/staff-admin-handler-web.mjs', logLevel: 'silent' });
const { handle } = await import(pathToFileURL('/tmp/staff-admin-handler-web.mjs').href);
await build({ entryPoints: [path.join(here, '../supabase/functions/parse-orders/handler.ts')], bundle: true, format: 'esm', platform: 'node', outfile: '/tmp/parse-orders-handler-web.mjs', logLevel: 'silent' });
const { handle: handleParse } = await import(pathToFileURL('/tmp/parse-orders-handler-web.mjs').href);
export const ai = { calls: [], reply: null, status: 200 };   // AI giả: ai.reply = {orders, ignored}

const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
export const appJs = () => fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');

/* ---------- dữ liệu dùng chung (được thay nội dung tại chỗ bằng resetData) ---------- */
export const data = {};
export const passwords = {};            // username -> mật khẩu
export const authExtra = {};            // id -> {banned}
export function resetData(seed) {
  for (const k of Object.keys(data)) delete data[k];
  for (const k of Object.keys(passwords)) delete passwords[k];
  Object.assign(data, JSON.parse(JSON.stringify(seed.data)));
  Object.assign(passwords, seed.passwords);
  for (const c of ['staff', 'menu', 'groups', 'customers', 'orders', 'settings', 'logs']) data[c] = data[c] || {};
}
export const mkStaff = (name, username, role, extra = {}) => Object.assign({ name, username, role, active: true, createdAt: 1 }, extra);

const COL = { profiles: 'staff', menu_items: 'menu', menu_groups: 'groups', customers: 'customers', orders: 'orders', settings: 'settings', ai_parse_log: 'logs' };
const camel = s => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const snake = s => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const TS = new Set(['created_at', 'updated_at']);
function docToRow(col, id, d) {
  if (col === 'settings') return { key: id, data: d };
  const r = { id };
  for (const [k, v] of Object.entries(d)) {
    const c = k === 'order' ? 'sort_order' : snake(k);
    r[c] = TS.has(c) ? new Date(v || 0).toISOString() : v;
  }
  if (col === 'orders') { r.shipper_id = r.shipper_id || null; r.customer_id = r.customer_id || null; }
  return r;
}
function rowToDoc(col, r) {
  if (col === 'settings') return r.data;
  const d = {};
  for (const [c, v] of Object.entries(r)) {
    if (c === 'id') continue;
    const k = c === 'sort_order' ? 'order' : camel(c);
    d[k] = TS.has(c) ? Date.parse(v) : v;
  }
  if (col === 'orders') { d.shipperId = d.shipperId || ''; d.customerId = d.customerId || ''; }
  return d;
}

/* ---------- Supabase giả ---------- */
const channels = [];            // dùng chung giữa mọi "máy" để mô phỏng realtime
export function makeFake(opts = {}) {
  const log = { calls: [] };
  let session = opts.sessionUser ? { user: { id: opts.sessionUser }, access_token: 'tok:' + opts.sessionUser } : null;
  const authCbs = [];
  const me = () => (session && data.staff[session.user.id]) || null;
  const notify = table => channels.forEach(ch => ch.subs.forEach(s => { if (s.table === table) setTimeout(() => s.cb({ eventType: '*' }), 0); }));
  const activeAdmins = (except) => Object.entries(data.staff).filter(([id, s]) => id !== except && s.role === 'admin' && s.active !== false).length;

  function from(table, asService = false) {
    const col = COL[table];
    const st = { op: 'select', filters: [], order: null, range: null, payload: null, ret: false };
    const rows = () => Object.entries(data[col]).map(([id, d]) => docToRow(col, id, d));
    const match = r => st.filters.every(([k, op, v]) => op === 'eq' ? r[k] === v : op === 'gte' ? r[k] >= v : r[k] <= v);
    const exec = async () => {
      log.calls.push(st.op + ':' + table);
      if (st.op === 'select') {
        let out = rows().filter(match);
        if (st.order) out.sort((a, b) => (a[st.order] < b[st.order] ? -1 : a[st.order] > b[st.order] ? 1 : 0));
        if (st.range) out = out.slice(st.range[0], st.range[1] + 1);
        return { data: out, error: null };
      }
      const user = me();
      if (st.op === 'insert') {
        const r = st.payload; const id = col === 'settings' ? r.key : (r.id || crypto.randomUUID());
        if (data[col][id]) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        if (col === 'staff' && Object.values(data.staff).some(s => s.username === r.username)) return { data: null, error: { code: '23505', message: 'duplicate username' } };
        const doc = rowToDoc(col, r); delete doc.id;
        if (col === 'orders') Object.assign(doc, { createdAt: Date.now(), updatedAt: Date.now(), createdBy: user ? user.name : '', createdById: user ? session.user.id : '', updatedBy: user ? user.name : '', sample: false });
        else if (!doc.createdAt) doc.createdAt = Date.now();
        data[col][id] = doc; notify(table);
        return { data: st.ret ? [{ id }] : null, error: null };
      }
      if (st.op === 'upsert') {
        const r = st.payload; data[col][r.key] = r.data; notify(table); return { data: null, error: null };
      }
      const hit = rows().filter(match);
      if (st.op === 'update') {
        for (const r of hit) {
          const before = data[col][r.id];
          const patch = rowToDoc(col, st.payload);
          if (col === 'staff') {
            const after = Object.assign({}, before, patch);
            if (before.role === 'admin' && before.active !== false && (after.role !== 'admin' || after.active === false) && activeAdmins(r.id) === 0)
              return { data: null, error: { code: '42501', message: 'Phải còn ít nhất 1 quản lý đang hoạt động.' } };
          }
          if (col === 'orders' && user) patch.updatedBy = user.name;
          data[col][r.id] = Object.assign({}, before, patch);
        }
        if (hit.length) notify(table);
        return { data: st.ret ? hit.map(r => ({ id: r.id })) : null, error: null };
      }
      if (st.op === 'delete') {
        for (const r of hit) {
          if (col === 'staff' && data.staff[r.id].role === 'admin' && data.staff[r.id].active !== false && activeAdmins(r.id) === 0)
            return { data: null, error: { code: '42501', message: 'Phải còn ít nhất 1 quản lý đang hoạt động.' } };
          delete data[col][r.id];
        }
        if (hit.length) notify(table);
        return { data: st.ret ? hit.map(r => ({ id: r.id })) : null, error: null };
      }
    };
    const b = {
      select() { if (st.op !== 'select') st.ret = true; return b; },
      eq(k, v) { st.filters.push([k, 'eq', v]); return b; }, gte(k, v) { st.filters.push([k, 'gte', v]); return b; }, lte(k, v) { st.filters.push([k, 'lte', v]); return b; },
      order(k) { st.order = k; return b; }, range(a, z) { st.range = [a, z]; return b; },
      insert(r) { st.op = 'insert'; st.payload = r; return b; }, update(r) { st.op = 'update'; st.payload = r; return b; },
      delete() { st.op = 'delete'; return b; }, upsert(r) { st.op = 'upsert'; st.payload = r; return b; },
      async maybeSingle() { const r = await exec(); return { data: (r.data && r.data[0]) || null, error: r.error }; },
      then(res, rej) { return exec().then(res, rej); },
    };
    return b;
  }

  // client quyền service role cho Edge Function (chạy mã thật handler.ts)
  const authUsers = {};
  const adminClient = {
    from: tb => from(tb, true),
    auth: {
      async getUser(tok) { const id = String(tok).startsWith('tok:') ? tok.slice(4) : null; return id && data.staff[id] ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }; },
      admin: {
        async createUser({ email, password }) {
          const un = email.split('@')[0];
          if (Object.values(data.staff).some(s => s.username === un) || Object.values(authUsers).some(u => u.email === email)) return { data: null, error: { message: 'A user with this email address has already been registered' } };
          const id = crypto.randomUUID(); authUsers[id] = { email, password }; passwords[un] = password; return { data: { user: { id } }, error: null };
        },
        async deleteUser(id) {
          const s = data.staff[id];
          if (s && s.role === 'admin' && s.active !== false && activeAdmins(id) === 0) return { error: { message: 'Phải còn ít nhất 1 quản lý đang hoạt động.' } };
          if (s) { delete passwords[s.username]; delete data.staff[id]; notify('profiles'); } delete authUsers[id]; return { error: null };
        },
        async updateUserById(id, p) {
          const s = data.staff[id];
          if (p.password && s) passwords[s.username] = p.password;
          if (p.email && s) { const nu = p.email.split('@')[0]; if (s.username !== nu) { /* hồ sơ đã được cập nhật trước */ passwords[nu] = passwords[s.username] ?? passwords[nu]; } }
          if (p.ban_duration) authExtra[id] = { banned: p.ban_duration !== 'none' };
          return { error: null };
        },
      },
    },
  };
  const deps = { env: { url: 'x', serviceKey: 'x', emailDomain: 'lylyfood.app' }, makeAdminClient: () => adminClient };
  const parseDeps = { env: { anthropicKey: 'sk-test', model: 'm' }, makeAdminClient: () => adminClient,
    fetchFn: async (u, init) => { ai.calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_orders', input: ai.reply }] }), { status: ai.status }); } };

  const client = {
    from: tb => from(tb),
    channel() { const ch = { subs: [], on(_t, o, cb) { ch.subs.push({ table: o.table, cb }); return ch; }, subscribe(cb) { channels.push(ch); setTimeout(() => cb && cb('SUBSCRIBED'), 0); return ch; } }; return ch; },
    removeChannel(ch) { const i = channels.indexOf(ch); if (i >= 0) channels.splice(i, 1); },
    auth: {
      async signInWithPassword({ email, password }) {
        const un = email.split('@')[0];
        const entry = Object.entries(data.staff).find(([, s]) => s.username === un);
        if (!entry || passwords[un] !== password) return { data: { user: null, session: null }, error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 } };
        if (entry[1].active === false || (authExtra[entry[0]] && authExtra[entry[0]].banned)) return { data: { user: null, session: null }, error: { message: 'User is banned', code: 'user_banned', status: 400 } };
        session = { user: { id: entry[0] }, access_token: 'tok:' + entry[0] };
        return { data: { user: session.user, session }, error: null };
      },
      async getSession() { return { data: { session }, error: null }; },
      async signOut() { session = null; authCbs.forEach(cb => cb('SIGNED_OUT', null)); return { error: null }; },
      onAuthStateChange(cb) { authCbs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async updateUser({ password }) {
        const u = me(); if (!u) return { data: null, error: { message: 'no session' } };
        if (passwords[u.username] === password) return { data: null, error: { code: 'same_password', message: 'New password should be different' } };
        passwords[u.username] = password; return { data: { user: session.user }, error: null };
      },
    },
    functions: {
      async invoke(name, { body }) {
        const h = name === 'parse-orders' ? handleParse : handle;
        const res = await h(new Request('https://f.test/' + name, { method: 'POST', headers: { Authorization: 'Bearer ' + (session ? session.access_token : ''), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), name === 'parse-orders' ? parseDeps : deps);
        if (res.status >= 400) return { data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: res } };
        return { data: await res.json(), error: null };
      },
    },
  };
  client.__log = log; client.__notify = notify;
  return client;
}

/* ---------- mở app trong jsdom ---------- */
export async function openApp(opts = {}) {
  const fake = makeFake(opts);
  const src = html
    .replace('<script src="vendor/supabase.js"></script>', '')
    .replace('<script src="config.js"></script>', '')
    .replace('<script src="app.js"></script>', () => '<script>' + (opts.appJs || appJs()) + '</script>');
  const vc = new VirtualConsole(); vc.sendTo(console, { omitJSDOMErrors: true });
  vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) console.error(e); });
  const dom = new JSDOM(src, {
    virtualConsole: vc, runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/',
    beforeParse(w) {
      Object.defineProperty(w, 'crypto', { value: crypto.webcrypto, configurable: true });
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
      if (opts.XLSX) w.XLSX = opts.XLSX;
      if (opts.config !== null) w.LYLY_CONFIG = { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'anon-test-key', emailDomain: 'lylyfood.app' };
      if (opts.config !== null) w.supabase = { createClient: () => fake };
      w.HTMLElement.prototype.showPicker = () => {}; w.scrollTo = () => {};
      w.__saved = [];
      w.URL.createObjectURL = b => { w.__saved.push(b); return 'blob:x'; }; w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () { w.__lastDownload = this.download; };
    },
  });
  await sleep(150);
  return { w: dom.window, d: dom.window.document, fake };
}
export async function loginAs(w, d, user, pw, wait = 400) {
  d.getElementById('l_user').value = user; d.getElementById('l_pw').value = pw;
  d.getElementById('loginForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(wait);
}
export async function session(user, pw, opts = {}) { const r = await openApp(opts); await loginAs(r.w, r.d, user, pw); return r; }
export const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
export const q = (d, s) => [...d.querySelectorAll(s)];
export const nav = (w, d, v) => click(w, d.querySelector('[data-act=nav][data-v=' + v + ']'));
export const tabs = d => q(d, '.bnav button').map(b => b.textContent.trim()).join(',');
export const fake = (w, d, a, extra = {}) => { const b = d.createElement('button'); b.dataset.act = a; Object.assign(b.dataset, extra); d.body.appendChild(b); click(w, b); b.remove(); };
let fails = 0;
export const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
export const failCount = () => fails;
export const finish = () => { console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED'); process.exit(fails ? 1 : 0); };
