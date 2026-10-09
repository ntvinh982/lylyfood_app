// Test Edge Function staff-admin với Postgres thật (client Supabase giả chạy SQL thật). Chạy: node tests/staff-admin.test.mjs
import pg from 'pg';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
await build({ entryPoints: [path.join(here, '../supabase/functions/staff-admin/handler.ts')], bundle: true, format: 'esm', platform: 'node', outfile: '/tmp/staff-admin-handler.mjs', logLevel: 'silent' });
const { handle } = await import(pathToFileURL('/tmp/staff-admin-handler.mjs').href + '?t=' + Date.now());

const db = new pg.Client({ host: '/var/run/postgresql', database: process.env.PGDATABASE || 'lyly_test', user: 'root' });
await db.connect();
let fails = 0, n = 0; const ok = (c, m) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// --- client Supabase giả tối thiểu, chạy SQL thật ---
const tokens = {};
function table(name) {
  const q = { op: 'select', cols: '*', where: [], payload: null };
  const run = async () => {
    try {
      let sql, params = [];
      const wh = () => q.where.length ? ' where ' + q.where.map(([k, v], i) => { params.push(v); return `${k}=$${params.length}`; }).join(' and ') : '';
      if (q.op === 'select') sql = `select ${q.cols} from public.${name}${wh()}`;
      else if (q.op === 'insert') { const ks = Object.keys(q.payload); params = ks.map(k => typeof q.payload[k] === 'object' ? JSON.stringify(q.payload[k]) : q.payload[k]); sql = `insert into public.${name}(${ks.join(',')}) values (${ks.map((_, i) => '$' + (i + 1)).join(',')})`; }
      else { const ks = Object.keys(q.payload); params = ks.map(k => typeof q.payload[k] === 'object' ? JSON.stringify(q.payload[k]) : q.payload[k]); const set = ks.map((k, i) => `${k}=$${i + 1}`).join(','); sql = `update public.${name} set ${set}${wh()}`; }
      const r = await db.query(sql, params);
      return { data: q.op === 'select' ? r.rows : null, error: null };
    } catch (e) { return { data: null, error: { message: e.message, code: e.code } }; }
  };
  const b = {
    select(c) { q.cols = c; return b; }, eq(k, v) { q.where.push([k, v]); return b; },
    insert(p) { q.op = 'insert'; q.payload = p; return run(); }, update(p) { q.op = 'update'; q.payload = p; return b; },
    async maybeSingle() { const r = await run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    then(res, rej) { return run().then(res, rej); },
  };
  return b;
}
const adminClient = {
  from: table,
  auth: {
    async getUser(t) { const id = tokens[t]; return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }; },
    admin: {
      async createUser({ email, password }) {
        try { const r = await db.query('insert into auth.users(email) values ($1) returning id', [email]); return { data: { user: { id: r.rows[0].id, password } }, error: null }; }
        catch (e) { return { data: null, error: { message: 'A user with this email address has already been registered' } }; }
      },
      async deleteUser(id) { try { await db.query('delete from auth.users where id=$1', [id]); return { error: null }; } catch (e) { return { error: { message: e.message } }; } },
      async updateUserById(id, p) { if (p.email) await db.query('update auth.users set email=$2 where id=$1', [id, p.email]); if (p.ban_duration) await db.query('update auth.users set banned_until=$2 where id=$1', [id, p.ban_duration === 'none' ? null : new Date(Date.now() + 1e12)]); return { error: null }; },
    },
  },
};
const deps = { env: { url: 'x', serviceKey: 'x', emailDomain: 'lylyfood.app' }, makeAdminClient: () => adminClient };
const call = async (tok, body, method = 'POST') => {
  const r = await handle(new Request('https://f.test/staff-admin', { method, headers: { Authorization: tok ? 'Bearer ' + tok : '', 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined }), deps);
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};

// --- dữ liệu ---
await db.query('truncate orders, customers, menu_items, menu_groups, settings, profiles, auth.users cascade');
const A = '00000000-0000-0000-0000-00000000000a', C = '00000000-0000-0000-0000-00000000000c';
for (const [id, e] of [[A, 'admin@x'], [C, 'lan@x']]) await db.query('insert into auth.users(id,email) values ($1,$2)', [id, e]);
await db.query("insert into profiles(id,username,name,role) values ($1,'admin','Vinh','admin'),($2,'lan','Lan','cashier')", [A, C]);
tokens.tokA = A; tokens.tokC = C;

ok((await call(null, {}, 'OPTIONS')).status === 204, 'CORS preflight trả 204');
ok((await call('', { action: 'create' })).status === 401, 'không có token → 401');
ok((await call('bad', { action: 'create' })).status === 401, 'token sai → 401');
ok((await call('tokC', { action: 'create', username: 'x1x', name: 'X', role: 'cashier', password: 'bep9876' })).status === 403, 'thu ngân gọi → 403');
const mk = (o = {}) => call('tokA', { action: 'create', username: 'hung', name: 'Hùng', role: 'shipper', password: 'bep9876', ...o });
ok((await mk({ password: '123' })).status === 400, 'mật khẩu ngắn bị từ chối');
ok((await mk({ password: '111111' })).status === 400, 'mật khẩu dễ đoán bị từ chối');
ok((await mk({ username: 'Hùng Nguyễn' })).status === 400, 'tên đăng nhập có dấu/cách bị từ chối');
ok((await mk({ role: 'boss' })).status === 400, 'vai trò lạ bị từ chối');
ok((await mk({ perms: { 'order.hack': true } })).status === 400, 'quyền lạ bị từ chối');
ok((await mk({ perms: { 'order.pay': 'yes' } })).status === 400, 'giá trị quyền không phải true/false bị từ chối');
const created = await mk({ perms: { 'order.pay': true } });
ok(created.status === 200 && created.json.id, 'tạo shipper thành công');
const hung = (await db.query("select p.*, u.email from profiles p join auth.users u on u.id=p.id where username='hung'")).rows[0];
ok(hung && hung.email === 'hung@lylyfood.app' && hung.perms['order.pay'] === true && hung.updated_by === 'Vinh', 'hồ sơ + email đăng nhập đúng: ' + hung?.email);
ok((await mk()).status === 409, 'trùng tên đăng nhập → 409');
const adm2 = await mk({ username: 'quanly2', name: 'QL2', role: 'admin', perms: { 'order.pay': false } });
ok(adm2.status === 200 && JSON.stringify((await db.query("select perms from profiles where username='quanly2'")).rows[0].perms) === '{}', 'quản lý không lưu quyền riêng');

// sửa
const H = hung.id;
ok((await call('tokA', { action: 'update', id: H, name: 'Hùng Béo', perms: { 'order.pay': false, 'cust.view': true } })).status === 200, 'sửa tên + quyền');
ok((await db.query('select name,perms from profiles where id=$1', [H])).rows[0].name === 'Hùng Béo', 'tên đã đổi');
ok((await call('tokA', { action: 'update', id: H, username: 'hung2', password: 'matkhau-moi' })).status === 200 && (await db.query('select email from auth.users where id=$1', [H])).rows[0].email === 'hung2@lylyfood.app', 'đổi tên đăng nhập kéo theo email');
ok((await call('tokA', { action: 'update', id: H, active: false })).status === 200 && (await db.query('select banned_until from auth.users where id=$1', [H])).rows[0].banned_until, 'khoá tài khoản → chặn đăng nhập');
ok((await call('tokA', { action: 'update', id: H, active: true })).status === 200 && !(await db.query('select banned_until from auth.users where id=$1', [H])).rows[0].banned_until, 'mở khoá → gỡ chặn');
ok((await call('tokA', { action: 'update', id: A, role: 'cashier' })).status === 400, 'không tự hạ vai trò của mình');
ok((await call('tokA', { action: 'update', id: A, active: false })).status === 400, 'không tự khoá mình');
ok((await call('tokA', { action: 'update', id: '00000000-0000-0000-0000-0000000000ff', name: 'x' })).status === 404, 'tài khoản không tồn tại → 404');
// quản lý cuối cùng
const QL2 = adm2.json.id; tokens.tokQL2 = QL2;
ok((await call('tokQL2', { action: 'update', id: A, role: 'cashier' })).status === 200, 'quản lý khác hạ được quản lý A khi còn người thay thế');
ok((await call('tokQL2', { action: 'update', id: QL2, role: 'cashier' })).status === 400, 'tự hạ mình bị chặn');
await db.query("update profiles set role='admin' where id=$1", [A]);
await db.query("update profiles set active=false where id=$1 and role<>'admin'", [A]);
// xoá
ok((await call('tokA', { action: 'delete', id: A })).status === 400, 'không tự xoá mình');
ok((await call('tokA', { action: 'delete', id: H })).status === 200 && (await db.query('select 1 from profiles where id=$1', [H])).rowCount === 0, 'xoá nhân viên');
ok((await call('tokA', { action: 'delete', id: QL2 })).status === 200, 'xoá quản lý khi còn người khác');
// còn lại 1 quản lý (A) + thử xoá bằng chính A không được; dùng 1 quản lý mới để thử xoá A
const adm3 = await call('tokA', { action: 'create', username: 'ql3', name: 'QL3', role: 'admin', password: 'bep9876' }); tokens.tokQL3 = adm3.json.id;
await call('tokQL3', { action: 'delete', id: A });
ok((await db.query('select 1 from profiles where role=\'admin\' and active')).rowCount >= 1, 'luôn còn ít nhất 1 quản lý');
ok((await call('tokQL3', { action: 'foo' })).status === 400, 'thao tác lạ bị từ chối');
console.log(`\n${n - fails}/${n} đạt`); await db.end(); process.exit(fails ? 1 : 0);
