// Tạo / sửa / xoá tài khoản nhân viên. Chỉ quản lý đang hoạt động mới gọi được.
// Phải chạy phía máy chủ vì cần service role key (không bao giờ đưa key này ra trình duyệt).

export const ALL_PERMS = [
  'order.all', 'order.create', 'order.edit', 'order.pay', 'order.print', 'order.assign', 'order.delete',
  'cust.view', 'cust.edit', 'cust.delete', 'cust.import',
  'menu.edit', 'menu.delete', 'shop.edit', 'report.view',
];
const ROLES = ['admin', 'cashier', 'shipper'];
const WEAK = ['123456', '1234567', '12345678', '123456789', '654321', 'password', 'matkhau', 'abc123', 'qwerty', '000000', '111111'];
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// deno-lint-ignore no-explicit-any
type Any = any;
export interface Deps {
  env: { url: string; serviceKey: string; emailDomain: string };
  makeAdminClient: () => Any; // supabase-js client dùng service role
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export function pwProblem(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 6) return 'Mật khẩu ít nhất 6 ký tự.';
  if (pw.length > 72) return 'Mật khẩu quá dài (tối đa 72 ký tự).';
  if (/^(.)\1+$/.test(pw) || WEAK.includes(pw.toLowerCase())) return 'Mật khẩu quá dễ đoán, đặt khó hơn nhé.';
  return '';
}

function cleanPerms(p: unknown): Record<string, boolean> {
  if (p == null) return {};
  if (typeof p !== 'object' || Array.isArray(p)) throw new HttpError(400, 'Quyền không hợp lệ.');
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    if (!ALL_PERMS.includes(k) || typeof v !== 'boolean') throw new HttpError(400, 'Quyền không hợp lệ: ' + k);
    out[k] = v;
  }
  return out;
}

