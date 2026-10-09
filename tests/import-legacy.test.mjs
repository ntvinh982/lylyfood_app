// Thử script chuyển dữ liệu trên Postgres thật, bằng file dữ liệu thật đã xuất từ app cũ (nếu có) + dữ liệu thử.
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import { importLegacy, mapOrder, mapRole } from '../scripts/import-legacy.mjs';
const db = new pg.Client({ host: process.env.PGHOST || '/var/run/postgresql', database: process.env.PGDATABASE || 'lyly_test', user: process.env.PGUSER || 'root' });
await db.connect();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const cols = r => Object.keys(r);
function client() {
  const from = table => {
    const st = { f: [] };
    const b = {
      select() { return b; }, eq(k, v) { st.f.push([k, v]); return b; },
      async maybeSingle() { const w = st.f.map(([k], i) => `${k}=$${i + 1}`).join(' and '); const r = await db.query(`select * from public.${table} where ${w}`, st.f.map(x => x[1])); return { data: r.rows[0] || null, error: null }; },
      async insert(row) { try { await db.query(`insert into public.${table}(${cols(row).join(',')}) values (${cols(row).map((_, i) => '$' + (i + 1)).join(',')})`, Object.values(row).map(v => v !== null && typeof v === 'object' ? JSON.stringify(v) : v)); return { error: null }; } catch (e) { return { error: e }; } },
      async upsert(rows, { onConflict }) {
        try { for (const row of rows) { const c = cols(row); await db.query(`insert into public.${table}(${c.join(',')}) values (${c.map((_, i) => '$' + (i + 1)).join(',')}) on conflict (${onConflict}) do update set ${c.filter(x => x !== onConflict).map(x => `${x}=excluded.${x}`).join(',')}`, Object.values(row).map(v => v !== null && typeof v === 'object' ? JSON.stringify(v) : v)); } return { error: null }; }
        catch (e) { return { error: e }; }
      },
    };
    return b;
  };
  return {
    from,
    auth: { admin: {
      async createUser({ email }) { try { const id = crypto.randomUUID(); await db.query('insert into auth.users(id,email) values ($1,$2)', [id, email]); return { data: { user: { id } }, error: null }; } catch (e) { return { data: null, error: e }; } },
      async deleteUser(id) { await db.query('delete from auth.users where id=$1', [id]); return { error: null }; },
      async updateUserById(id, p) { if (p.ban_duration) await db.query("update auth.users set banned_until = now() + interval '100 years' where id=$1", [id]); return { error: null }; },
    } },
  };
}
const reset = () => db.query('truncate orders, customers, menu_items, menu_groups, settings, profiles, auth.users cascade');
const quiet = () => {};
const legacy = {
  staff: { a: { username: 'admin', name: 'Quản lý', role: 'admin', active: true, createdAt: 1791310576035 }, b: { username: 'lan', name: 'Lan', role: 'staff', active: true, perms: { 'order.delete': true, 'bogus': true, 'cust.view': 'yes' }, theme: 'dark' }, c: { username: 'tuan', name: 'Tuấn', role: 'shipper', active: true }, d: { username: 'cuu', name: 'Nghỉ việc', role: 'shipper', active: false } },
  groups: { g1: { name: 'Cơm', order: 1, createdAt: 5 } },
  menu: { m1: { name: 'Cơm gà', price: 45000, unit: 'Phần', groupId: 'g1', active: true }, ms: { name: 'Món mẫu', price: 1, sample: true } },
  customers: { k1: { name: 'Chị Hoa', phone: '0900', address: 'x', note: '', createdAt: 3 }, ks: { name: 'Khách mẫu', sample: true }, k2: { phone: '0911' } },
  orders: {
    o1: { date: '2026-10-07', time: '07:00', mode: 'giao', name: 'Chị Hoa', customerId: 'k1', items: [{ menuId: 'm1', name: 'Cơm gà', price: 45000, qty: 2, note: '' }], total: 90000, payment: 'cash', delivered: true, shipperId: 'c', shipperName: 'Tuấn', createdAt: 1791310000104, updatedAt: 1791330341716, createdBy: 'Quản lý', updatedBy: 'admin' },
    o2: { date: '2026-10-07', time: '', mode: 'lay', name: '', items: [], total: 0, payment: 'weird', shipperId: 'khong-co', createdAt: 5 },
    os: { date: '2026-10-07', mode: 'giao', name: 'Mẫu', items: [], total: 0, sample: true },
  },
  settings: { shop: { name: 'Lyly Food', phone: '035' } },
};
await reset();
let r = await importLegacy(legacy, client(), { log: quiet, genPassword: () => 'tam12345' });
const count = async t => +(await db.query(`select count(*) c from public.${t}`)).rows[0].c;
ok(await count('profiles') === 4 && r.tempPasswords.length === 4, 'tạo 4 tài khoản + 4 mật khẩu tạm');
const lan = (await db.query("select * from profiles where username='lan'")).rows[0];
ok(lan.role === 'cashier' && lan.theme === 'dark' && JSON.stringify(lan.perms) === '{"order.delete":true}', 'role "staff" -> thu ngân; chỉ giữ quyền hợp lệ: ' + JSON.stringify(lan.perms));
ok((await db.query("select banned_until from auth.users where email like 'cuu@%'")).rows[0].banned_until !== null, 'tài khoản đã khoá ở app cũ -> bị khoá đăng nhập');
ok(await count('menu_items') === 1 && await count('customers') === 2 && await count('orders') === 2 && await count('menu_groups') === 1, 'bỏ qua dữ liệu mẫu');
const o1 = (await db.query("select * from orders where id='o1'")).rows[0], o2 = (await db.query("select * from orders where id='o2'")).rows[0];
const tuan = (await db.query("select id from profiles where username='tuan'")).rows[0].id;
ok(o1.shipper_id === tuan && o1.shipper_name === 'Tuấn' && o1.payment === 'cash' && o1.delivered && o1.created_by === 'Quản lý', 'đơn: shipper được nối đúng tài khoản mới, giữ người tạo');
ok(new Date(o1.created_at).getTime() === 1791310000104 && new Date(o1.updated_at).getTime() === 1791330341716, 'giữ nguyên thời điểm tạo/sửa');
ok(o2.shipper_id === null && o2.payment === 'unpaid' && o2.time === '', 'dữ liệu lạ được chuẩn hoá (shipper không tồn tại, thanh toán lạ)');
ok((await db.query("select name from customers where id='k2'")).rows[0].name === '0911', 'khách chỉ có SĐT dùng SĐT làm tên');
ok((await db.query("select data from settings where key='shop'")).rows[0].data.name === 'Lyly Food', 'cài đặt cửa hàng');
// chạy lại: không nhân đôi, không đổi tài khoản
const before = (await db.query('select id from profiles order by username')).rows.map(x => x.id).join();
r = await importLegacy(legacy, client(), { log: quiet });
ok(await count('profiles') === 4 && await count('orders') === 2 && r.tempPasswords.length === 0 && (await db.query('select id from profiles order by username')).rows.map(x => x.id).join() === before, 'chạy lại lần 2 an toàn: không nhân đôi, không tạo lại tài khoản');
// dry-run
await reset();
r = await importLegacy(legacy, client(), { log: quiet, dryRun: true });
ok(await count('profiles') === 0 && await count('orders') === 0 && r.summary.orders === 2, 'chạy thử (--dry-run) không ghi gì');
// include sample
r = await importLegacy(legacy, client(), { log: quiet, includeSample: true });
ok(await count('orders') === 3 && await count('menu_items') === 2, '--include-sample giữ cả dữ liệu mẫu');
// lỗi đầu vào
let err = ''; try { await importLegacy({ staff: { a: { username: 'ab', role: 'admin' } } }, client(), { log: quiet }); } catch (e) { err = e.message; }
ok(/không hợp lệ/.test(err), 'tên đăng nhập quá ngắn bị báo rõ');
err = ''; try { await importLegacy({ staff: { a: { username: 'abc', role: 'shipper' } } }, client(), { log: quiet }); } catch (e) { err = e.message; }
ok(/quản lý/.test(err), 'dữ liệu không có quản lý nào thì dừng');
// file thật
if (fs.existsSync(new URL('../legacy-export.json', import.meta.url))) {
  await reset();
  const real = JSON.parse(fs.readFileSync(new URL('../legacy-export.json', import.meta.url)));
  r = await importLegacy(real, client(), { log: quiet });
  ok(await count('menu_items') === Object.keys(real.menu).length && await count('menu_groups') === Object.keys(real.groups).length && await count('profiles') === 3, 'file thật từ app cũ: nhập đủ ' + JSON.stringify(r.summary));
}
await reset(); await db.end();
console.log(fails ? fails + ' LỖI' : 'TẤT CẢ ĐẠT'); process.exit(fails ? 1 : 0);
