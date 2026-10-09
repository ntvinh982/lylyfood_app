#!/usr/bin/env node
// Chuyển dữ liệu từ app cũ (file legacy-export.json) sang Supabase.
//
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_KEY=<secret key> node scripts/import-legacy.mjs legacy-export.json [--dry-run] [--include-sample]
//
// - Chạy trên MÁY CỦA ANH, một lần duy nhất. Khoá "service_role / secret" chỉ dùng ở đây, không dán vào web/config.js.
// - Chạy lại nhiều lần vẫn an toàn (ghi đè theo mã, không nhân đôi).
// - Mật khẩu cũ KHÔNG chuyển được (đã băm kiểu khác) nên mỗi tài khoản nhận mật khẩu tạm mới, in ra cuối cùng.
// - Mặc định bỏ qua dữ liệu "mẫu" (đơn/khách/món có sample=true); thêm --include-sample nếu muốn giữ.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const ALL_PERMS = ['order.all', 'order.create', 'order.edit', 'order.pay', 'order.print', 'order.assign', 'order.delete', 'cust.view', 'cust.edit', 'cust.delete', 'cust.import', 'menu.edit', 'menu.delete', 'shop.edit', 'report.view'];
const iso = ms => new Date(Number(ms) > 0 ? Number(ms) : Date.now()).toISOString();
const str = (v, max) => String(v ?? '').slice(0, max);
const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
const PAY = ['unpaid', 'cash', 'transfer', 'free'];
const genPw = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (const b of crypto.randomBytes(8)) s += a[b % a.length]; return s + crypto.randomInt(10, 99); };

export function mapRole(r) { return r === 'admin' ? 'admin' : r === 'shipper' ? 'shipper' : 'cashier'; } // role cũ "staff" -> thu ngân
export function mapPerms(p, role) {
  if (role === 'admin' || !p || typeof p !== 'object') return {};
  const o = {}; for (const [k, v] of Object.entries(p)) if (ALL_PERMS.includes(k) && typeof v === 'boolean') o[k] = v; return o;
}
export const mapGroup = (id, d) => ({ id, name: str(d.name, 100).trim() || 'Nhóm', sort_order: Math.trunc(Number(d.order) || 0), sample: !!d.sample, created_at: iso(d.createdAt) });
export const mapMenu = (id, d) => ({ id, name: str(d.name, 200).trim() || 'Món', price: num(d.price), unit: str(d.unit, 50), group_id: d.groupId || null, active: d.active !== false, sample: !!d.sample, created_at: iso(d.createdAt) });
export const mapCustomer = (id, d) => ({ id, name: str(d.name, 200).trim() || str(d.phone, 40) || 'Khách', phone: str(d.phone, 40), address: str(d.address, 500), note: str(d.note, 1000), sample: !!d.sample, imported: !!d.imported, created_at: iso(d.createdAt) });
export function mapOrder(id, d, staffMap) {
  const shipper = d.shipperId && staffMap[d.shipperId] ? staffMap[d.shipperId] : null;
  return {
    id, date: str(d.date, 10), time: /^\d{2}:\d{2}$/.test(d.time || '') ? d.time : '', mode: d.mode === 'lay' ? 'lay' : 'giao',
    customer_id: d.customerId || null, name: str(d.name, 200), phone: str(d.phone, 40), address: str(d.address, 500),
    items: Array.isArray(d.items) ? d.items.slice(0, 200) : [], total: num(d.total), note: str(d.note, 2000),
    payment: PAY.includes(d.payment) ? d.payment : 'unpaid', no_collect: !!d.noCollect, delivered: !!d.delivered,
    shipper_id: shipper, shipper_name: shipper ? str(d.shipperName, 100) : '',
    sample: !!d.sample, created_by: str(d.createdBy, 100), created_by_id: d.createdById && staffMap[d.createdById] ? staffMap[d.createdById] : null,
    updated_by: str(d.updatedBy, 100), created_at: iso(d.createdAt), updated_at: iso(d.updatedAt || d.createdAt),
  };
}

async function upsertAll(sb, table, rows, key = 'id') {
  for (let i = 0; i < rows.length; i += 300) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 300), { onConflict: key });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

