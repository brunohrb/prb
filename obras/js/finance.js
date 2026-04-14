// =============================================
// FINANCE MODULE - Bandeira Obras
// Gastos diários direcionados ao pró-labore
// (sócio, família ou obra) + lista semanal dos
// prestadores (pedreiro, encanador, pintor, etc.)
// =============================================

const Finance = (() => {
  // ---- Cache simples (30s) ----
  let _cache = null;
  let _cacheAt = 0;
  const CACHE_TTL = 30000;

  function invalidateCache() { _cache = null; _cacheAt = 0; }

  // ---- Labels ----
  const CATEGORY_LABELS = {
    material: '🧱 Material',
    servico:  '🔧 Serviço',
    pedreiro: '👷 Mão-de-obra',
    outros:   '📦 Outros'
  };

  const DESTINATION_LABELS = {
    socio:   '👤 Sócio',
    familia: '👪 Família',
    obra:    '🏗️ Obra'
  };

  const DESTINATION_COLORS = {
    socio:   'dest-socio',
    familia: 'dest-familia',
    obra:    'dest-obra'
  };

  // ---- Helpers ----
  function formatBRL(v) {
    const n = Number(v) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatDateShort(d) {
    if (!d) return '';
    const date = typeof d === 'string' ? new Date(d + 'T00:00:00') : d;
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  // Retorna {start, end} da semana corrente (segunda → domingo)
  function getCurrentWeekRange(ref = new Date()) {
    const d = new Date(ref);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0=dom, 1=seg, ...
    const diffToMonday = (day === 0 ? -6 : 1 - day);
    const start = new Date(d);
    start.setDate(d.getDate() + diffToMonday);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start, end };
  }

  function toISODate(d) {
    return d.toISOString().slice(0, 10);
  }

  // ---- CRUD ----

  async function fetchAll() {
    if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;
    const { data, error } = await supabase
      .from('expenses')
      .select(`
        *,
        socio:profiles!expenses_destination_socio_id_fkey (id, name, email),
        properties (id, name, unit),
        projects (id, name),
        creator:profiles!expenses_created_by_fkey (id, name)
      `)
      .order('expense_date', { ascending: false })
      .order('created_at',  { ascending: false });
    if (error) throw error;
    _cache = data || [];
    _cacheAt = Date.now();
    return _cache;
  }

  async function list(filters = {}) {
    let data = await fetchAll();
    if (filters.category)        data = data.filter(e => e.category === filters.category);
    if (filters.destinationType) data = data.filter(e => e.destination_type === filters.destinationType);
    if (filters.paid === true)   data = data.filter(e => e.paid);
    if (filters.paid === false)  data = data.filter(e => !e.paid);
    if (filters.from)            data = data.filter(e => e.expense_date >= filters.from);
    if (filters.to)              data = data.filter(e => e.expense_date <= filters.to);
    return data;
  }

  async function getById(id) {
    const { data, error } = await supabase
      .from('expenses')
      .select(`
        *,
        socio:profiles!expenses_destination_socio_id_fkey (id, name, email),
        properties (id, name, unit),
        projects (id, name),
        creator:profiles!expenses_created_by_fkey (id, name)
      `)
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }

  async function create(payload) {
    invalidateCache();
    const userId = Auth.getUser()?.id;

    const row = {
      description:          payload.description,
      amount:               payload.amount,
      expense_date:         payload.expense_date || new Date().toISOString().slice(0, 10),
      category:             payload.category || 'material',
      service_type:         payload.service_type || null,
      worker_name:          payload.worker_name || null,
      destination_type:     payload.destination_type,
      destination_socio_id: payload.destination_type === 'socio'   ? (payload.destination_socio_id || null) : null,
      destination_family:   payload.destination_type === 'familia' ? (payload.destination_family   || null) : null,
      property_id:          payload.destination_type === 'obra'    ? (payload.property_id          || null) : null,
      project_id:           payload.destination_type === 'obra'    ? (payload.project_id           || null) : null,
      notes:                payload.notes || null,
      created_by:           userId
    };

    const { data, error } = await supabase
      .from('expenses')
      .insert(row)
      .select(`
        *,
        socio:profiles!expenses_destination_socio_id_fkey (id, name, email),
        properties (id, name, unit),
        projects (id, name)
      `)
      .single();

    if (error) throw error;

    // Dispara notificação para sócios
    try {
      await Notifications.notifyExpense(data);
    } catch (e) {
      console.error('Erro ao enviar notificação de gasto:', e);
    }

    return data;
  }

  async function update(id, fields) {
    invalidateCache();
    const { data, error } = await supabase
      .from('expenses')
      .update(fields)
      .eq('id', id)
      .select().single();
    if (error) throw error;
    return data;
  }

  async function remove(id) {
    invalidateCache();
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) throw error;
  }

  // Marcar como pago (tipicamente no fim da semana, pro pedreiro)
  async function markPaid(id, { pix_key, payment_note } = {}) {
    invalidateCache();
    const fields = {
      paid: true,
      paid_at: new Date().toISOString(),
      pix_key: pix_key || null,
      payment_note: payment_note || null
    };
    const { data, error } = await supabase
      .from('expenses')
      .update(fields)
      .eq('id', id)
      .select(`
        *,
        socio:profiles!expenses_destination_socio_id_fkey (id, name),
        properties (id, name, unit),
        projects (id, name)
      `)
      .single();
    if (error) throw error;

    // Notifica sócios do pagamento realizado
    try {
      await Notifications.notifyExpensePaid(data);
    } catch (e) {
      console.error('Erro ao notificar pagamento:', e);
    }

    return data;
  }

  async function markUnpaid(id) {
    invalidateCache();
    const { data, error } = await supabase
      .from('expenses')
      .update({ paid: false, paid_at: null })
      .eq('id', id)
      .select().single();
    if (error) throw error;
    return data;
  }

  // ---- Agregações ----

  // Gastos da semana atual, agrupados por prestador (worker_name)
  // usado na tela de “pagamento da semana”
  async function getWeekWorkers(ref = new Date()) {
    const { start, end } = getCurrentWeekRange(ref);
    const fromStr = toISODate(start);
    const toStr   = toISODate(end);

    const all = await fetchAll();
    const onlyWorkers = all.filter(e =>
      (e.category === 'pedreiro' || e.category === 'servico') &&
      e.expense_date >= fromStr && e.expense_date <= toStr
    );

    // Agrupa por worker_name (quando existir); quando não, por service_type
    const groups = {};
    for (const exp of onlyWorkers) {
      const key = (exp.worker_name && exp.worker_name.trim()) ||
                  (exp.service_type ? `(${exp.service_type})` : '(Sem nome)');
      if (!groups[key]) {
        groups[key] = {
          worker_name: key,
          service_type: exp.service_type || null,
          items: [],
          total: 0,
          total_paid: 0,
          total_pending: 0,
          pix_key: null
        };
      }
      groups[key].items.push(exp);
      groups[key].total += Number(exp.amount) || 0;
      if (exp.paid) groups[key].total_paid   += Number(exp.amount) || 0;
      else          groups[key].total_pending += Number(exp.amount) || 0;
      // Mantém o último pix_key informado
      if (exp.pix_key) groups[key].pix_key = exp.pix_key;
    }

    return {
      range: { start: fromStr, end: toStr },
      groups: Object.values(groups).sort((a, b) => b.total_pending - a.total_pending)
    };
  }

  // Totais gerais (para o topo da view financeiro)
  async function getTotals(filters = {}) {
    const data = await list(filters);
    const total    = data.reduce((s, e) => s + Number(e.amount || 0), 0);
    const pago     = data.filter(e => e.paid).reduce((s, e) => s + Number(e.amount || 0), 0);
    const aberto   = total - pago;
    const semana   = (await getWeekWorkers()).groups
                       .reduce((s, g) => s + g.total_pending, 0);
    return { total, pago, aberto, semana, count: data.length };
  }

  // ---- Render ----

  function renderCard(exp) {
    const div = document.createElement('div');
    div.className = 'expense-card';
    div.dataset.id = exp.id;

    const destColor = DESTINATION_COLORS[exp.destination_type] || '';
    const destLabel = DESTINATION_LABELS[exp.destination_type] || exp.destination_type;
    let destExtra = '';
    if (exp.destination_type === 'socio')
      destExtra = exp.socio?.name ? ` · ${escapeHtml(exp.socio.name)}` : '';
    else if (exp.destination_type === 'familia')
      destExtra = exp.destination_family ? ` · ${escapeHtml(exp.destination_family)}` : '';
    else if (exp.destination_type === 'obra') {
      const obraNome = exp.projects?.name || exp.properties?.name || '';
      destExtra = obraNome ? ` · ${escapeHtml(obraNome)}` : '';
    }

    const isWorker = exp.category === 'pedreiro' || exp.category === 'servico';
    const workerTxt = isWorker && exp.worker_name ? `👷 ${escapeHtml(exp.worker_name)}${exp.service_type ? ` · ${escapeHtml(exp.service_type)}` : ''}` : '';

    div.innerHTML = `
      <div class="expense-top">
        <div class="expense-amount">${formatBRL(exp.amount)}</div>
        <span class="expense-dest ${destColor}">${destLabel}${destExtra}</span>
      </div>
      <div class="expense-desc">${escapeHtml(exp.description)}</div>
      ${workerTxt ? `<div class="expense-worker">${workerTxt}</div>` : ''}
      <div class="expense-meta">
        <span>${CATEGORY_LABELS[exp.category] || exp.category}</span>
        <span>📅 ${formatDateShort(exp.expense_date)}</span>
        ${exp.paid
          ? `<span class="expense-paid">✅ Pago</span>`
          : (isWorker ? `<span class="expense-open">⏳ A pagar</span>` : '')}
      </div>
    `;
    return div;
  }

  function renderWeekWorkerCard(group) {
    const div = document.createElement('div');
    div.className = 'worker-card';
    div.dataset.worker = group.worker_name;

    const itemsHtml = group.items.map(it => `
      <div class="worker-item ${it.paid ? 'paid' : ''}">
        <div class="worker-item-left">
          <div>${escapeHtml(it.description)}</div>
          <small>${formatDateShort(it.expense_date)}${it.service_type ? ' · ' + escapeHtml(it.service_type) : ''}</small>
        </div>
        <div class="worker-item-right">
          <strong>${formatBRL(it.amount)}</strong>
          ${it.paid
            ? '<span class="tag ok">pago</span>'
            : `<button class="btn btn-sm btn-outline btn-pay-item" data-id="${it.id}">Pagar</button>`}
        </div>
      </div>
    `).join('');

    div.innerHTML = `
      <div class="worker-head">
        <div>
          <div class="worker-name">👷 ${escapeHtml(group.worker_name)}</div>
          ${group.service_type ? `<small>${escapeHtml(group.service_type)}</small>` : ''}
        </div>
        <div class="worker-totals">
          <div><small>Total</small><strong>${formatBRL(group.total)}</strong></div>
          <div class="pending"><small>A pagar</small><strong>${formatBRL(group.total_pending)}</strong></div>
        </div>
      </div>

      <div class="worker-items">${itemsHtml}</div>

      <div class="worker-pix">
        <label>Chave PIX do prestador</label>
        <div class="pix-row">
          <input type="text" class="input-pix" value="${escapeHtml(group.pix_key || '')}" placeholder="CPF, celular, email ou chave aleatória">
          <button class="btn btn-sm btn-outline btn-copy-pix" type="button">Copiar</button>
        </div>
        <button class="btn btn-primary btn-sm btn-pay-all" ${group.total_pending === 0 ? 'disabled' : ''}>
          Marcar semana como paga (${formatBRL(group.total_pending)})
        </button>
      </div>
    `;
    return div;
  }

  return {
    // CRUD
    list, getById, create, update, remove, markPaid, markUnpaid,
    invalidateCache,
    // Agregações
    getWeekWorkers, getTotals, getCurrentWeekRange,
    // Render
    renderCard, renderWeekWorkerCard,
    // Helpers
    formatBRL, formatDateShort,
    // Labels
    CATEGORY_LABELS, DESTINATION_LABELS, DESTINATION_COLORS
  };
})();
