-- =============================================
-- BANDEIRA OBRAS - Projetos de Obra Grande
-- Execute no SQL Editor do Supabase
-- =============================================

-- 1. Tabela de Projetos
CREATE TABLE IF NOT EXISTS public.projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  description  TEXT,
  location     TEXT,
  status       TEXT NOT NULL DEFAULT 'em_andamento'
                 CHECK (status IN ('planejamento', 'em_andamento', 'concluido', 'pausado')),
  start_date   DATE,
  end_date     DATE,
  created_by   UUID REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Adiciona coluna project_id nas pendências (liga pendência a um projeto)
ALTER TABLE public.maintenance_requests
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE;

-- 3. RLS para projetos
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_select" ON public.projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "projects_insert" ON public.projects FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "projects_update" ON public.projects FOR UPDATE TO authenticated USING (true);
CREATE POLICY "projects_delete" ON public.projects FOR DELETE TO authenticated USING (true);

-- 4. Realtime para projetos
ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;
