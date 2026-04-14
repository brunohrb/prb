-- ============================================================
-- BANDEIRA OBRAS — PATCH 02
-- Corrige RLS das tabelas do schema obras
-- ============================================================
-- Execute no SQL Editor se der "new row violates row-level
-- security policy" ao lançar qualquer registro.
-- ============================================================

ALTER TABLE obras.profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras.properties           ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras.projects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras.maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras.expenses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras.notifications        ENABLE ROW LEVEL SECURITY;

-- Derruba todas as policies antigas de cada tabela
DO $$
DECLARE
  t TEXT;
  pol RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','properties','projects','maintenance_requests','expenses','notifications']
  LOOP
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'obras' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON obras.%I', pol.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- Recria policies liberando tudo para qualquer usuário autenticado
CREATE POLICY p_select ON obras.profiles             FOR SELECT TO authenticated USING (true);
CREATE POLICY p_update ON obras.profiles             FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY prop_select ON obras.properties        FOR SELECT TO authenticated USING (true);
CREATE POLICY prop_insert ON obras.properties        FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY prop_update ON obras.properties        FOR UPDATE TO authenticated USING (true);
CREATE POLICY prop_delete ON obras.properties        FOR DELETE TO authenticated USING (true);

CREATE POLICY proj_select ON obras.projects          FOR SELECT TO authenticated USING (true);
CREATE POLICY proj_insert ON obras.projects          FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY proj_update ON obras.projects          FOR UPDATE TO authenticated USING (true);
CREATE POLICY proj_delete ON obras.projects          FOR DELETE TO authenticated USING (true);

CREATE POLICY mr_select ON obras.maintenance_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY mr_insert ON obras.maintenance_requests FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY mr_update ON obras.maintenance_requests FOR UPDATE TO authenticated USING (true);
CREATE POLICY mr_delete ON obras.maintenance_requests FOR DELETE TO authenticated USING (true);

CREATE POLICY exp_select ON obras.expenses           FOR SELECT TO authenticated USING (true);
CREATE POLICY exp_insert ON obras.expenses           FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY exp_update ON obras.expenses           FOR UPDATE TO authenticated USING (true);
CREATE POLICY exp_delete ON obras.expenses           FOR DELETE TO authenticated USING (true);

CREATE POLICY nt_select ON obras.notifications       FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY nt_insert ON obras.notifications       FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY nt_update ON obras.notifications       FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY nt_delete ON obras.notifications       FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Grants explícitos (redundância segura)
GRANT USAGE ON SCHEMA obras TO authenticated, anon;
GRANT ALL ON ALL TABLES IN SCHEMA obras TO authenticated;
