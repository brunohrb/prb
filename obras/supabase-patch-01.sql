-- ============================================================
-- BANDEIRA OBRAS — PATCH 01
-- Integração com pró-labore do PRB (tabela public.movimentacoes)
-- ============================================================
-- Execute no SQL Editor DEPOIS do supabase-install.sql
-- ============================================================

-- 1) Torna destination_socio_id opcional e adiciona
--    destination_socio_name (paulo/rafael/bruno)
ALTER TABLE obras.expenses
  ADD COLUMN IF NOT EXISTS destination_socio_name TEXT;

-- Remove NOT NULL do UUID FK (agora opcional)
ALTER TABLE obras.expenses
  ALTER COLUMN destination_socio_id DROP NOT NULL;

-- 2) Substitui a constraint de coerência para aceitar socio_name
ALTER TABLE obras.expenses
  DROP CONSTRAINT IF EXISTS expense_destination_coherence;

ALTER TABLE obras.expenses
  ADD CONSTRAINT expense_destination_coherence CHECK (
    (destination_type = 'socio'
       AND (destination_socio_name IS NOT NULL OR destination_socio_id IS NOT NULL)) OR
    (destination_type = 'familia' AND destination_family IS NOT NULL) OR
    (destination_type = 'obra')
  );

-- 3) Garante que obras.profiles existe para todos os sócios hardcoded
--    (se o install já rodou, é no-op)
DO $$
DECLARE u RECORD;
BEGIN
  FOR u IN
    SELECT id, email FROM auth.users
    WHERE email IN ('paulo@bandeira.app', 'rafael@bandeira.app', 'bruno@bandeira.app')
  LOOP
    INSERT INTO obras.profiles (id, email, name, role)
    VALUES (u.id, u.email,
            initcap(split_part(u.email, '@', 1)),
            'socio')
    ON CONFLICT (id) DO UPDATE
      SET role = 'socio', name = EXCLUDED.name;
  END LOOP;
END $$;

-- ============================================================
-- PRONTO! Agora o /obras pode gravar 'paulo'|'rafael'|'bruno'
-- em destination_socio_name e espelhar no PRB.
-- ============================================================
