# Sổ Đơn Lyly Food

Web app ghi đơn cho Lyly Food: đơn hàng, khách, món, phân shipper, báo cáo, in bill. Chạy trên điện thoại/máy tính, nhiều người dùng cùng lúc, phân quyền theo từng tài khoản.

- **Giao diện**: thư mục `web/` (HTML + JS thuần, không cần build) — đặt lên GitHub Pages.
- **Dữ liệu + đăng nhập**: Supabase (Postgres). Quyền được kiểm tra **ở máy chủ** (RLS), không chỉ ở giao diện.
- **Quản lý nhân viên** (tạo/sửa/xoá tài khoản): Edge Function `staff-admin` — nơi duy nhất giữ khoá bí mật.

```
web/                       giao diện (đưa lên GitHub Pages)
supabase/migrations/       cấu trúc bảng + luật phân quyền (chạy 1 lần)
supabase/functions/staff-admin/   hàm quản lý tài khoản
supabase/functions/parse-orders/  hàm AI đọc comment Facebook → đơn nháp
scripts/import-legacy.mjs  chuyển dữ liệu từ app cũ
tests/                     bộ test (npm test)
```

## 1. Tạo dự án Supabase

1. Vào https://supabase.com → New project (chọn vùng gần Việt Nam, ví dụ Singapore). Ghi lại **mật khẩu database**.
2. **Authentication → Sign In / Providers → Email**: tắt **Allow new users to sign up** (không cho người lạ tự đăng ký), tắt **Confirm email**.
3. **SQL Editor → New query**: lần lượt dán và Run từng file trong `supabase/migrations/` theo thứ tự tên (`20261008000001_schema_and_rls.sql`, rồi `20261009000001_ai_parse_log.sql`). Chạy lại nhiều lần vẫn an toàn.
4. **Project Settings → API**: ghi lại
   - `Project URL` (dạng `https://abcd1234.supabase.co`)
   - khoá **anon / publishable** → khoá công khai, dùng cho web
   - khoá **service_role / secret** → **bí mật**, chỉ dùng ở bước 5 (script chuyển dữ liệu). Không dán vào web, không đưa lên GitHub.

## 2. Đưa hàm quản lý nhân viên lên

Cần Node.js trên máy.

```bash
npx supabase login
npx supabase functions deploy staff-admin --project-ref <mã-dự-án> --no-verify-jwt
# (tuỳ chọn) đổi đuôi email nội bộ — phải trùng web/config.js, mặc định lylyfood.app
# npx supabase secrets set LOGIN_EMAIL_DOMAIN=lylyfood.app --project-ref <mã-dự-án>
```

`<mã-dự-án>` là phần `abcd1234` trong Project URL.

### Nhập đơn từ comment Facebook (AI)

