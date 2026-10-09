// Nhập đơn từ comment Facebook: dán chữ/ảnh -> AI (giả) -> đơn nháp -> sửa -> tạo. Dùng nội dung comment thật của quán.
import * as H from './harness.mjs';
const { data, ai, sleep, click, q, ok, finish, TODAY } = H;
const tm = new Date(); tm.setDate(tm.getDate() + 1);
const TOMORROW = tm.getFullYear() + '-' + H.pad(tm.getMonth() + 1) + '-' + H.pad(tm.getDate());
const M = (name, price, groupId) => ({ name, price, unit: 'Phần', groupId, active: true, createdAt: 1 });
const seed = () => ({
  data: {
    staff: { A1: H.mkStaff('Vinh', 'admin', 'admin'), C1: H.mkStaff('Lan', 'lan', 'cashier'), S1: H.mkStaff('Tuấn', 'tuan', 'shipper'), N1: H.mkStaff('Nga', 'nga', 'cashier', { perms: { 'order.create': false } }) },
    groups: { g1: { name: 'Súp', order: 1 }, g2: { name: 'Topping', order: 2 } },
    menu: {
      hsM: M('Soup Gà Hải Sản - M', 40000, 'g1'), hsL: M('Soup Gà Hải Sản - L', 45000, 'g1'),
      tcM: M('Soup Gà Thanh Cua - M', 30000, 'g1'), tcL: M('Soup Gà Thanh Cua - L', 35000, 'g1'),
      dbM: M('Soup thập cẩm đặc biệt - M', 50000, 'g1'), dbL: M('Soup thập cẩm đặc biệt - L', 55000, 'g1'),
      qy: M('Quẩy thêm', 5000, 'g2'), trung: M('Trứng thêm', 10000, 'g2'),
    },
    customers: {
      k1: { name: 'Chị Như', phone: '0903111222', address: '12 Lê Lợi, Cái Răng', note: '', createdAt: 1 },
      k2: { name: 'Chị Yến', phone: '0911000001', address: 'A', note: '', createdAt: 2 },
      k3: { name: 'Chị Yến', phone: '0911000002', address: 'B', note: '', createdAt: 3 },
    },
    orders: {}, settings: {},
  },
  passwords: { admin: 'bep5555', lan: 'bep2222', tuan: 'bep3333', nga: 'bep4444' },
});
const it = (text, menu_id, qty, note = '') => ({ text, menu_id, qty, note });
const O = (customer_name, items, extra = {}) => Object.assign({ customer_name, items, delivery_time: null, date: null, mode: 'giao', confidence: 'high', issues: [], raw: customer_name, address: '', phone: '', note: '' }, extra);
const AI_REPLY = () => ({
  orders: [
    O('Chị Như', [it('4p đb L', 'dbL', 4)], { address: 'Sóc Trăng', confidence: 'medium', issues: ["Đoán 'đb' là Soup thập cẩm đặc biệt"], raw: 'Chị Như : 4p đb L ( Sóc Trăng )' }),
    O('Chị Ái Vân', [it('1 Đb M', 'dbM', 1), it('1 quầy thêm', 'qy', 1)], { confidence: 'medium', raw: 'Chị Ái Vân : 1 Đb M + 1 quầy thêm' }),
    O('Chị Thuý Nguyen', [it('2 hs M', 'hsM', 2)]),
    O('Chị Yến', [it('2p M súp gà thanh cua', 'tcM', 2, 'không gà, không hành, không tiêu'), it('1p M đặc biệt', 'dbM', 1, 'không gà, không tôm, không hành, không tiêu')], { delivery_time: '06:00' }),
    O('Chị Uyên', [it('5p Gà - Thanh cua size L', 'tcL', 5)], { delivery_time: '07:30', mode: 'lay' }),
    O('Tuyền Nguyễn', [it('1 đb 60 thêm thanh cua', null, 1)], { confidence: 'low', issues: ["Không rõ 'đb 60' là món nào"] }),
    O('Lily Vo', [it('2p đb sz L', 'dbL', 2, 'không ngò, không tiêu, không tỏi'), it('1 trứng', 'trung', 1)], { delivery_time: '09:00' }),
  ],
  ignored: ['Mỹ Hân ơi', 'Phương Khánh sốp đã trở lại', 'Mấy giờ có vậy chị'],
});
const PASTE = `Lyly Nguyen
· 12 giờ · Tác giả
Chị Như : 4p đb L ( Sóc Trăng )
Thích
Trả lời
Lyly Nguyen
Chị Ái Vân : 1 Đb M + 1 quầy thêm
Xem 2 câu trả lời
Thích Trả lời`;

