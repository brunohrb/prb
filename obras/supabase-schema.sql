-- =============================================
-- BANDEIRA OBRAS - Schema do Supabase
-- Execute este arquivo no SQL Editor do Supabase
-- Acesse: supabase.com → Seu projeto → SQL Editor
-- =============================================

-- ============================================================
-- 1. TABELA DE PERFIS (estende auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL DEFAULT 'socio' CHECK (role IN ('socio', 'responsavel')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Cria perfil automaticamente quando usuário faz signup
-- ⚠️  SAFE: função e trigger com nome único "_obras" para não conflitar com outros sistemas
CREATE OR REPLACE FUNCTION public.handle_new_user_obras()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'socio')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Nome único para não sobrescrever trigger de outros sistemas (ex: on_auth_user_created)
DROP TRIGGER IF EXISTS on_auth_user_created_obras ON auth.users;
CREATE TRIGGER on_auth_user_created_obras
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_obras();

-- ============================================================
-- 2. TABELA DE IMÓVEIS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.properties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  unit        TEXT,
  address     TEXT,
  created_by  UUID REFERENCES public.profiles(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. TABELA DE PENDÊNCIAS (maintenance_requests)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.maintenance_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  urgency     TEXT NOT NULL CHECK (urgency IN ('baixa', 'media', 'alta', 'critica')),
  deadline    DATE,
  status      TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'em_andamento', 'concluido')),
  photos      TEXT[] DEFAULT '{}',
  notes       TEXT,
  created_by  UUID REFERENCES public.profiles(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_maintenance_requests_updated_at ON public.maintenance_requests;
CREATE TRIGGER update_maintenance_requests_updated_at
  BEFORE UPDATE ON public.maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 4. TABELA DE NOTIFICAÇÕES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_id  UUID REFERENCES public.maintenance_requests(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('nova_pendencia', 'concluido', 'atualizado')),
  message     TEXT NOT NULL,
  read        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 5. ROW LEVEL SECURITY (RLS) - Segurança
-- ============================================================

-- Habilita RLS em todas as tabelas
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- PROFILES: qualquer usuário autenticado pode ver todos os perfis
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

-- PROPERTIES: qualquer usuário autenticado pode ver e gerenciar
CREATE POLICY "properties_select" ON public.properties
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "properties_insert" ON public.properties
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "properties_update" ON public.properties
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "properties_delete" ON public.properties
  FOR DELETE TO authenticated USING (true);

-- MAINTENANCE_REQUESTS: qualquer usuário autenticado pode ver e gerenciar
CREATE POLICY "requests_select" ON public.maintenance_requests
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "requests_insert" ON public.maintenance_requests
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "requests_update" ON public.maintenance_requests
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "requests_delete" ON public.maintenance_requests
  FOR DELETE TO authenticated USING (true);

-- NOTIFICATIONS: cada usuário vê apenas as suas
CREATE POLICY "notif_select" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "notif_insert" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "notif_update" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "notif_delete" ON public.notifications
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 6. REALTIME - Habilitar para notificações em tempo real
-- ============================================================
-- ⚠️  SAFE: usa ALTER para ADICIONAR tabelas à publicação existente
-- Não remove nem recria a publicação (não quebra outros sistemas)
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.maintenance_requests;

-- ============================================================
-- 7. STORAGE - Bucket para fotos
-- ============================================================
-- Execute no Supabase Dashboard → Storage → New Bucket:
-- Nome: obras-fotos
-- Public: SIM (marcar como público)

-- Ou via SQL:
INSERT INTO storage.buckets (id, name, public)
VALUES ('obras-fotos', 'obras-fotos', true)
ON CONFLICT (id) DO NOTHING;

-- Policy de storage: qualquer autenticado pode fazer upload
-- ⚠️  SAFE: políticas com nome único para não conflitar com outros sistemas
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'obras_fotos_insert' AND tablename = 'objects') THEN
    CREATE POLICY "obras_fotos_insert" ON storage.objects
      FOR INSERT TO authenticated WITH CHECK (bucket_id = 'obras-fotos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'obras_fotos_select' AND tablename = 'objects') THEN
    CREATE POLICY "obras_fotos_select" ON storage.objects
      FOR SELECT TO authenticated USING (bucket_id = 'obras-fotos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'obras_fotos_delete' AND tablename = 'objects') THEN
    CREATE POLICY "obras_fotos_delete" ON storage.objects
      FOR DELETE TO authenticated USING (bucket_id = 'obras-fotos' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
END $$;

-- ============================================================
-- 8. DADOS INICIAIS (opcional - insira seu primeiro usuário)
-- ============================================================
-- Depois de criar seu usuário via Supabase Authentication → Users,
-- atualize o perfil dele para 'socio' ou 'responsavel':
--
-- UPDATE public.profiles SET role = 'socio', name = 'Seu Nome' WHERE email = 'seu@email.com';
-- UPDATE public.profiles SET role = 'responsavel', name = 'Nome Responsável' WHERE email = 'responsavel@email.com';

-- ============================================================
-- PRONTO! Execute este SQL e o banco estará configurado.
-- ============================================================
