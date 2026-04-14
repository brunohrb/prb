-- ============================================================
-- BANDEIRA OBRAS — INSTALAÇÃO COMPLETA (schema `obras`)
-- ============================================================
-- Execute este arquivo UMA VEZ no SQL Editor do projeto PRB:
-- https://supabase.com/dashboard/project/xuwwgprchhfshrqdhuqn/sql
--
-- Depois de rodar:
--   1. Abra: Settings → API → "Exposed schemas"
--      Adicione: obras   (separado por vírgula ao lado de public)
--   2. Abra: Storage → verifique se o bucket `obras-fotos` está Público
-- ============================================================


-- ============================================================
-- 0. EXTENSÕES (para criar usuários via SQL)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1. SCHEMA
-- ============================================================
CREATE SCHEMA IF NOT EXISTS obras;
GRANT USAGE  ON SCHEMA obras TO anon, authenticated, service_role;
GRANT ALL    ON ALL TABLES    IN SCHEMA obras TO anon, authenticated, service_role;
GRANT ALL    ON ALL SEQUENCES IN SCHEMA obras TO anon, authenticated, service_role;
GRANT ALL    ON ALL FUNCTIONS IN SCHEMA obras TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA obras
  GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA obras
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA obras
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;


-- ============================================================
-- 2. FUNÇÃO UTILITÁRIA — updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION obras.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 3. TABELAS
-- ============================================================