Nút **Nhập đơn từ comment Facebook** ở màn hình Đơn hàng cho phép dán chữ hoặc ảnh chụp comment, AI đọc thành *đơn nháp*, người dùng xem lại rồi mới tạo. Cần thêm một khoá API của Anthropic (tạo ở https://console.anthropic.com, mục API keys; có tính phí theo lượt dùng):

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref <mã-dự-án>
npx supabase functions deploy parse-orders --project-ref <mã-dự-án> --no-verify-jwt
# (tuỳ chọn) đổi mô hình AI, mặc định claude-sonnet-5-5:
# npx supabase secrets set PARSE_MODEL=<tên-mô-hình> --project-ref <mã-dự-án>
```

- Khoá API chỉ nằm trên Supabase, không nằm trong web. Hàm kiểm tra người gọi đang hoạt động và có quyền **tạo đơn** (quản lý, thu ngân; shipper không dùng được).
- Mỗi người tối đa 40 lượt/giờ (đổi trong `LIMITS.perHour`, file `supabase/functions/parse-orders/handler.ts`). Nhớ chạy migration `20261009000001_ai_parse_log.sql` (bước 1.3 chạy cả hai file trong `supabase/migrations/`).
- Viết tắt riêng của quán (ví dụ "gtc" = gà thanh cua) có thể thêm ở bảng `settings`: key `parse_hints`, data `{"text": "- \"gtc\" = gà thanh cua"}`.
- Ngày mặc định là **ngày mai**, chọn lại được ngay trong màn hình. Đơn nào mơ hồ sẽ bị đánh dấu và phải chọn món trước khi tạo.

## 3. Điền cấu hình web

Sửa `web/config.js`: dán `Project URL` và khoá **anon/publishable**. Khoá này công khai nên để trong code được — dữ liệu được bảo vệ bằng luật quyền ở bước 1.3.

## 4. Đưa lên GitHub Pages

1. Tạo repo trên GitHub, đẩy code lên nhánh `main`.
2. Repo → **Settings → Pages → Source: GitHub Actions**. Workflow `.github/workflows/pages.yml` tự đưa thư mục `web/` lên mạng mỗi lần push.
3. Địa chỉ dạng `https://<tên>.github.io/<repo>/`. Nhân viên mở link này, trên iPhone bấm **Chia sẻ → Thêm vào MH chính** để có biểu tượng như app.

> Gói GitHub miễn phí chỉ cho Pages với repo **công khai**. Vì vậy **không bao giờ đưa dữ liệu khách/đơn, file `legacy-export.json`, hay khoá bí mật vào repo** (đã có trong `.gitignore`).

## 5. Chuyển dữ liệu từ app cũ

File `legacy-export.json` là bản sao dữ liệu app cũ (không chứa mật khẩu). Đặt cạnh `package.json`, rồi:

```bash
npm install
# chạy thử, không ghi gì:
SUPABASE_URL=https://abcd1234.supabase.co SUPABASE_SERVICE_KEY=<khoá-bí-mật> node scripts/import-legacy.mjs legacy-export.json --dry-run
# chạy thật:
SUPABASE_URL=https://abcd1234.supabase.co SUPABASE_SERVICE_KEY=<khoá-bí-mật> node scripts/import-legacy.mjs legacy-export.json
```

- Mật khẩu cũ không chuyển được → mỗi tài khoản nhận **mật khẩu tạm** (in ra màn hình + `temp-passwords.txt`). Đưa cho từng người, bảo đổi ngay ở Cài đặt, rồi xoá file đó.
- Dữ liệu "mẫu" bị bỏ qua (thêm `--include-sample` nếu muốn giữ). Chạy lại nhiều lần an toàn.
- Nên chuyển **ngoài giờ bán**, và chốt: sau khi chuyển, mọi người dùng link mới, app cũ ngừng ghi đơn.

Cài mới hoàn toàn (không có dữ liệu cũ): tạo quản lý đầu tiên ở **Authentication → Users → Add user** (email `admin@lylyfood.app`, tick Auto Confirm), rồi trong SQL Editor:

```sql
insert into public.profiles (id, username, name, role)
select id, 'admin', 'Quản lý', 'admin' from auth.users where email = 'admin@lylyfood.app';
```

## Phân quyền

15 quyền chi tiết (xem đơn, tạo/sửa/xoá đơn, thu tiền, in, gán shipper, khách, món, cửa hàng, báo cáo…) đặt riêng cho từng tài khoản ở **Cài đặt → Nhân viên**. Mọi quyền đều được máy chủ kiểm tra: dù ai sửa mã trên trình duyệt cũng không vượt được quyền.

## Chạy test

```bash
npm install
# cần Postgres cục bộ cho 2 bài test đầu (xem đầu file tests/rls.test.mjs)
npm test
```

## Lưu ý vận hành

- **Sao lưu**: gói miễn phí của Supabase không có sao lưu tự động hằng ngày — nên xuất dữ liệu định kỳ hoặc nâng gói khi bán thật. Dự án miễn phí cũng có thể bị tạm dừng nếu ~1 tuần không ai dùng. Kiểm tra chính sách hiện hành trên trang giá của Supabase.
- Quên mật khẩu: quản lý vào **Cài đặt → Nhân viên** đặt lại.
- Đăng nhập sai nhiều lần sẽ tạm khoá trên máy đó; máy chủ còn giới hạn tần suất đăng nhập.
