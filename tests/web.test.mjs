// Các tình huống riêng của bản Supabase: cấu hình, đăng nhập/đăng xuất, khoá tài khoản, đồng bộ giữa máy, lỗi quyền từ máy chủ.
import * as H from './harness.mjs';
const { data, sleep, click, q, ok, finish, TODAY } = H;
const seed = () => ({
  data: {
    staff: { A1: H.mkStaff('Vinh', 'admin', 'admin'), C1: H.mkStaff('Lan', 'lan', 'cashier'), S1: H.mkStaff('Tuan', 'tuan', 'shipper'), L1: H.mkStaff('Khoá', 'khoa', 'shipper', { active: false }) },
    menu: { m1: { name: 'Cơm gà', price: 45000, unit: 'Phần', groupId: 'g1', active: true } }, groups: { g1: { name: 'Cơm', order: 1 } }, customers: {}, settings: {},
    orders: { o1: { date: TODAY, time: '07:00', mode: 'giao', name: 'Khách A', phone: '09', address: 'Đ1', items: [], total: 45000, payment: 'unpaid', delivered: false, createdAt: 1, shipperId: 'S1', shipperName: 'Tuan' } },
  },
  passwords: { admin: 'bep5555', lan: 'bep2222', tuan: 'bep3333', khoa: 'bep4444' },
});
H.resetData(seed());

