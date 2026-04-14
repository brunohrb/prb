-- =============================================
-- BANDEIRA OBRAS - Correções de banco de dados
-- Execute este arquivo no SQL Editor do Supabase
-- =============================================

-- ============================================================
-- 1. CORRIGIR DUPLICATAS NA TABELA profiles
--    Mantém o perfil mais antigo de cada e-mail e remove os extras.
-- ============================================================
DELETE FROM public.profiles
WHERE id NOT IN (
  SELECT DISTINCT ON (email) id
  FROM public.profiles
  ORDER BY email, created_at ASC
);

-- ============================================================
-- 2. GARANTIR QUE NÃO HAVERÁ MAIS DUPLICATAS
--    Adiciona constraint UNIQUE no e-mail (se ainda não existe).
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_email_unique' AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_email_unique UNIQUE (email);
  END IF;
END $$;

-- ============================================================
-- 3. CORRIGIR property_id — tornar nullable para pendências
--    vinculadas a projetos (Grandes Obras) sem imóvel.
-- ============================================================
ALTER TABLE public.maintenance_requests
  ALTER COLUMN property_id DROP NOT NULL;

-- ============================================================
-- 4. GARANTIR REALTIME HABILITADO PARA NOTIFICAÇÕES
--    Se já adicionado, o comando é ignorado com segurança.
-- ============================================================
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.maintenance_requests;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ============================================================
-- NOTAS IMPORTANTES
-- ============================================================
-- Para notificações em tempo real funcionarem no Supabase:
--   1. Vá em Table Editor → notifications → clique nos 3 pontos → "Edit table"
--   2. Marque "Enable Realtime" e salve.
-- OU via Dashboard: Database → Replication → supabase_realtime → adicione a tabela notifications.
--
-- Para Face ID funcionar no celular:
--   O app precisa estar instalado como PWA (Adicionar à tela inicial) no iOS/Android.
--   Em navegador comum, alguns dispositivos não suportam WebAuthn platform authenticator.
-- ============================================================
