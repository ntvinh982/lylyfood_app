import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './handler.ts';

// SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY do Supabase tự cấp cho Edge Function.
// LOGIN_EMAIL_DOMAIN: đuôi email "giả" ghép với tên đăng nhập (mặc định lylyfood.app). Phải trùng với web/config.js.
const env = {
  url: Deno.env.get('SUPABASE_URL')!,
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  emailDomain: Deno.env.get('LOGIN_EMAIL_DOMAIN') ?? 'lylyfood.app',
};

Deno.serve((req) => handle(req, {
  env,
  makeAdminClient: () => createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }),
}));
