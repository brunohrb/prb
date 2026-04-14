// =============================================
// PROJECTS MODULE - Bandeira Obras
// Projetos de obras grandes
// =============================================

const Projects = (() => {
  let cache = [];

  const STATUS_LABELS = {
    planejamento: '📋 Planejamento',
    em_andamento: '🔨 Em andamento',
    concluido:    '✅ Concluído',
    pausado:      '⏸️ Pausado'
  };
  const STATUS_COLORS = {
    planejamento: 'status-pendente',
    em_andamento: 'status-em_andamento',
    concluido:    'status-concluido',
    pausado:      'status-pausado'
  };

  async function list() {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    cache = data || [];
    return cache;
  }

  async function getById(id) {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }

  async function create({ name, description, location, status, startDate, endDate }) {
    const { data, error } = await supabase
      .from('projects')
      .insert({
        name,
        description: description || null,
        location: location || null,
        status: status || 'em_andamento',
        start_date: startDate || null,
        end_date: endDate || null,
        created_by: Auth.getUser()?.id
      })
      .select().single();
    if (error) throw error;
    return data;
  }

  async function update(id, fields) {
    const { data, error } = await supabase
      .from('projects')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select().single();
    if (error) throw error;
    return data;
  }

  async function remove(id) {
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) throw error;
  }

  // Conta pendências de um projeto
  async function getPendenciasCount(projectId) {
    const { data } = await supabase
      .from('maintenance_requests')
      .select('id, status')
      .eq('project_id', projectId);
    const total = data?.length || 0;
    const abertas = data?.filter(r => r.status !== 'concluido').length || 0;
    return { total, abertas };
  }

  function getCache() { return cache; }

  // Popula select de projetos
  async function populateSelect(selectId, addEmpty = true) {
    const proj = cache.length > 0 ? cache : await list();
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = addEmpty ? '<option value="">Nenhuma grande obra</option>' : '';
    proj.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  }

  function renderCard(project, counts) {
    const div = document.createElement('div');
    div.className = 'project-card';
    div.dataset.id = project.id;
    const abertas = counts?.abertas ?? '—';
    const total = counts?.total ?? '—';
    div.innerHTML = `
      <div class="project-card-header">
        <div class="project-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="7" width="20" height="14" rx="2"/>
            <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
            <line x1="12" y1="12" x2="12" y2="16"/>
            <line x1="10" y1="14" x2="14" y2="14"/>
          </svg>
        </div>
        <div class="project-info">
          <div class="project-name">${escapeHtml(project.name)}</div>
          ${project.location ? `<div class="project-location">📍 ${escapeHtml(project.location)}</div>` : ''}
        </div>
        <span class="pendencia-status ${STATUS_COLORS[project.status] || ''}">${STATUS_LABELS[project.status] || project.status}</span>
      </div>
      ${project.description ? `<div class="project-desc">${escapeHtml(project.description)}</div>` : ''}
      <div class="project-footer">
        <span class="project-count"><strong>${abertas}</strong> pendência(s) em aberto · ${total} total</span>
        <div class="project-actions">
          <button class="btn btn-outline btn-sm btn-edit-project" data-id="${project.id}">Editar</button>
          <button class="btn btn-primary btn-sm btn-ver-project" data-id="${project.id}">Ver pendências</button>
        </div>
      </div>
    `;
    return div;
  }

  return { list, getById, create, update, remove, getPendenciasCount, getCache, populateSelect, renderCard, STATUS_LABELS, STATUS_COLORS };
})();
