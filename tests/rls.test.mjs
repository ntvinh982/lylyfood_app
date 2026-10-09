// Test luật quyền (RLS + trigger) trên Postgres thật. Chạy: node tests/rls.test.mjs
// Cần: Postgres đã áp tests/stub-supabase.sql + migration. Biến PGDATABASE (mặc định lyly_test).
import pg from 'pg';
const { Client } = pg;
const db = new Client({ host: process.env.PGHOST || '/var/run/postgresql', database: process.env.PGDATABASE || 'lyly_test', user: process.env.PGUSER || 'root' });
await db.connect();
let fails = 0, n = 0;
const ok = (c, m) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const U = { A: '00000000-0000-0000-0000-00000000000a', C: '00000000-0000-0000-0000-00000000000c', S1: '00000000-0000-0000-0000-0000000000a1', S2: '00000000-0000-0000-0000-0000000000a2', L: '00000000-0000-0000-0000-00000000000d' };

// chạy như một người dùng đã đăng nhập (role authenticated + JWT sub). Trả {rows, rowCount} hoặc {error}
async function as(uid, sql, params = [], role = 'authenticated') {
  await db.query('begin');
  try {
    await db.query(`set local role ${role}`);
    if (uid) await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    const r = await db.query(sql, params);
    await db.query('commit');
    return { rows: r.rows, rowCount: r.rowCount };
  } catch (e) { await db.query('rollback'); return { error: e.message, code: e.code }; }
}
const root = (sql, p = []) => db.query(sql, p);
const setPerms = (id, perms) => root('update profiles set perms=$2::jsonb where id=$1', [id, JSON.stringify(perms)]);
const today = (await root("select app.vn_today() d")).rows[0].d;
const yday = (await root("select to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date - 1,'YYYY-MM-DD') d")).rows[0].d;

// ---- dữ liệu mẫu (chạy bằng quyền superuser, auth.uid() = null nên trigger bỏ qua) ----
await root('truncate orders, customers, menu_items, menu_groups, settings, profiles, auth.users cascade');
for (const [k, id] of Object.entries(U)) await root('insert into auth.users(id,email) values ($1,$2)', [id, k.toLowerCase() + '@x.test']);
const mk = (id, u, name, role, active = true) => root('insert into profiles(id,username,name,role,active) values ($1,$2,$3,$4,$5)', [id, u, name, role, active]);
await mk(U.A, 'admin', 'Vinh', 'admin'); await mk(U.C, 'lan', 'Lan', 'cashier'); await mk(U.S1, 'tuan', 'Tuấn', 'shipper');
await mk(U.S2, 'binh', 'Bình', 'shipper'); await mk(U.L, 'khoa', 'Khoá', 'cashier', false);
const ord = (id, date, mode, ship, extra = {}) => root(
  `insert into orders(id,date,mode,name,items,total,shipper_id,shipper_name) values ($1,$2,$3,$4,'[{"menuId":"m1","name":"Cơm","price":45000,"qty":2}]',90000,$5,$6)`,
  [id, date, mode, 'Khách ' + id, ship, ship ? 'x' : '']);
await ord('o1', today, 'giao', U.S1); await ord('o2', today, 'giao', U.S2); await ord('o3', today, 'giao', null);
await ord('o4', today, 'lay', U.S1); await ord('o5', yday, 'giao', U.S1);
await root("insert into menu_groups(id,name) values ('g1','Cơm')");
await root("insert into menu_items(id,name,price,group_id) values ('m1','Cơm gà',45000,'g1')");
await root("insert into customers(id,name,phone) values ('c1','Chị Lan','0903456789')");
await root("insert into settings(key,data) values ('shop','{\"name\":\"Lyly Food\"}')");

const ids = r => (r.rows || []).map(x => x.id).sort().join(',');

// ===== anon =====
for (const t of ['orders', 'profiles', 'customers', 'menu_items', 'settings'])
  ok(!!(await as(null, `select * from ${t}`, [], 'anon')).error, `chưa đăng nhập không đọc được ${t}`);

