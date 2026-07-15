import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const { fullName, restaurantName, email, password, keyCode } = await req.json();

  // 1. Validar campos
  if (!fullName || !restaurantName || !email || !password || !keyCode) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'password_too_short' }, { status: 400 });
  }

  // 2. Criar usuário no Supabase Auth
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: false, // envia e-mail de confirmação
    user_metadata: { full_name: fullName },
  });

  if (authError) {
    if (authError.message.includes('already registered')) {
      return NextResponse.json({ error: 'email_already_exists' }, { status: 409 });
    }
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  const userId = authData.user.id;

  // 3. Gerar slug do tenant
  const slug = restaurantName
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // 4. Ativar chave e criar tenant (função transacional no DB)
  const { data: activation, error: activationError } = await supabaseAdmin
    .rpc('activate_access_key', {
      p_key_code: keyCode.toUpperCase().trim(),
      p_user_id: userId,
      p_tenant_name: restaurantName,
      p_tenant_slug: slug,
    });

  if (activationError || !activation?.ok) {
    // Rollback: deletar usuário criado
    await supabaseAdmin.auth.admin.deleteUser(userId);

    const errorMap: Record<string, string> = {
      key_not_found: 'Chave de acesso não encontrada',
      key_already_used: 'Essa chave já foi utilizada',
      key_expired: 'Essa chave expirou',
    };

    const errorCode = activation?.error ?? 'activation_failed';
    return NextResponse.json(
      { error: errorCode, message: errorMap[errorCode] ?? 'Erro ao ativar conta' },
      { status: 400 }
    );
  }

  // 5. Sucesso
  return NextResponse.json({
    success: true,
    message: 'Conta criada! Verifique seu e-mail para confirmar.',
    plan: activation.plan,
  });
}