// sb: supabase-js client (service role). Trả về {summary, tempPasswords, staffMap}
export async function importLegacy(legacy, sb, { emailDomain = 'lylyfood.app', dryRun = false, includeSample = false, log = console.log, genPassword = genPw } = {}) {
  const keep = d => includeSample || !d.sample;
  const summary = {}, tempPasswords = [], staffMap = {};

  // 1. Tài khoản nhân viên
  const staffEntries = Object.entries(legacy.staff || {});
  const usernames = new Set();
  for (const [oldId, d] of staffEntries) {
    const username = String(d.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,}$/.test(username)) throw new Error(`Tên đăng nhập không hợp lệ: "${d.username}" (tài khoản ${oldId}). Sửa trong file rồi chạy lại.`);
    if (usernames.has(username)) throw new Error(`Trùng tên đăng nhập: ${username}`); usernames.add(username);
  }
  if (!staffEntries.some(([, d]) => d.role === 'admin' && d.active !== false)) throw new Error('Không có quản lý nào đang hoạt động trong dữ liệu cũ.');
  for (const [oldId, d] of staffEntries) {
    const username = String(d.username).trim().toLowerCase(), role = mapRole(d.role);
    const { data: ex, error: e0 } = await sb.from('profiles').select('id').eq('username', username).maybeSingle();
    if (e0) throw new Error('profiles: ' + e0.message);
    if (ex) { staffMap[oldId] = ex.id; log(`  = ${username}: đã có, giữ nguyên`); continue; }
    if (dryRun) { staffMap[oldId] = '00000000-0000-0000-0000-' + String(Object.keys(staffMap).length).padStart(12, '0'); tempPasswords.push({ username, password: '(chạy thật mới có)' }); continue; }
    const password = genPassword();
    const { data: made, error: e1 } = await sb.auth.admin.createUser({ email: `${username}@${emailDomain}`, password, email_confirm: true, user_metadata: { username } });
    if (e1 || !made || !made.user) throw new Error(`Không tạo được tài khoản ${username}: ${e1 ? e1.message : 'không rõ lỗi'}`);
    const prof = { id: made.user.id, username, name: str(d.name, 100).trim() || username, role, active: d.active !== false, perms: mapPerms(d.perms, role), theme: ['light', 'dark', 'system'].includes(d.theme) ? d.theme : null, created_at: iso(d.createdAt), updated_by: 'import' };
    const { error: e2 } = await sb.from('profiles').insert(prof);
    if (e2) { await sb.auth.admin.deleteUser(made.user.id); throw new Error(`Không lưu được hồ sơ ${username}: ${e2.message}`); }
    // tài khoản bị khoá ở app cũ -> khoá luôn đăng nhập ở Supabase
    if (d.active === false) await sb.auth.admin.updateUserById(made.user.id, { ban_duration: '876000h' });
    staffMap[oldId] = made.user.id; tempPasswords.push({ username, password });
    log(`  + ${username} (${role})`);
  }
  summary.staff = staffEntries.length;

  // 2. Dữ liệu còn lại
  const sets = [
    ['menu_groups', Object.entries(legacy.groups || {}).filter(([, d]) => keep(d)).map(([id, d]) => mapGroup(id, d)), 'id'],
    ['menu_items', Object.entries(legacy.menu || {}).filter(([, d]) => keep(d)).map(([id, d]) => mapMenu(id, d)), 'id'],
    ['customers', Object.entries(legacy.customers || {}).filter(([, d]) => keep(d)).map(([id, d]) => mapCustomer(id, d)), 'id'],
    ['orders', Object.entries(legacy.orders || {}).filter(([, d]) => keep(d)).map(([id, d]) => mapOrder(id, d, staffMap)), 'id'],
    ['settings', Object.entries(legacy.settings || {}).map(([key, d]) => ({ key, data: d && typeof d === 'object' ? d : {} })), 'key'],
  ];
  for (const [table, rows, key] of sets) {
    summary[table] = rows.length;
    if (!dryRun && rows.length) await upsertAll(sb, table, rows, key);
    log(`  ${dryRun ? '(thử) ' : ''}${table}: ${rows.length} dòng`);
  }
  return { summary, tempPasswords, staffMap };
}

// ---- chạy từ dòng lệnh ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), file = args.find(a => !a.startsWith('--'));
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!file || !url || !key) { console.error('Cách dùng: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/import-legacy.mjs legacy-export.json [--dry-run] [--include-sample]'); process.exit(1); }
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const dryRun = args.includes('--dry-run');
  console.log(dryRun ? 'CHẠY THỬ (không ghi gì):' : 'Đang nhập dữ liệu...');
  const r = await importLegacy(JSON.parse(fs.readFileSync(file, 'utf8')), sb, { emailDomain: process.env.LOGIN_EMAIL_DOMAIN || 'lylyfood.app', dryRun, includeSample: args.includes('--include-sample') });
  if (r.tempPasswords.length) {
    console.log('\nMật khẩu tạm (đưa cho từng người, bảo họ đổi ngay trong Cài đặt):');
    for (const t of r.tempPasswords) console.log(`  ${t.username.padEnd(16)} ${t.password}`);
    if (!dryRun) { fs.writeFileSync('temp-passwords.txt', r.tempPasswords.map(t => `${t.username}\t${t.password}`).join('\n') + '\n', { mode: 0o600 }); console.log('\n(Đã lưu thêm vào temp-passwords.txt — đọc xong nhớ xoá file này.)'); }
  }
  console.log('\nXong.', JSON.stringify(r.summary));
}
