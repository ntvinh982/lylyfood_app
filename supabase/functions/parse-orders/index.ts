import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './handler.ts';

// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: Supabase tự cấp. ANTHROPIC_API_KEY: tự cài bằng `supabase secrets set`.
// PARSE_MODEL (tuỳ chọn): tên mô hình AI, mặc định claude-sonnet-5-5.
const url = Deno.env.get('SUPABASE_URL')!, serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const env = { anthropicKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '', model: Deno.env.get('PARSE_MODEL') ?? 'claude-sonnet-5-5' };

Deno.serve((req) => handle(req, {
  env,
  makeAdminClient: () => createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }),
}));