// ===== profiles =====
ok((await as(U.C, 'select id from profiles')).rows.length === 5, 'thu ngân xem được danh sách nhân viên');
ok(!('hash' in (await as(U.C, 'select * from profiles limit 1')).rows[0]), 'hồ sơ không chứa mật khẩu/hash');
ok((await as(U.L, 'select id from profiles')).rows.map(r => r.id).join() === U.L, 'tài khoản bị khoá chỉ thấy dòng của mình');
ok((await as(U.C, "update profiles set theme='dark' where id=$1", [U.C])).rowCount === 1, 'đổi giao diện của mình được');
ok(!!(await as(U.C, "update profiles set role='admin' where id=$1", [U.C])).error, 'tự nâng mình lên quản lý bị chặn');
ok(!!(await as(U.C, "update profiles set perms='{\"report.view\":true}' where id=$1", [U.C])).error, 'tự cấp quyền cho mình bị chặn');
ok((await as(U.C, "update profiles set theme='dark' where id=$1", [U.S1])).rowCount === 0, 'sửa hồ sơ người khác bị chặn');
ok(!!(await as(U.S1, "update profiles set active=false where id=$1", [U.S1])).error, 'shipper tự đổi trạng thái bị chặn');
ok((await as(U.A, "update profiles set perms='{\"order.print\":false}' where id=$1", [U.C])).rowCount === 1, 'quản lý chỉnh quyền người khác được');
ok(!!(await as(U.A, "update profiles set role='cashier' where id=$1", [U.A])).error, 'quản lý cuối cùng không tự hạ vai trò');
ok(!!(await as(U.A, "update profiles set active=false where id=$1", [U.A])).error, 'quản lý cuối cùng không tự khoá');
ok(!!(await as(U.A, "insert into profiles(id,username,name) values (gen_random_uuid(),'hack','Hack')")).error, 'không tạo hồ sơ trực tiếp được');
ok(!!(await as(U.A, 'delete from profiles where id=$1', [U.C])).error, 'không xoá hồ sơ trực tiếp được (chỉ qua Edge Function)');
await setPerms(U.C, {});
ok((await root('select updated_by from profiles where id=$1', [U.C])).rows[0].updated_by === 'Vinh', 'ghi lại người sửa hồ sơ');

// ===== đơn hàng: xem =====
ok(ids(await as(U.C, 'select id from orders')) === 'o1,o2,o3,o4,o5', 'thu ngân thấy tất cả đơn');
ok(ids(await as(U.S1, 'select id from orders')) === 'o1', 'shipper 1 chỉ thấy đơn giao hôm nay của mình (không thấy đơn lấy, đơn hôm qua, đơn người khác)');
ok(ids(await as(U.S2, 'select id from orders')) === 'o2', 'shipper 2 chỉ thấy đơn của mình');
ok(ids(await as(U.L, 'select id from orders')) === '', 'tài khoản khoá không thấy đơn nào');
await setPerms(U.C, { 'order.all': false });
ok(ids(await as(U.C, 'select id from orders')) === '', 'thu ngân bỏ "Xem tất cả đơn" → không thấy đơn (không được gán)');
await setPerms(U.C, { 'order.all': false, 'report.view': true });
ok(ids(await as(U.C, 'select id from orders')) === 'o1,o2,o3,o4,o5', 'có quyền báo cáo thì đọc được đơn để tính báo cáo');
await setPerms(U.C, {});

// ===== đơn hàng: tạo =====
const ins = (uid, id, extra = '', cols = '') => as(uid, `insert into orders(id,date,name,items,total ${cols}) values ($1,$2,'Khách mới','[]',0 ${extra})`, [id, today]);
ok(!(await ins(U.C, 'n1')).error, 'thu ngân tạo đơn được');
ok(!!(await ins(U.S1, 'n2')).error, 'shipper không tạo đơn được');
const forged = await as(U.C, `insert into orders(id,date,name,items,total,created_by,created_by_id,created_at) values ('n3',$1,'X','[]',0,'Hacker','${U.A}','2000-01-01')`, [today]);
const n3 = (await root("select created_by,created_by_id,created_at::date d from orders where id='n3'")).rows[0];
ok(!forged.error && n3.created_by === 'Lan' && n3.created_by_id === U.C && n3.d.getFullYear() > 2000, 'không giả được người tạo / thời gian tạo');
ok(!(await as(U.C, `insert into orders(id,date,name,items,total,shipper_id,shipper_name) values ('n5',$1,'X','[]',0,$2,'Tuấn')`, [today, U.S1])).error, 'thu ngân (có quyền gán) tạo đơn kèm shipper được');
await setPerms(U.C, { 'order.assign': false });
ok(!!(await as(U.C, `insert into orders(id,date,name,items,total,shipper_id,shipper_name) values ('n6',$1,'X','[]',0,$2,'Tuấn')`, [today, U.S1])).error, 'bỏ quyền gán → tạo đơn kèm shipper bị chặn');
await setPerms(U.C, { 'order.pay': false });
ok(!!(await as(U.C, `insert into orders(id,date,name,items,total,payment) values ('n7',$1,'X','[]',0,'cash')`, [today])).error, 'bỏ quyền thu tiền → không tạo đơn "đã thu" được');
await setPerms(U.C, { 'order.create': false });
ok(!!(await ins(U.C, 'n8')).error, 'bỏ quyền tạo đơn → bị chặn');
await setPerms(U.C, {});