function checkUsername(u: unknown): string {
  const s = String(u ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,}$/.test(s)) throw new HttpError(400, 'Tên đăng nhập: ít nhất 3 ký tự, không dấu, không cách.');
  return s;
}
function checkName(n: unknown): string {
  const s = String(n ?? '').trim();
  if (!s || s.length > 100) throw new HttpError(400, 'Nhập họ tên (tối đa 100 ký tự).');
  return s;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Chỉ nhận POST.' });
  try {
    const admin = deps.makeAdminClient();
    const email = (u: string) => `${u}@${deps.env.emailDomain}`;

    // 1. Ai đang gọi? Xác thực token, rồi kiểm tra là quản lý đang hoạt động.
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw new HttpError(401, 'Chưa đăng nhập.');
    const { data: u, error: uerr } = await admin.auth.getUser(token);
    if (uerr || !u?.user) throw new HttpError(401, 'Phiên đăng nhập hết hạn, đăng nhập lại nhé.');
    const { data: me } = await admin.from('profiles').select('id,name,role,active').eq('id', u.user.id).maybeSingle();
    if (!me || !me.active || me.role !== 'admin') throw new HttpError(403, 'Chỉ quản lý được làm việc này.');

    let body: Any;
    try { body = await req.json(); } catch { throw new HttpError(400, 'Dữ liệu gửi lên không đọc được.'); }
    const action = body?.action;

    // ---- Tạo mới ----
    if (action === 'create') {
      const username = checkUsername(body.username), name = checkName(body.name);
      const role = body.role;
      if (!ROLES.includes(role)) throw new HttpError(400, 'Vai trò không hợp lệ.');
      const pe = pwProblem(body.password); if (pe) throw new HttpError(400, pe);
      const perms = role === 'admin' ? {} : cleanPerms(body.perms);
      const { data: dup } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
      if (dup) throw new HttpError(409, 'Tên đăng nhập này đã có người dùng.');
      const { data: made, error: cerr } = await admin.auth.admin.createUser({
        email: email(username), password: body.password, email_confirm: true, user_metadata: { username },
      });
      if (cerr || !made?.user) throw new HttpError(/registered|exists/i.test(cerr?.message ?? '') ? 409 : 400, /registered|exists/i.test(cerr?.message ?? '') ? 'Tên đăng nhập này đã có người dùng.' : 'Không tạo được tài khoản: ' + (cerr?.message ?? ''));
      const { error: perr } = await admin.from('profiles').insert({ id: made.user.id, username, name, role, active: true, perms, updated_by: me.name });
      if (perr) { await admin.auth.admin.deleteUser(made.user.id); throw new HttpError(perr.code === '23505' ? 409 : 400, perr.code === '23505' ? 'Tên đăng nhập này đã có người dùng.' : 'Không lưu được hồ sơ: ' + perr.message); }
      return reply(200, { ok: true, id: made.user.id });
    }

    // ---- Sửa ----
    if (action === 'update') {
      const id = String(body.id ?? '');
      const { data: t } = await admin.from('profiles').select('*').eq('id', id).maybeSingle();
      if (!t) throw new HttpError(404, 'Không tìm thấy tài khoản.');
      const patch: Record<string, unknown> = { updated_by: me.name };
      const authPatch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = checkName(body.name);
      if (body.username !== undefined) {
        const un = checkUsername(body.username);
        if (un !== t.username) {
          const { data: dup } = await admin.from('profiles').select('id').eq('username', un).maybeSingle();
          if (dup) throw new HttpError(409, 'Tên đăng nhập này đã có người dùng.');
          patch.username = un; authPatch.email = email(un); authPatch.email_confirm = true;
        }
      }
      const role = body.role !== undefined ? body.role : t.role;
      if (!ROLES.includes(role)) throw new HttpError(400, 'Vai trò không hợp lệ.');
      const active = body.active !== undefined ? !!body.active : t.active;
      if (id === me.id && (role !== t.role || !active)) throw new HttpError(400, 'Không tự đổi vai trò hoặc khoá tài khoản của mình.');
      patch.role = role; patch.active = active;
      patch.perms = role === 'admin' ? {} : (body.perms !== undefined ? cleanPerms(body.perms) : t.perms);
      if (body.password) { const pe = pwProblem(body.password); if (pe) throw new HttpError(400, pe); authPatch.password = body.password; }
      if (active !== t.active) authPatch.ban_duration = active ? 'none' : '876000h';
      // Cập nhật hồ sơ trước: trigger trong DB chặn việc hạ/khoá quản lý cuối cùng.
      const { error: perr } = await admin.from('profiles').update(patch).eq('id', id);
      if (perr) throw new HttpError(/quản lý/.test(perr.message) ? 400 : perr.code === '23505' ? 409 : 400, /quản lý/.test(perr.message) ? perr.message : perr.code === '23505' ? 'Tên đăng nhập này đã có người dùng.' : 'Không lưu được: ' + perr.message);
      if (Object.keys(authPatch).length) {
        const { error: aerr } = await admin.auth.admin.updateUserById(id, authPatch);
        if (aerr) throw new HttpError(400, 'Đã lưu hồ sơ nhưng chưa đổi được thông tin đăng nhập: ' + aerr.message);
      }
      return reply(200, { ok: true });
    }

    // ---- Xoá ----
    if (action === 'delete') {
      const id = String(body.id ?? '');
      if (id === me.id) throw new HttpError(400, 'Không tự xoá tài khoản của mình.');
      const { data: t } = await admin.from('profiles').select('id').eq('id', id).maybeSingle();
      if (!t) throw new HttpError(404, 'Không tìm thấy tài khoản.');
      const { error: derr } = await admin.auth.admin.deleteUser(id);
      if (derr) throw new HttpError(/quản lý/.test(derr.message) ? 400 : 500, /quản lý/.test(derr.message) ? 'Phải còn ít nhất 1 quản lý đang hoạt động.' : 'Không xoá được: ' + derr.message);
      return reply(200, { ok: true });
    }

    throw new HttpError(400, 'Thao tác không hợp lệ.');
  } catch (e) {
    if (e instanceof HttpError) return reply(e.status, { error: e.message });
    console.error(e);
    return reply(500, { error: 'Lỗi máy chủ, thử lại sau.' });
  }
}
