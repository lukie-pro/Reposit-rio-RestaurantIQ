'use client';
import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';

interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  tenant: {
    id: string;
    name: string;
    plan: string;
    isActive: boolean;
  } | null;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClientComponentClient();
  const router = useRouter();

  useEffect(() => {
    const fetchUser = async () => {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.hasAccess ? { ...data.user, tenant: data.tenant } : null);
      }
      setLoading(false);
    };

    fetchUser();

    const { data: listener } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_IN') fetchUser();
      if (event === 'SIGNED_OUT') { setUser(null); router.push('/auth/login'); }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    router.push('/auth/login');
  };

  return { user, loading, logout };
}
