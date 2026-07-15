import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Service role key — NUNCA exposta no client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const { keyCode } = await req.json();

  if (!keyCode || typeof keyCode !== 'string') {
    return NextResponse.json({ valid: false, error: 'invalid_input' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('access_keys')
    .select('plan, is_used, expires_at')
    .eq('key_code', keyCode.toUpperCase().trim())
    .single();

  if (error || !data) {
    return NextResponse.json({ valid: false, error: 'key_not_found' });
  }

  if (data.is_used) {
    return NextResponse.json({ valid: false, error: 'key_already_used' });
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ valid: false, error: 'key_expired' });
  }

  // Só retorna o plano — sem dados sensíveis
  return NextResponse.json({ valid: true, plan: data.plan });
}
