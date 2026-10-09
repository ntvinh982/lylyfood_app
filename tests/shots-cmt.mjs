// Nhập đơn từ comment Facebook: dán chữ/ảnh -> AI (giả) -> đơn nháp -> sửa -> tạo. Dùng nội dung comment thật của quán.
import * as H from './harness.mjs';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
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


const OUT = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
async function shot(name, r, sel) {
  const doc = r.d.documentElement.cloneNode(true);
  doc.querySelectorAll('script').forEach(s => s.remove());
  const base = '<base href="file://' + process.cwd() + '/web/">';
  fs.writeFileSync(OUT + '/_' + name + '.html', '<!doctype html>' + doc.outerHTML.replace('<head>', '<head>' + base));
  await page.goto('file://' + OUT + '/_' + name + '.html'); await page.waitForTimeout(300);
  if (sel) await page.evaluate(([s, y]) => { const e = document.querySelector(s); if (e) e.scrollTop = y; }, sel);
  await page.screenshot({ path: OUT + '/' + name + '.png' });
}
H.resetData(seed()); ai.reply = AI_REPLY();
const r = await H.session('lan', 'bep2222');
await shot('c1-orders', r);
click(r.w, r.d.querySelector('[data-act=cmt-open]')); await sleep(60);
setv(r.w, r.d.getElementById('cm_text'), PASTE);
await shot('c2-input', r);
click(r.w, r.d.querySelector('[data-act=cmt-read]')); await sleep(500);
await shot('c3-review', r);
await shot('c4-review-scrolled', r, ['#sheetBox .sh-body', 1500]);
await shot('c5-review-bad', r, ['#sheetBox .sh-body', 3300]);
await browser.close(); process.exit(0);
