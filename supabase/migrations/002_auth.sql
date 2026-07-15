-- RestaurantIQ — Autenticação: controle de acesso por chave de pagamento + Supabase Auth
-- Execute no SQL Editor do Supabase, após 001_schema.sql

-- ═══════════════════════════════════════════════════════════════
-- 1. TENANTS (um por restaurante/empresa) — versão com plano/expiração
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE public.tenants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  slug         TEXT UNIQUE,
  plan         TEXT NOT NULL DEFAULT 'starter',
  plan_expires_at TIMESTAMPTZ,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  settings     JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- 2. PROFILES (dados extras do usuário, além do auth.users)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id     UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  full_name     TEXT,
  role          TEXT NOT NULL DEFAULT 'owner', -- owner | manager | staff
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- 3. CHAVES DE ACESSO (geradas pelo dono do SaaS após pagamento)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE public.access_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_code      TEXT UNIQUE NOT NULL, -- ex: RIQ-XXXX-XXXX-XXXX
  plan          TEXT NOT NULL DEFAULT 'pro',
  is_used       BOOLEAN NOT NULL DEFAULT FALSE,
  used_by       UUID REFERENCES auth.users(id),
  used_at       TIMESTAMPTZ,
  tenant_id     UUID REFERENCES public.tenants(id),
  expires_at    TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.access_keys ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- 4. ROW LEVEL SECURITY POLICIES
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY "tenant_select_own"
  ON public.tenants FOR SELECT
  USING (
    id IN (
      SELECT tenant_id FROM public.profiles
      WHERE id = auth.uid()
    )
  );

CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "profiles_select_same_tenant"
  ON public.profiles FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
  );

-- ACCESS KEYS: nenhum usuário pode ler (apenas server-side via service_role)
-- A validação acontece via Edge Function, não exposta ao client

-- ═══════════════════════════════════════════════════════════════
-- 5. TRIGGER: criar profile automaticamente após signup
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Novo usuário')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════
-- 6. FUNÇÃO: validar e consumir chave de acesso (SECURITY DEFINER)
-- Chamada pelo backend com service_role — nunca exposta ao client
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.activate_access_key(
  p_key_code  TEXT,
  p_user_id   UUID,
  p_tenant_name TEXT,
  p_tenant_slug TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_key       access_keys%ROWTYPE;
  v_tenant_id UUID;
BEGIN
  SELECT * INTO v_key
  FROM public.access_keys
  WHERE key_code = p_key_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'key_not_found');
  END IF;

  IF v_key.is_used THEN
    RETURN jsonb_build_object('ok', false, 'error', 'key_already_used');
  END IF;

  IF v_key.expires_at IS NOT NULL AND v_key.expires_at < NOW() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'key_expired');
  END IF;

  INSERT INTO public.tenants (name, slug, plan)
  VALUES (p_tenant_name, p_tenant_slug, v_key.plan)
  RETURNING id INTO v_tenant_id;

  UPDATE public.profiles
  SET tenant_id = v_tenant_id,
      role = 'owner',
      updated_at = NOW()
  WHERE id = p_user_id;

  UPDATE public.access_keys
  SET is_used = TRUE,
      used_by = p_user_id,
      used_at = NOW(),
      tenant_id = v_tenant_id
  WHERE id = v_key.id;

  RETURN jsonb_build_object(
    'ok', true,
    'tenant_id', v_tenant_id,
    'plan', v_key.plan
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 7. GERAR CHAVES DE ACESSO (rode quando vender um plano)
-- Gera uma chave no formato RIQ-XXXX-XXXX-XXXX
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.generate_access_key(p_plan TEXT, p_notes TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code TEXT;
  v_chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- sem I,O,0,1 (confusos)
  v_segment TEXT;
  i INTEGER;
  j INTEGER;
BEGIN
  LOOP
    v_code := 'RIQ';
    FOR i IN 1..3 LOOP
      v_segment := '';
      FOR j IN 1..4 LOOP
        v_segment := v_segment || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
      END LOOP;
      v_code := v_code || '-' || v_segment;
    END LOOP;

    BEGIN
      INSERT INTO public.access_keys (key_code, plan, notes)
      VALUES (v_code, p_plan, p_notes);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      CONTINUE;
    END;
  END LOOP;

  RETURN v_code;
END;
$$;

-- Exemplo de uso — gerar 5 chaves Pro:
-- SELECT public.generate_access_key('pro', 'Lote maio/2025') FROM generate_series(1,5);