const fire = (w, el, type = 'input') => el.dispatchEvent(new w.Event(type, { bubbles: true }));
const setv = (w, el, v, type = 'input') => { el.value = v; fire(w, el, type); };
const names = d => q(d, '.ticket h3').map(x => x.textContent).sort().join('|');

(async () => {
  // ---- quyền hiển thị nút ----
  H.resetData(seed());
  let r = await H.session('tuan', 'bep3333');
  ok(!r.d.querySelector('[data-act=cmt-open]'), 'shipper không thấy nút nhập đơn từ comment');
  H.fake(r.w, r.d, 'cmt-open'); await sleep(60);
  ok(r.d.getElementById('sheet').hidden, 'shipper gọi thẳng hành động cũng bị chặn');
  r.w.close();
  r = await H.session('nga', 'bep4444');
  ok(!r.d.querySelector('[data-act=cmt-open]'), 'thu ngân bị tắt quyền "tạo đơn" không thấy nút');
  r.w.close();
  r = await H.session('admin', 'bep5555');
  ok(!!r.d.querySelector('[data-act=cmt-open]'), 'quản lý thấy nút');
  r.w.close();

  // ---- luồng chính (thu ngân) ----
  H.resetData(seed()); ai.calls.length = 0; ai.reply = AI_REPLY(); ai.status = 200;
  r = await H.session('lan', 'bep2222');
  const { w, d } = r;
  click(w, d.querySelector('[data-act=cmt-open]')); await sleep(60);
  ok(!d.getElementById('sheet').hidden && !!d.getElementById('cm_text'), 'mở màn hình dán comment');
  ok(d.getElementById('cm_date').value === TOMORROW, 'ngày mặc định là ngày mai: ' + d.getElementById('cm_date').value);
  click(w, d.querySelector('[data-act=cmt-read]')); await sleep(60);
  ok(/Dán chữ hoặc thêm ảnh/.test(d.querySelector('.banner.warn').textContent) && ai.calls.length === 0, 'bấm đọc khi chưa có gì -> nhắc, không gọi AI');
  setv(w, d.getElementById('cm_text'), PASTE);
  // thêm ảnh
  const input = d.getElementById('cm_file');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  Object.defineProperty(input, 'files', { value: [new w.File([png], 'cmt.png', { type: 'image/png' })], configurable: true });
  fire(w, input, 'change'); await sleep(250);
  ok(q(d, '.cm-th').length === 1 && d.getElementById('cm_text').value === PASTE, 'thêm được ảnh, chữ đã dán vẫn còn');
  click(w, d.querySelector('[data-act=cmt-rmimg]')); await sleep(40);
  ok(q(d, '.cm-th').length === 0 && d.getElementById('cm_text').value === PASTE, 'bỏ ảnh được, chữ vẫn còn');
  Object.defineProperty(d.getElementById('cm_file'), 'files', { value: [new w.File([png], 'cmt.png', { type: 'image/png' })], configurable: true });
  fire(w, d.getElementById('cm_file'), 'change'); await sleep(250);
  // dán ảnh từ clipboard
  const pe = new w.Event('paste', { bubbles: true, cancelable: true }); pe.clipboardData = { files: [new w.File([png], 'p.png', { type: 'image/png' })] };
  d.dispatchEvent(pe); await sleep(250);
  ok(q(d, '.cm-th').length === 2, 'dán ảnh từ clipboard (Ctrl+V) được');
  click(w, d.querySelector('[data-act=cmt-read]')); await sleep(500);
  ok(ai.calls.length === 1, 'gọi AI 1 lần');
  const sent = ai.calls[0], txt = sent.messages[0].content[0].text;
  ok(txt.includes('Chị Như : 4p đb L') && !/Trả lời|Thích|Xem 2 câu|12 giờ|Tác giả/.test(txt), 'chữ gửi AI đã bỏ các dòng giao diện Facebook (Thích, Trả lời, 12 giờ…)');
  ok(sent.messages[0].content.filter(c => c.type === 'image').length === 2 && sent.system.includes('Soup thập cẩm đặc biệt - L'), 'ảnh và menu hiện tại được gửi cùng');
  const cards = q(d, '.cm-card');
  ok(cards.length === 7 && d.querySelector('.sh-head small').textContent.includes('7 đơn') && d.querySelector('.sh-head small').textContent.includes('3 dòng'), 'hiện 7 đơn nháp, nói rõ bỏ qua 3 dòng: ' + d.querySelector('.sh-head small').textContent);
  ok(d.querySelector('.cm-ign').textContent.includes('Mỹ Hân ơi'), 'xem được các dòng đã bỏ qua');
  ok(q(d, '.cm-conf').map(x => x.textContent).join('|').includes('Nhiều chỗ chưa chắc'), 'đơn mơ hồ được đánh dấu');
  // khách cũ
  const v = id => d.getElementById(id).value;
  ok(v('cm_n0') === 'Chị Như' && v('cm_p0') === '0903111222' && v('cm_a0') === 'Sóc Trăng', 'khách cũ "Chị Như" tự điền SĐT; địa chỉ AI đọc được giữ nguyên (không bị ghi đè)');
  ok(d.getElementById('cm_c0').value === 'k1', 'Chị Như tự nối với khách cũ');
  ok(d.getElementById('cm_c3').value === '' && d.getElementById('cm_c3').options.length === 3, 'Chị Yến trùng tên 2 người -> không tự chọn, cho chọn');
  ok(!d.getElementById('cm_c2'), 'khách mới (Thuý Nguyen) không có ô chọn khách cũ');
  ok(v('cm_t3') === '06:00' && v('cm_d3') === TOMORROW && v('cm_t4') === '07:30', 'giờ AI đọc được và ngày mai mặc định đã điền');
  ok(cards[4].querySelector('[data-act=cmt-mode][data-v=lay]').getAttribute('aria-pressed') === 'true', 'đơn "qua shop" là khách ghé lấy');
  ok(d.getElementById('cm_tot0').textContent.replace(/\D/g, '') === '220000', 'tổng tiền đơn 1 = 4 × 55.000');

  // món chưa chọn chặn việc tạo
  ok(!!cards[5].querySelector('.cm-item.bad') && cards[5].textContent.includes('1 đb 60 thêm thanh cua'), 'món không khớp hiện đỏ kèm câu khách viết');
  click(w, d.querySelector('[data-act=cmt-save]')); await sleep(150);
  ok(Object.keys(data.orders).length === 0 && /Đơn 6: còn món chưa chọn/.test(d.querySelector('.banner.warn').textContent), 'còn món chưa chọn -> không tạo gì, báo rõ đơn nào');
  // sửa: chọn món cho đơn 6
  const sel6 = q(d, '[data-card="5"] select[data-cm=item-mid]')[0]; setv(w, sel6, 'dbM', 'change'); await sleep(30);
  ok(!d.querySelector('[data-card="5"] .cm-item.bad') && d.getElementById('cm_tot5').textContent.replace(/\D/g, '') === '50000', 'chọn món xong hết đỏ, tiền cập nhật');
  // tăng số lượng, thêm món trùng để thử gộp, đổi chế độ
  click(w, d.querySelector('[data-card="5"] [data-act=cmt-qty][data-d="1"]')); await sleep(20);
  ok(d.getElementById('cm_tot5').textContent.replace(/\D/g, '') === '100000', 'bấm + tăng số lượng, tiền cập nhật ngay');
  click(w, d.querySelector('[data-card="5"] [data-act=cmt-additem]')); await sleep(30);
  setv(w, q(d, '[data-card="5"] select[data-cm=item-mid]')[1], 'dbM', 'change'); await sleep(30);
  setv(w, q(d, '[data-card="5"] input[data-cm=item-note]')[1], 'ít cay'); 
  // sửa tên + SĐT đơn 3 (khách mới)
  setv(w, d.getElementById('cm_p2'), '0988000111'); setv(w, d.getElementById('cm_a2'), '5 Trần Phú');
  // bỏ tick đơn 7 (Lily Vo)
  const tick7 = d.querySelector('[data-cm=on][data-i="6"]'); tick7.checked = false; fire(w, tick7, 'change'); await sleep(30);
  ok(d.querySelector('[data-act=cmt-save]').textContent.trim() === 'Tạo 6 đơn', 'bỏ tick 1 đơn -> nút ghi "Tạo 6 đơn"');
  // chọn khách cũ cho Chị Yến (k3)
  setv(w, d.getElementById('cm_c3'), 'k3', 'change'); await sleep(30);
  ok(v('cm_p3') === '0911000002' && v('cm_a3') === 'B', 'chọn khách cũ -> điền SĐT/địa chỉ');
  click(w, d.querySelector('[data-act=cmt-save]')); await sleep(900);
  const orders = Object.values(data.orders);
  ok(orders.length === 6 && d.getElementById('sheet').hidden, 'tạo 6 đơn, đóng màn hình: ' + orders.length);
  const by = n => orders.find(o => o.name === n);
  const a = by('Chị Như');
  ok(a.date === TOMORROW && a.mode === 'giao' && a.total === 220000 && a.customerId === 'k1' && a.phone === '0903111222' && a.address === 'Sóc Trăng' && a.createdBy === 'Lan' && a.createdById === 'C1' && a.payment === 'unpaid' && !a.delivered && !a.shipperId, 'đơn Chị Như đúng ngày mai, tiền, khách cũ, người tạo, chưa thu/chưa giao');
  ok(a.items.length === 1 && a.items[0].menuId === 'dbL' && a.items[0].name === 'Soup thập cẩm đặc biệt - L' && a.items[0].price === 55000 && a.items[0].qty === 4, 'món lưu đúng tên/giá hiện tại của menu');
  const y = by('Chị Yến');
  ok(y.time === '06:00' && y.customerId === 'k3' && y.items.length === 2 && y.items[1].note.includes('không tôm'), 'đơn Chị Yến: giờ 06:00, gắn khách k3, ghi chú từng món');
  const f = by('Chị Uyên');
  ok(f.mode === 'lay' && f.time === '07:30' && f.total === 175000, 'đơn khách ghé lấy 5 × 35.000');
  const t = by('Tuyền Nguyễn');
  ok(t.items.length === 1 && t.items[0].menuId === 'dbM' && t.items[0].qty === 3 && t.items[0].note === 'ít cay' && t.total === 150000, 'món trùng được gộp thành 1 dòng (2 + 1 = 3), giữ ghi chú: ' + JSON.stringify(t.items));
  ok(!by('Lily Vo'), 'đơn bỏ tick không được tạo');
  const custNames = Object.values(data.customers).map(c => c.name).sort().join('|');
  ok(Object.keys(data.customers).length === 3 + 4 && custNames.includes('Chị Thuý Nguyen') && custNames.includes('Chị Ái Vân'), 'khách mới (4 người) được lưu; khách cũ không bị nhân đôi: ' + custNames);
  ok(by('Chị Thuý Nguyen').phone === '0988000111' && data.customers[by('Chị Thuý Nguyen').customerId].address === '5 Trần Phú', 'khách mới lưu kèm SĐT/địa chỉ đã sửa');
  ok(data.logs && Object.keys(data.logs).length === 1, 'có ghi nhật ký 1 lượt dùng AI');
  // màn hình đơn nhảy sang ngày mai và hiện đơn
  await sleep(300);
  ok(d.querySelector('.datepick b').textContent === 'Ngày mai' && names(d).includes('Chị Như') && q(d, '.ticket').length === 6, 'app chuyển sang ngày mai và hiện 6 đơn vừa tạo');
  w.close();

  // ---- lỗi AI / mạng ----
  H.resetData(seed()); ai.calls.length = 0; ai.status = 500;
  r = await H.session('lan', 'bep2222');
  click(r.w, r.d.querySelector('[data-act=cmt-open]')); await sleep(50);
  setv(r.w, r.d.getElementById('cm_text'), 'Chị A : 1 hs M');
  click(r.w, r.d.querySelector('[data-act=cmt-read]')); await sleep(400);
  ok(/Dịch vụ AI|AI/.test(r.d.querySelector('.banner.warn').textContent) && r.d.getElementById('cm_text').value === 'Chị A : 1 hs M' && Object.keys(data.orders).length === 0, 'AI lỗi -> báo dễ hiểu, chữ đã dán không mất, không tạo đơn');
  ai.status = 200; ai.reply = { orders: [], ignored: ['xin chào'] };
  click(r.w, r.d.querySelector('[data-act=cmt-read]')); await sleep(400);
  ok(/Không đọc được đơn nào/.test(r.d.querySelector('.banner.warn').textContent), 'không có đơn nào -> báo rõ');
  click(r.w, r.d.querySelector('[data-act=cmt-back]')); await sleep(40);
  ok(!!r.d.getElementById('cm_text') && r.d.getElementById('cm_text').value === 'Chị A : 1 hs M', 'nút Đọc lại quay về bước dán, giữ nguyên chữ');
  r.w.close();

  // ---- nội dung độc hại trong comment không chạy được mã ----
  H.resetData(seed()); ai.status = 200; ai.reply = { orders: [O('<img src=x onerror="window.__pwned=1">', [it('<b>x</b>', 'hsM', 1)], { raw: '<script>window.__pwned=1</script>', issues: ['<i>a</i>'] })], ignored: [] };
  r = await H.session('lan', 'bep2222');
  click(r.w, r.d.querySelector('[data-act=cmt-open]')); await sleep(50);
  setv(r.w, r.d.getElementById('cm_text'), 'x'); click(r.w, r.d.querySelector('[data-act=cmt-read]')); await sleep(400);
  ok(!r.w.__pwned && !r.d.querySelector('.cm-card img') && !r.d.querySelector('.cm-card script') && r.d.querySelector('.cm-raw').textContent.includes('<script>'), 'tên/ghi chú chứa HTML được hiển thị như chữ, không chạy');
  r.w.close();
  finish();
})().catch(e => { console.error('ERR', e); process.exit(2); });
