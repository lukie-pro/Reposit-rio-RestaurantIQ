import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  const { data: { session } } = await supabase.auth.getSession();

  const isAuthRoute = req.nextUrl.pathname.startsWith('/auth');
  const isDashboard = req.nextUrl.pathname.startsWith('/dashboard');

  // Não logado tentando acessar dashboard → redireciona para login
  if (!session && isDashboard) {
    return NextResponse.redirect(new URL('/auth/login', req.url));
  }

  // Logado tentando acessar login → redireciona para dashboard
  if (session && isAuthRoute) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  // Verificar se o plano ainda está ativo (para rotas de dashboard)
  if (session && isDashboard) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id, tenants(is_active, plan_expires_at)')
      .eq('id', session.user.id)
      .single();

    const tenant = (profile as any)?.tenants;
    const isPlanActive =
      tenant?.is_active &&
      (!tenant.plan_expires_at || new Date(tenant.plan_expires_at) > new Date());

    if (!isPlanActive) {
      // Redireciona para página de plano expirado
      return NextResponse.redirect(new URL('/auth/plan-expired', req.url));
    }
  }

  return res;
}

export const config = {
  matcher: ['/dashboard/:path*', '/auth/:path*'],
};
