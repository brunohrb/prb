// =============================================
// CONFIGURAÇÃO SUPABASE - Bandeira Obras
// =============================================

const SUPABASE_URL = 'https://daozgmiytfrwomxznjln.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhb3pnbWl5dGZyd29teHpuamxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDY4NzMsImV4cCI6MjA5MDU4Mjg3M30.evEDpNDP5nFaxCDPqyhyWg2uxM9TvjsVKP0ujNqfQWs';
const STORAGE_BUCKET = 'obras-fotos';
const APP_VERSION = '1.0.0';

// Inicializa cliente — sobrescreve window.supabase (lib) com o cliente instanciado
// Assim evita conflito de nome com a variável global da biblioteca CDN
window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } }
});