(async () => {
  // 1. Chưa cấu hình
  let r = await H.openApp({ config: null });
  ok(r.d.body.textContent.includes('Chưa cấu hình') && !r.d.getElementById('loginForm'), 'thiếu config.js -> báo "Chưa cấu hình", không hiện form đăng nhập');
  r.w.close();

  // 2. Đăng nhập sai / đúng / bị khoá / thiếu thông tin
  r = await H.openApp();
  ok(!!r.d.getElementById('loginForm'), 'chưa đăng nhập -> hiện form đăng nhập');
  await H.loginAs(r.w, r.d, '', '', 100);
  ok(r.d.getElementById('authErr').textContent.includes('Nhập tên đăng nhập'), 'bỏ trống -> nhắc nhập');
  await H.loginAs(r.w, r.d, 'admin', 'saimatkhau');
  ok(/Sai tên đăng nhập hoặc mật khẩu/.test(r.d.getElementById('authErr').textContent), 'sai mật khẩu -> báo sai: ' + r.d.getElementById('authErr').textContent);
  await H.loginAs(r.w, r.d, 'khoa', 'bep4444');
  ok(/khoá/.test(r.d.getElementById('authErr').textContent), 'tài khoản bị khoá không vào được: ' + r.d.getElementById('authErr').textContent);
  await H.loginAs(r.w, r.d, 'ADMIN ', 'bep5555');
  ok(!!r.d.querySelector('.top'), 'đăng nhập đúng (không phân biệt hoa/thường, bỏ khoảng trắng)');
  ok(!r.d.querySelector('script[src*=service]') && !/service_role/i.test(r.w.document.documentElement.outerHTML), 'không có service key trong trang');

  // 3. Đăng xuất
  H.fake(r.w, r.d, 'logout'); await sleep(200);
  ok(!!r.d.getElementById('loginForm') && !r.d.querySelector('.top'), 'đăng xuất -> về màn hình đăng nhập, mất dữ liệu trên màn hình');
  r.w.close();

  // 4. Mở lại khi còn phiên (giữ đăng nhập)
  r = await H.openApp({ sessionUser: 'C1' }); await sleep(400);
  ok(!!r.d.querySelector('.top') && r.d.querySelector('.brand span').textContent.includes('Thu ngân'), 'còn phiên -> vào thẳng app, đúng vai trò');
  r.w.close();
  r = await H.openApp({ sessionUser: 'L1' }); await sleep(500);
  ok(!!r.d.getElementById('loginForm') && /khoá/.test(r.d.getElementById('authErr').textContent), 'phiên của tài khoản đã khoá -> bị đưa ra màn đăng nhập kèm thông báo');
  r.w.close();

  // 5. Đang dùng thì bị khoá / bị xoá -> tự thoát
  H.resetData(seed());
  r = await H.openApp({ sessionUser: 'S1' }); await sleep(400);
  ok(!!r.d.querySelector('.top'), 'shipper đang dùng app');
  data.staff.S1.active = false; r.fake.__notify('profiles'); await sleep(600);
  ok(!!r.d.getElementById('loginForm') && !r.d.querySelector('.top'), 'bị khoá giữa chừng -> tự đăng xuất');
  r.w.close();
  H.resetData(seed());
  r = await H.openApp({ sessionUser: 'C1' }); await sleep(400);
  delete data.staff.C1; r.fake.__notify('profiles'); await sleep(600);
  ok(!!r.d.getElementById('loginForm'), 'bị xoá giữa chừng -> tự đăng xuất');
  r.w.close();

  // 6. Đồng bộ giữa 2 máy (realtime): thu ngân thêm đơn, shipper thấy ngay
  H.resetData(seed());
  const a = await H.openApp({ sessionUser: 'C1' }); await sleep(400);
  H.fake(a.w, a.d, 'nav', { v: 'orders' });
  click(a.w, a.d.querySelector('.newbtn')); await sleep(80);
  a.d.getElementById('f_name').value = 'Khách Z'; a.d.getElementById('f_name').dispatchEvent(new a.w.Event('input', { bubbles: true }));
  click(a.w, a.d.querySelector('[data-act="qty"][data-d="1"]'));
  a.d.getElementById('f_date').value = TODAY;
  a.d.getElementById('f_ship').value = 'S1';
  click(a.w, a.d.querySelector('[data-act="save-order"]')); await sleep(300);
  const z = Object.values(data.orders).find(o => o.name === 'Khách Z');
  ok(z && z.shipperId === 'S1' && z.createdById === 'C1' && z.createdBy === 'Lan', 'đơn mới lưu đúng cột (shipper_id, người tạo): ' + JSON.stringify(z && [z.shipperId, z.createdBy]));
  const b = await H.openApp({ sessionUser: 'S1' }); await sleep(400);
  ok(q(b.d, '.ticket h3').map(x => x.textContent).sort().join() === 'Khách A,Khách Z', 'shipper thấy đơn mới: ' + q(b.d, '.ticket h3').map(x => x.textContent).join());
  data.orders.o1.name = 'Khách A2'; b.fake.__notify('orders'); await sleep(500);
  ok(q(b.d, '.ticket h3').map(x => x.textContent).includes('Khách A2'), 'sửa tên ở nơi khác -> máy shipper tự cập nhật (realtime)');
  a.w.close(); b.w.close();

  // 7. Máy chủ từ chối (RLS ẩn dòng) -> app báo "không có quyền", không báo thành công
  H.resetData(seed());
  r = await H.openApp({ sessionUser: 'S1' }); await sleep(400);
  H.fake(r.w, r.d, 'pay', { id: 'o1', v: 'cash' }); await sleep(100);
  ok(data.orders.o1.payment === 'unpaid', 'shipper không thu tiền được');
  r.w.close();

  // 8. Đổi mật khẩu của chính mình
  H.resetData(seed());
  r = await H.openApp({ sessionUser: 'C1' }); await sleep(400);
  H.fake(r.w, r.d, 'nav', { v: 'settings' }); await sleep(50);
  const pwBtn = r.d.querySelector('[data-act=pw-form],[data-act=change-pw],[data-act=my-pw]');
  ok(!!pwBtn, 'có nút đổi mật khẩu trong Cài đặt');
  if (pwBtn) {
    click(r.w, pwBtn); await sleep(60);
    const ids = q(r.d, '#sheet input').map(i => i.id); console.log('   ô nhập:', ids.join(','));
    const [o, n, n2] = ids.map(i => r.d.getElementById(i));
    o.value = 'bep2222'; n.value = 'moimoi99'; if (n2) n2.value = 'moimoi99';
    click(r.w, r.d.querySelector('[data-act=save-pw]')); await sleep(300);
    ok(H.passwords.lan === 'moimoi99', 'đổi mật khẩu thành công, mật khẩu mới có hiệu lực: ' + H.passwords.lan);
  }
  r.w.close();

  // 9. Nhân viên: tạo / đổi mật khẩu / khoá / xoá qua hàm máy chủ
  H.resetData(seed());
  r = await H.openApp({ sessionUser: 'A1' }); await sleep(400);
  H.fake(r.w, r.d, 'nav', { v: 'settings' }); await sleep(50); H.fake(r.w, r.d, 'sub-staff'); await sleep(80);
  click(r.w, r.d.querySelector('[data-act=new-staff]')); await sleep(60);
  r.d.getElementById('st_name').value = 'Hùng'; r.d.getElementById('st_user').value = 'hung'; r.d.getElementById('st_pw').value = '123456'; r.d.getElementById('st_role').value = 'shipper';
  click(r.w, r.d.querySelector('[data-act=save-staff]')); await sleep(250);
  ok(!Object.values(data.staff).some(s => s.username === 'hung'), 'mật khẩu 123456 bị từ chối');
  r.d.getElementById('st_pw').value = 'hung7788';
  click(r.w, r.d.querySelector('[data-act=save-staff]')); await sleep(300);
  const hung = Object.entries(data.staff).find(([, s]) => s.username === 'hung');
  ok(hung && hung[1].role === 'shipper' && H.passwords.hung === 'hung7788', 'tạo nhân viên mới thành công qua hàm máy chủ');
  const h2 = await H.openApp(); await H.loginAs(h2.w, h2.d, 'hung', 'hung7788', 500);
  ok(!!h2.d.querySelector('.top'), 'nhân viên mới đăng nhập được ngay');
  // khoá rồi xoá
  click(r.w, r.d.querySelector('[data-act=edit-staff][data-id="' + hung[0] + '"]')); await sleep(60);
  const act = r.d.getElementById('st_active'); if (act) { act.checked = false; }
  click(r.w, r.d.querySelector('[data-act=save-staff]')); await sleep(300);
  ok(hung && data.staff[hung[0]].active === false, 'khoá nhân viên');
  await sleep(500);
  ok(!!h2.d.getElementById('loginForm'), 'nhân viên đang mở app bị khoá -> tự thoát');
  // quản lý không tự khoá mình / xoá mình
  H.fake(r.w, r.d, 'del-staff', { id: 'A1' }); await sleep(150);
  ok(!!data.staff.A1, 'không tự xoá tài khoản quản lý của mình');
  h2.w.close(); r.w.close();

  // 10. Quản lý cuối cùng không bị hạ quyền / xoá
  H.resetData(seed());
  r = await H.openApp({ sessionUser: 'A1' }); await sleep(400);
  const res = await r.fake.functions.invoke('staff-admin', { body: { action: 'delete', id: 'A1' } });
  ok(!!res.error, 'hàm máy chủ từ chối xoá chính mình');
  r.w.close();

  finish();
})().catch(e => { console.error('ERR', e); process.exit(2); });