-- 3.1 Perfis (estende auth.users)
CREATE TABLE IF NOT EXISTS obras.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL DEFAULT 'socio' CHECK (role IN ('socio', 'responsavel')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3.2 Imóveis
CREATE TABLE IF NOT EXISTS obras.properties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  unit        TEXT,
  address     TEXT,
  created_by  UUID REFERENCES obras.profiles(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3.3 Grandes Obras (projects)
CREATE TABLE IF NOT EXISTS obras.projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  description  TEXT,
  location     TEXT,
  status       TEXT NOT NULL DEFAULT 'em_andamento'
                 CHECK (status IN ('planejamento', 'em_andamento', 'concluido', 'pausado')),
  start_date   DATE,
  end_date     DATE,
  created_by   UUID REFERENCES obras.profiles(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 3.4 Pendências de manutenção
CREATE TABLE IF NOT EXISTS obras.maintenance_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES obras.properties(id) ON DELETE CASCADE,
  project_id  UUID REFERENCES obras.projects(id)   ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  urgency     TEXT NOT NULL CHECK (urgency IN ('baixa', 'media', 'alta', 'critica')),
  deadline    DATE,
  status      TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'em_andamento', 'concluido')),
  photos      TEXT[] DEFAULT '{}',
  notes       TEXT,
  created_by  UUID REFERENCES obras.profiles(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_maint_updated_at ON obras.maintenance_requests;
CREATE TRIGGER trg_maint_updated_at BEFORE UPDATE ON obras.maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION obras.touch_updated_at();

DROP TRIGGER IF EXISTS trg_projects_updated_at ON obras.projects;
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON obras.projects
  FOR EACH ROW EXECUTE FUNCTION obras.touch_updated_at();

-- 3.5 Financeiro — gastos (pró-labore)
CREATE TABLE IF NOT EXISTS obras.expenses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description           TEXT NOT NULL,
  amount                NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  expense_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  category              TEXT NOT NULL DEFAULT 'material'
                          CHECK (category IN ('material', 'servico', 'pedreiro', 'outros')),
  service_type          TEXT,
  worker_name           TEXT,
  destination_type       TEXT NOT NULL
                          CHECK (destination_type IN ('socio', 'familia', 'obra')),
  -- Nome da entidade no PRB: 'paulo' | 'rafael' | 'bruno'
  destination_socio_name TEXT,
  destination_socio_id   UUID REFERENCES obras.profiles(id)   ON DELETE SET NULL,
  destination_family     TEXT,
  property_id           UUID REFERENCES obras.properties(id) ON DELETE SET NULL,
  project_id            UUID REFERENCES obras.projects(id)   ON DELETE SET NULL,
  paid                  BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at               TIMESTAMPTZ,
  pix_key               TEXT,
  payment_note          TEXT,
  receipt_url           TEXT,
  notes                 TEXT,
  created_by            UUID REFERENCES obras.profiles(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT expense_destination_coherence CHECK (
    (destination_type = 'socio'
       AND (destination_socio_name IS NOT NULL OR destination_socio_id IS NOT NULL)) OR
    (destination_type = 'familia' AND destination_family IS NOT NULL) OR
    (destination_type = 'obra')
  )
);

DROP TRIGGER IF EXISTS trg_expenses_updated_at ON obras.expenses;
CREATE TRIGGER trg_expenses_updated_at BEFORE UPDATE ON obras.expenses
  FOR EACH ROW EXECUTE FUNCTION obras.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_expenses_date      ON obras.expenses (expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category  ON obras.expenses (category);
CREATE INDEX IF NOT EXISTS idx_expenses_dest      ON obras.expenses (destination_type);
CREATE INDEX IF NOT EXISTS idx_expenses_paid      ON obras.expenses (paid);

-- 3.6 Notificações
CREATE TABLE IF NOT EXISTS obras.notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES obras.profiles(id) ON DELETE CASCADE,
  request_id  UUID REFERENCES obras.maintenance_requests(id) ON DELETE CASCADE,
  expense_id  UUID REFERENCES obras.expenses(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN (
                'nova_pendencia', 'concluido', 'atualizado',
                'gasto_socio', 'gasto_familia', 'gasto_obra', 'gasto_pago'
              )),
  message     TEXT NOT NULL,
  read        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 4. TRIGGER auto-criar perfil ao criar usuário no auth
-- ============================================================
CREATE OR REPLACE FUNCTION obras.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO obras.profiles (id, email, name, role)
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

-- Nome único para não colidir com trigger do sistema PRB
DROP TRIGGER IF EXISTS on_auth_user_created_obras ON auth.users;
CREATE TRIGGER on_auth_user_created_obras
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION obras.handle_new_user();


-- ============================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE obras.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras.properties            ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras.projects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras.maintenance_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras.expenses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras.notifications         ENABLE ROW LEVEL SECURITY;

-- Profiles
DROP POLICY IF EXISTS profiles_select ON obras.profiles;
DROP POLICY IF EXISTS profiles_insert ON obras.profiles;
DROP POLICY IF EXISTS profiles_update ON obras.profiles;
CREATE POLICY profiles_select ON obras.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY profiles_insert ON obras.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY profiles_update ON obras.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Properties / Projects / Requests / Expenses: todos autenticados
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['properties', 'projects', 'maintenance_requests', 'expenses']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON obras.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_insert ON obras.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_update ON obras.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_delete ON obras.%1$s', t);
    EXECUTE format('CREATE POLICY %1$s_select ON obras.%1$s FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY %1$s_insert ON obras.%1$s FOR INSERT TO authenticated WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY %1$s_update ON obras.%1$s FOR UPDATE TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY %1$s_delete ON obras.%1$s FOR DELETE TO authenticated USING (true)', t);
  END LOOP;
END $$;

-- Notifications: cada usuário vê só as suas
DROP POLICY IF EXISTS notif_select ON obras.notifications;
DROP POLICY IF EXISTS notif_insert ON obras.notifications;
DROP POLICY IF EXISTS notif_update ON obras.notifications;
DROP POLICY IF EXISTS notif_delete ON obras.notifications;
CREATE POLICY notif_select ON obras.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY notif_insert ON obras.notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY notif_update ON obras.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY notif_delete ON obras.notifications FOR DELETE TO authenticated USING (auth.uid() = user_id);


-- ============================================================
-- 6. REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE obras.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE obras.maintenance_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE obras.projects;
ALTER PUBLICATION supabase_realtime ADD TABLE obras.expenses;


-- ============================================================
-- 7. STORAGE — bucket de fotos
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('obras-fotos', 'obras-fotos', true)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'obras_fotos_insert' AND tablename = 'objects') THEN
    CREATE POLICY obras_fotos_insert ON storage.objects
      FOR INSERT TO authenticated WITH CHECK (bucket_id = 'obras-fotos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'obras_fotos_select' AND tablename = 'objects') THEN
    CREATE POLICY obras_fotos_select ON storage.objects
      FOR SELECT TO authenticated USING (bucket_id = 'obras-fotos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'obras_fotos_delete' AND tablename = 'objects') THEN
    CREATE POLICY obras_fotos_delete ON storage.objects
      FOR DELETE TO authenticated USING (bucket_id = 'obras-fotos');
  END IF;
END $$;


-- ============================================================
-- 8. FUNÇÃO PARA CRIAR USUÁRIOS VIA SQL
-- ------------------------------------------------------------
-- Uso:
--   SELECT obras.create_user('bruno', '04958346', 'Bruno', 'socio');
-- ============================================================
CREATE OR REPLACE FUNCTION obras.create_user(
  p_username TEXT,
  p_password TEXT,
  p_name     TEXT,
  p_role     TEXT DEFAULT 'socio'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email TEXT := lower(trim(p_username)) || '@bandeira.app';
  v_user_id UUID;
  v_existing UUID;
BEGIN
  -- Checa se já existe
  SELECT id INTO v_existing FROM auth.users WHERE email = v_email LIMIT 1;

  IF v_existing IS NOT NULL THEN
    -- atualiza a senha e o perfil
    UPDATE auth.users
      SET encrypted_password = crypt(p_password, gen_salt('bf')),
          raw_user_meta_data = jsonb_build_object('name', p_name, 'role', p_role),
          email_confirmed_at = NOW(),
          updated_at = NOW()
      WHERE id = v_existing;

    INSERT INTO obras.profiles (id, email, name, role)
      VALUES (v_existing, v_email, p_name, p_role)
      ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            role = EXCLUDED.role,
            email = EXCLUDED.email;

    RETURN v_existing;
  END IF;

  -- Cria usuário novo
  v_user_id := gen_random_uuid();

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, email_change,
    email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated', 'authenticated',
    v_email,
    crypt(p_password, gen_salt('bf')),
    NOW(), NOW(), NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('name', p_name, 'role', p_role),
    FALSE, '', '', '', ''
  );

  -- auth.identities (obrigatório p/ login funcionar)
  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data,
    provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    v_user_id,
    v_user_id::text,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
    'email', NOW(), NOW(), NOW()
  );

  -- Profile (caso o trigger não tenha rodado)
  INSERT INTO obras.profiles (id, email, name, role)
    VALUES (v_user_id, v_email, p_name, p_role)
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          role = EXCLUDED.role;

  RETURN v_user_id;
END;
$$;


-- ============================================================
-- 9. CRIAÇÃO DOS USUÁRIOS
-- ------------------------------------------------------------
-- Sócios:       bruno, paulo, rafael, cassiano
-- Responsáveis: ellen, tatiana
-- (caso o papel esteja errado, basta rodar um UPDATE depois)
-- ============================================================
SELECT obras.create_user('bruno',    '04958346', 'Bruno',    'socio');
SELECT obras.create_user('paulo',    '186207',   'Paulo',    'socio');
SELECT obras.create_user('rafael',   '174707',   'Rafael',   'socio');
SELECT obras.create_user('cassiano', '123456',   'Cassiano', 'socio');
SELECT obras.create_user('ellen',    '04958346', 'Ellen',    'responsavel');
SELECT obras.create_user('tatiana',  '186207',   'Tatiana',  'responsavel');

-- Para mudar o papel de alguém depois:
-- UPDATE obras.profiles SET role = 'responsavel' WHERE email = 'bruno@bandeira.app';
-- UPDATE obras.profiles SET role = 'socio'       WHERE email = 'ellen@bandeira.app';

-- ============================================================
-- FIM — aguarde alguns segundos e pronto!
-- Lembre-se de expor o schema "obras" em Settings → API.
-- ============================================================
