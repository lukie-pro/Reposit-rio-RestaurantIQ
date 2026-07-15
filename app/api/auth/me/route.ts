import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, tenants(id, name, plan, is_active, plan_expires_at)')
    .eq('id', user.id)
    .single();

  // Verificar se plano está ativo
  const tenant = profile?.tenants;
  const isPlanActive =
    tenant?.is_active &&
    (!tenant.plan_expires_at || new Date(tenant.plan_expires_at) > new Date());

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: profile?.full_name,
      role: profile?.role,
    },
    tenant: tenant ? {
      id: tenant.id,
      name: tenant.name,
      plan: tenant.plan,
      isActive: isPlanActive,
    } : null,
    hasAccess: isPlanActive,
  });
}
