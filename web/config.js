// Cấu hình kết nối Supabase. Khoá "anon / publishable" là khoá CÔNG KHAI, để trong code được:
// dữ liệu được bảo vệ bằng luật quyền (RLS) trong supabase/migrations, không phải bằng việc giấu khoá này.
// TUYỆT ĐỐI KHÔNG dán khoá bí mật (loại "secret" hoặc "service") vào đây.
window.LYLY_CONFIG = {
  supabaseUrl: 'https://tlspoozrrygozbvaumrz.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRsc3Bvb3pycnlnb3pidmF1bXJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MTQzNTgsImV4cCI6MjEwNzA5MDM1OH0.XFq79YZw51babaoX7h4uDYC3S1FoWUhtiTZFTnb53rI',
  // Đuôi email "giả" ghép với tên đăng nhập (vd: lan -> lan@lylyfood.app). Phải trùng với biến LOGIN_EMAIL_DOMAIN của Edge Function.
  emailDomain: 'lylyfood.app'
};
