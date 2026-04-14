// =============================================
// PROPERTIES MODULE - Bandeira Obras
// =============================================

const Properties = (() => {
  let cache = [];

  // Lista todos os imóveis
  async function list() {
    const { data, error } = await supabase
      .from('properties')
      .select('*, maintenance_requests(count)')
      .order('name');
    if (error) throw error;
    cache = data || [];
    return cache;
  }

  // Busca imóvel por ID
  async function getById(id) {
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }

  // Cria novo imóvel
  async function create(nome, unidade, endereco) {
    const { data, error } = await supabase
      .from('properties')
      .insert({
        name: nome,
        unit: unidade || null,
        address: endereco || null,
        created_by: Auth.getUser()?.id
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Atualiza imóvel
  async function update(id, nome, unidade, endereco) {
    const { data, error } = await supabase
      .from('properties')
      .update({
        name: nome,
        unit: unidade || null,
        address: endereco || null
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Deleta imóvel
  async function remove(id) {
    const { error } = await supabase
      .from('properties')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  // Retorna cache
  function getCache() { return cache; }

  // Retorna nome completo do imóvel
  function getDisplayName(property) {
    if (!property) return '—';
    return property.unit
      ? `${property.unit} - ${property.name}`
      : property.name;
  }

  // Popula selects com imóveis
  async function populateSelects(selectIds) {
    const props = cache.length > 0 ? cache : await list();
    selectIds.forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const current = sel.value;
      const defaultOpt = sel.options[0];
      sel.innerHTML = '';
      sel.appendChild(defaultOpt);
      props.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = getDisplayName(p);
        sel.appendChild(opt);
      });
      if (current) sel.value = current;
    });
  }

  // Renderiza card de imóvel
  function renderCard(property, pendingCount) {
    const div = document.createElement('div');
    div.className = 'imovel-card';
    div.innerHTML = `
      <div class="imovel-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      </div>
      <div class="imovel-info">
        <div class="imovel-nome">${escapeHtml(property.name)}</div>
        ${property.unit ? `<div class="imovel-unidade">${escapeHtml(property.unit)}</div>` : ''}
        ${property.address ? `<div class="imovel-endereco">${escapeHtml(property.address)}</div>` : ''}
        <div class="imovel-count">${pendingCount || 0} pendência(s)</div>
      </div>
      <div class="imovel-actions">
        <button class="btn-icon btn-edit-imovel" data-id="${property.id}" title="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
    `;
    return div;
  }

  return { list, getById, create, update, remove, getCache, getDisplayName, populateSelects, renderCard };
})();
