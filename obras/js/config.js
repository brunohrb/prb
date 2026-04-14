// =============================================
// CONFIGURAÇÃO SUPABASE - Bandeira Obras
// Usa o MESMO projeto do PRB (Pró-Labore), porém
// num schema próprio ("obras") para não misturar
// tabelas com o sistema financeiro do PRB.
// =============================================

const SUPABASE_URL       = 'https://xuwwgprchhfshrqdhuqn.supabase.co';
const SUPABASE_ANON_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1d3dncHJjaGhmc2hycWRodXFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5NTI0NTQsImV4cCI6MjA4MjUyODQ1NH0.MEUMQ4_z1R5tF3_wQbEj_eTitGJia03b0M0LT3aOAnc';
const OBRAS_SCHEMA       = 'obras';
const STORAGE_BUCKET     = 'obras-fotos';
const APP_VERSION        = '2.0.0';

// Inicializa cliente — sobrescreve window.supabase (lib) com o cliente instanciado
// db.schema='obras' faz com que todos os .from('xxx') apontem para obras.xxx
// ⚠️ É necessário expor o schema em: Supabase Dashboard → Settings → API →
//     "Exposed schemas" → adicionar "obras"
window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: OBRAS_SCHEMA },
  realtime: { params: { eventsPerSecond: 10 } }
});