// ===== đơn hàng: sửa =====
ok((await as(U.C, "update orders set note='gọi trước' where id='o3'")).rowCount === 1, 'thu ngân sửa đơn được');
ok((await as(U.C, "update orders set created_by='Hacker', sample=true where id='o3'")).rowCount === 1 && (await root("select created_by,sample from orders where id='o3'")).rows[0].created_by === '' , 'không sửa được người tạo');
ok((await root("select updated_by from orders where id='o3'")).rows[0].updated_by === 'Lan', 'ghi người sửa là Lan');
{ const r = await as(U.S1, "update orders set delivered=true where id='o1'");
  ok((!!r.error || r.rowCount === 0) && (await root("select delivered from orders where id='o1'")).rows[0].delivered === false, 'shipper chưa có quyền thu/giao → bị chặn, dữ liệu không đổi'); }
await setPerms(U.S1, { 'order.pay': true });
ok((await as(U.S1, "update orders set payment='cash', delivered=true where id='o1'")).rowCount === 1, 'shipper được cấp quyền thu/giao → ghi được đơn của mình');
ok((await as(U.S1, "update orders set delivered=true where id='o2'")).rowCount === 0, '…nhưng không đụng được đơn của shipper khác');
ok(!!(await as(U.S1, "update orders set total=1 where id='o1'")).error, '…và không sửa được nội dung đơn');
ok(!!(await as(U.S1, "update orders set shipper_id=null, shipper_name='' where id='o1'")).error, '…và không tự gỡ gán');
await setPerms(U.S1, { 'order.pay': true, 'order.assign': true });
ok(!!(await as(U.S1, "update orders set shipper_id=null, shipper_name='' where id='o1'")).error, '…cấp "gán shipper" mà không có "xem tất cả đơn" thì quyền con vô hiệu');
await setPerms(U.S1, {});
ok((await as(U.C, "update orders set shipper_id=$1, shipper_name='Bình' where id='o3'", [U.S2])).rowCount === 1 && (await root("select shipper_id from orders where id='o3'")).rows[0].shipper_id === U.S2, 'thu ngân gán shipper cho đơn');
await setPerms(U.C, { 'order.assign': false });
ok(!!(await as(U.C, "update orders set shipper_id=$1 where id='o3'", [U.S1])).error, 'bỏ quyền gán → đổi shipper bị chặn');
ok((await as(U.C, "update orders set note='ok' where id='o3'")).rowCount === 1, '…nhưng vẫn sửa được ghi chú');
await setPerms(U.C, { 'order.edit': false });
ok(!!(await as(U.C, "update orders set note='zz' where id='o3'")).error, 'bỏ quyền sửa đơn → bị chặn');
ok((await as(U.C, "update orders set payment='cash' where id='o3'")).rowCount === 1, '…nhưng vẫn thu tiền được (quyền riêng)');
await setPerms(U.C, {});

// ===== đơn hàng: xoá =====
ok((await as(U.C, "delete from orders where id='n1'")).rowCount === 0, 'thu ngân mặc định không xoá được đơn');
await setPerms(U.C, { 'order.delete': true });
ok((await as(U.C, "delete from orders where id='n1'")).rowCount === 1, 'được cấp quyền xoá → xoá được');
await setPerms(U.C, { 'order.delete': true, 'order.edit': false });
ok((await as(U.C, "delete from orders where id='n3'")).rowCount === 0, 'quyền xoá phụ thuộc quyền sửa đơn (bỏ sửa thì xoá cũng mất)');
await setPerms(U.C, {});
ok((await as(U.S1, "delete from orders where id='o1'")).rowCount === 0, 'shipper không xoá được');
ok((await as(U.A, "delete from orders where id='n3'")).rowCount === 1, 'quản lý xoá được');

// ===== khách hàng =====
ok((await as(U.C, 'select id from customers')).rows.length === 1, 'thu ngân xem được khách');
ok((await as(U.S1, 'select id from customers')).rows.length === 0, 'shipper không xem được danh sách khách');
await setPerms(U.C, { 'cust.view': false });
ok((await as(U.C, 'select id from customers')).rows.length === 1, 'bỏ xem khách nhưng còn làm đơn → vẫn thấy để gợi ý khi ghi đơn');
ok((await as(U.C, "update customers set note='x' where id='c1'")).rowCount === 0, 'bỏ xem khách → cust.edit tự mất → không sửa khách');
await setPerms(U.C, {});
ok(!(await as(U.C, "insert into customers(id,name,phone) values ('c2','Anh Hưng','0912')")).error, 'thu ngân thêm khách được');
ok((await as(U.C, "update customers set address='KTX' where id='c2'")).rowCount === 1, 'thu ngân sửa khách được');
ok((await as(U.C, "delete from customers where id='c2'")).rowCount === 0, 'thu ngân không xoá khách');
ok(!!(await as(U.S1, "insert into customers(id,name) values ('c3','Hack')")).error, 'shipper không thêm khách');
await setPerms(U.S1, { 'cust.import': true });
ok(!(await as(U.S1, "insert into customers(id,name,imported) values ('c4','Nhập','true')")).error, 'cust.import cho phép nhập khách mới');
ok((await as(U.S1, "update customers set note='gộp' where id='c4'")).rowCount === 0, '…nhưng không thấy để cập nhật khi chưa có quyền xem (RLS ẩn)');
await setPerms(U.S1, {});
await setPerms(U.C, { 'cust.delete': true });
ok((await as(U.C, "delete from customers where id='c2'")).rowCount === 1, 'được cấp xoá khách → xoá được');
await setPerms(U.C, {});

