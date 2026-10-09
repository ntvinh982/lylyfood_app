import * as H from './harness.mjs';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const { TODAY, sleep, click } = H;
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const items = [{ menuId: 'm1', name: 'Cơm gà', price: 45000, qty: 2, note: '' }];
H.resetData({ data: {
  staff: { A1: H.mkStaff('Vinh', 'admin', 'admin'), C1: H.mkStaff('Lan', 'lan', 'cashier'), S1: H.mkStaff('Tuấn', 'tuan', 'shipper'), S2: H.mkStaff('Bình', 'binh', 'shipper') },
  menu: { m1: { name: 'Cơm gà', price: 45000, unit: 'Phần', groupId: 'g1', active: true } }, groups: { g1: { name: 'Cơm', order: 1 } }, customers: {}, settings: {},
  orders: {
    o1: { date: TODAY, time: '07:00', mode: 'giao', name: 'Chị Hoa', phone: '0900000001', address: '12 Lê Lợi', items, total: 90000, payment: 'unpaid', delivered: false, createdAt: 1, shipperId: 'S1', shipperName: 'Tuấn' },
    o2: { date: TODAY, time: '08:30', mode: 'giao', name: 'Anh Minh', phone: '0900000002', address: '5 Trần Phú', items, total: 90000, payment: 'cash', delivered: true, createdAt: 2, shipperId: 'S2', shipperName: 'Bình' },
    o3: { date: TODAY, time: '09:00', mode: 'lay', name: 'Cô Lan', phone: '0900000003', items, total: 90000, payment: 'transfer', delivered: false, createdAt: 3 },
  } }, passwords: { admin: 'bep5555', lan: 'bep2222', tuan: 'bep3333' } });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
async function shot(name, r) {
  const doc = r.d.documentElement.cloneNode(true);
  doc.querySelectorAll('script').forEach(s => s.remove());
  const base = '<base href="file://' + process.cwd() + '/web/">';
  fs.writeFileSync(OUT + '/_' + name + '.html', '<!doctype html>' + doc.outerHTML.replace('<head>', '<head>' + base));
  await page.goto('file://' + OUT + '/_' + name + '.html'); await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/' + name + '.png' });
}
let r = await H.openApp(); await shot('1-login', r); r.w.close();
r = await H.openApp({ config: null }); await shot('2-noconfig', r); r.w.close();
r = await H.session('lan', 'bep2222'); await shot('3-orders', r);
H.fake(r.w, r.d, 'layout', { v: 'table' }); await sleep(100); await shot('4-overview', r);
H.fake(r.w, r.d, 'layout', { v: 'assign' }); await sleep(100); await shot('5-assign', r); r.w.close();
r = await H.session('tuan', 'bep3333'); await shot('6-shipper', r); r.w.close();
r = await H.session('admin', 'bep5555'); H.fake(r.w, r.d, 'nav', { v: 'settings' }); await sleep(100); await shot('7-settings', r);
H.fake(r.w, r.d, 'sub-staff'); await sleep(100); await shot('8-staff', r);
click(r.w, r.d.querySelector('[data-act=edit-staff][data-id=C1]')); await sleep(100);
await shot('9-perm', r); r.w.close();
await browser.close(); process.exit(0);