// ===== món =====
ok((await as(U.S1, 'select id from menu_items')).rows.length === 1, 'shipper đọc được món');
ok(!!(await as(U.S1, "insert into menu_items(id,name,price) values ('m9','x',1)")).error, 'shipper không thêm món');
ok(!(await as(U.C, "insert into menu_items(id,name,price) values ('m2','Sâm',10000)")).error, 'thu ngân thêm món được');
ok((await as(U.C, "update menu_items set price=12000 where id='m2'")).rowCount === 1, 'thu ngân sửa giá được');
ok((await as(U.C, "delete from menu_items where id='m2'")).rowCount === 0, 'thu ngân không xoá món');
await setPerms(U.C, { 'menu.delete': true });
ok((await as(U.C, "delete from menu_items where id='m2'")).rowCount === 1, 'được cấp xoá món → xoá được');
await setPerms(U.C, { 'menu.edit': false });
ok(!!(await as(U.C, "insert into menu_groups(id,name) values ('g9','x')")).error, 'bỏ quyền món → không thêm nhóm');
await setPerms(U.C, {});

// ===== cài đặt =====
ok((await as(U.S1, "select data from settings where key='shop'")).rows.length === 1, 'shipper đọc được cài đặt cửa hàng');
ok((await as(U.C, "update settings set data='{\"name\":\"X\"}' where key='shop'")).rowCount === 0, 'thu ngân mặc định không sửa được thông tin cửa hàng');
await setPerms(U.C, { 'shop.edit': true });
ok((await as(U.C, "update settings set data='{\"name\":\"Lyly\"}' where key='shop'")).rowCount === 1, 'được cấp quyền → sửa được');
await setPerms(U.C, {});

// ===== quyền tuỳ chỉnh: dữ liệu bị sửa bậy / phụ thuộc =====
await setPerms(U.C, { 'order.print': 'false', 'order.all': 0 });
ok(ids(await as(U.C, 'select id from orders where id in (\'o1\',\'o2\')')) === 'o1,o2', 'giá trị quyền không phải true/false bị bỏ qua (giữ mặc định)');
await setPerms(U.C, { 'order.all': false, 'order.assign': true });
ok((await root(`select app.profile_perm(p,'order.assign') v from profiles p where id=$1`, [U.C])).rows[0].v === false, 'quyền con tắt khi quyền cha tắt');
await setPerms(U.C, {});
await root('update profiles set active=false where id=$1', [U.C]);
ok(ids(await as(U.C, 'select id from orders')) === '' && !!(await ins(U.C, 'z1')).error, 'khoá tài khoản là mất hết quyền ngay lập tức');
await root('update profiles set active=true where id=$1', [U.C]);
ok(ids(await as(U.A, 'select id from orders')) === 'n5,o1,o2,o3,o4,o5', 'quản lý thấy tất cả');

// ---- nhật ký AI: chỉ máy chủ (service role) đụng được ----
await root('grant all on all tables in schema public to service_role'); // Supabase thật cấp sẵn quyền này cho service_role
await root("insert into ai_parse_log(user_id) values ($1)", [U.C]);
for (const [who, uid] of [['quản lý', U.A], ['thu ngân', U.C]]) {
  const sel = await as(uid, 'select * from ai_parse_log'); ok(!!sel.error, 'ai_parse_log: ' + who + ' không đọc được (' + (sel.error || '') + ')');
  const ins = await as(uid, 'insert into ai_parse_log(user_id) values ($1)', [uid]); ok(!!ins.error, 'ai_parse_log: ' + who + ' không ghi được');
}
const anonSel = await as(null, 'select * from ai_parse_log', [], 'anon'); ok(!!anonSel.error, 'ai_parse_log: người chưa đăng nhập không đọc được');
const svc = await as(null, 'select count(*)::int c from ai_parse_log', [], 'service_role'); ok(!svc.error && svc.rows[0].c === 1, 'ai_parse_log: service role đọc được');

console.log(`\n${n - fails}/${n} đạt`); await db.end(); process.exit(fails ? 1 : 0);
