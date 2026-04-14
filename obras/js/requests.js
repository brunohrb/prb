// =============================================
// REQUESTS MODULE - Bandeira Obras
// (Pendências de manutenção)
// =============================================

const Requests = (() => {
  let pendingPhotos = [];

  // ---- Cache simples (45 segundos) ----
  let _cache = null;
  let _cacheAt = 0;
  const CACHE_TTL = 45000;

  function invalidateCache() { _cache = null; _cacheAt = 0; }

  // Busca TODOS os registros (usa cache se recente)
  async function fetchAll() {
    if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;
    const { data, error } = await supabase
      .from('maintenance_requests')
      .select(`
        *,
        properties (id, name, unit),
        projects (id, name, location),
        creator:profiles!maintenance_requests_created_by_fkey (id, name, role)
      `)
      .order('created_at', { ascending: false });
    if (error) throw error;
    _cache = data || [];
    _cacheAt = Date.now();
    return _cache;
  }

  // ---- CRUD ----

  // Lista pendências — busca do cache e filtra localmente
  async function list({ status, propertyId, urgency } = {}) {
    let data = await fetchAll();
    if (status && status !== 'todos') data = data.filter(r => r.status === status);
    if (propertyId) data = data.filter(r => r.property_id === propertyId);
    if (urgency) data = data.filter(r => r.urgency === urgency);
    return data;
  }

  // Busca pendência por ID
  async function getById(id) {
    const { data, error } = await supabase
      .from('maintenance_requests')
      .select(`
        *,
        properties (id, name, unit, address),
        projects (id, name, location),
        creator:profiles!maintenance_requests_created_by_fkey (id, name, email, role)
      `)
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }

  // Cria nova pendência
  async function create({ propertyId, projectId, title, description, urgency, deadline, photos }) {
    invalidateCache();
    const userId = Auth.getUser()?.id;

    // Upload das fotos primeiro
    let photoUrls = [];
    if (photos && photos.length > 0) {
      photoUrls = await uploadPhotos(photos);
    }

    const { data, error } = await supabase
      .from('maintenance_requests')
      .insert({
        property_id: propertyId || null,
        project_id: projectId || null,
        title,
        description: description || null,
        urgency,
        deadline: deadline || null,
        status: 'pendente',
        photos: photoUrls,
        created_by: userId
      })
      .select()
      .single();

    if (error) throw error;

    // Notifica responsáveis (não bloqueia se falhar)
    try {
      await Notifications.notifyNew(data);
    } catch (e) {
      console.error('Erro ao enviar notificação:', e);
    }

    return data;
  }

  // Atualiza status
  async function updateStatus(id, status, notes) {
    invalidateCache();
    const { data, error } = await supabase
      .from('maintenance_requests')
      .update({
        status,
        notes: notes || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select(`*, creator:profiles!maintenance_requests_created_by_fkey(id, name)`)
      .single();

    if (error) throw error;

    // Notifica criador sobre mudança de status (não bloqueia se falhar)
    try {
      if (status === 'concluido') {
        await Notifications.notifyDone(data);
      } else if (status === 'em_andamento') {
        await Notifications.notifyUpdate(data, 'em andamento');
      } else if (status === 'pendente') {
        await Notifications.notifyUpdate(data, 'pendente');
      }
    } catch (e) {
      console.error('Erro ao enviar notificação:', e);
    }

    return data;
  }

  // Deleta pendência
  async function remove(id) {
    invalidateCache();
    const req = await getById(id);
    if (req?.photos?.length) {
      await deletePhotos(req.photos);
    }
    const { error } = await supabase.from('maintenance_requests').delete().eq('id', id);
    if (error) throw error;
  }

  // ---- FOTOS ----

  async function uploadPhotos(files) {
    const urls = [];
    for (const file of files) {
      const ext = file.name?.split('.').pop() || 'jpg';
      const path = `${Auth.getUser()?.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
        cacheControl: '3600',
        upsert: false
      });
      if (!error) {
        const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
        urls.push(urlData.publicUrl);
      }
    }
    return urls;
  }

  async function deletePhotos(urls) {
    const paths = urls.map(url => url.split(`/${STORAGE_BUCKET}/`)[1]).filter(Boolean);
    if (paths.length) {
      await supabase.storage.from(STORAGE_BUCKET).remove(paths);
    }
  }

  // ---- PHOTO PICKER (câmera / galeria) ----

  function initPhotoPicker() {
    pendingPhotos = [];
    const previewEl = document.getElementById('photo-preview');
    if (previewEl) previewEl.innerHTML = '';

    document.getElementById('btn-camera')?.addEventListener('click', () => {
      document.getElementById('input-camera').click();
    });
    document.getElementById('btn-galeria')?.addEventListener('click', () => {
      document.getElementById('input-galeria').click();
    });

    document.getElementById('input-camera')?.addEventListener('change', (e) => {
      handleFileSelect(e.target.files);
      e.target.value = '';
    });
    document.getElementById('input-galeria')?.addEventListener('change', (e) => {
      handleFileSelect(e.target.files);
      e.target.value = '';
    });
  }

  function handleFileSelect(files) {
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      if (pendingPhotos.length >= 8) { showToast('Máximo de 8 fotos por pendência', 'error'); return; }
      compressImage(file, 1200, 0.8).then(compressed => {
        pendingPhotos.push(compressed);
        renderPhotoPreview();
      });
    });
  }

  function compressImage(file, maxWidth, quality) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let w = img.width, h = img.height;
          if (w > maxWidth) { h = h * maxWidth / w; w = maxWidth; }
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          canvas.toBlob(blob => {
            resolve(new File([blob], file.name || 'foto.jpg', { type: 'image/jpeg' }));
          }, 'image/jpeg', quality);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderPhotoPreview() {
    const preview = document.getElementById('photo-preview');
    if (!preview) return;
    preview.innerHTML = '';
    pendingPhotos.forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const item = document.createElement('div');
        item.className = 'photo-item';
        item.innerHTML = `
          <img src="${e.target.result}" alt="Foto ${idx + 1}">
          <button class="photo-remove" data-idx="${idx}">×</button>
        `;
        item.querySelector('.photo-remove').addEventListener('click', () => {
          pendingPhotos.splice(idx, 1);
          renderPhotoPreview();
        });
        preview.appendChild(item);
      };
      reader.readAsDataURL(file);
    });
  }

  function getPendingPhotos() { return pendingPhotos; }
  function clearPendingPhotos() { pendingPhotos = []; }

  // ---- RENDER ----

  function urgencyLabel(urgency) {
    const map = { critica: '🔴 Crítica', alta: '🟠 Alta', media: '🟡 Média', baixa: '🟢 Baixa' };
    return map[urgency] || urgency;
  }

  function statusLabel(status) {
    const map = { pendente: 'Pendente', em_andamento: 'Em andamento', concluido: 'Concluído' };
    return map[status] || status;
  }

  function formatDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('pt-BR');
  }

  function isOverdue(deadline, status) {
    if (!deadline || status === 'concluido') return false;
    return new Date(deadline + 'T23:59:59') < new Date();
  }

  function renderCard(req) {
    const propName = req.properties
      ? (req.properties.unit ? `${req.properties.unit} · ${req.properties.name}` : req.properties.name)
      : req.projects
        ? `🏗️ ${req.projects.name}`
        : '—';
    const overdue = isOverdue(req.deadline, req.status);
    const card = document.createElement('div');
    card.className = `pendencia-card urgencia-${req.urgency} status-${req.status}`;
    card.dataset.id = req.id;
    card.innerHTML = `
      <div class="pendencia-top">
        <div class="pendencia-titulo">${escapeHtml(req.title)}</div>
        <span class="pendencia-urgencia-badge badge-${req.urgency}">${urgencyLabel(req.urgency)}</span>
      </div>
      <div class="pendencia-imovel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
        ${escapeHtml(propName)}
      </div>
      <div class="pendencia-footer">
        <span class="pendencia-status status-${req.status}">${statusLabel(req.status)}</span>
        <div style="display:flex;gap:10px;align-items:center">
          ${req.deadline ? `<span class="pendencia-prazo ${overdue ? 'prazo-vencido' : ''}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            ${overdue ? '⚠️ ' : ''}${formatDate(req.deadline)}
          </span>` : ''}
          ${req.photos?.length ? `<span class="pendencia-fotos-count">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
            ${req.photos.length}
          </span>` : ''}
        </div>
      </div>
    `;
    return card;
  }

  function renderDetalhe(req, isResponsavel) {
    const propName = req.properties
      ? (req.properties.unit ? `${req.properties.unit} · ${req.properties.name}` : req.properties.name)
      : req.projects
        ? `🏗️ ${req.projects.name}`
        : '—';
    const overdue = isOverdue(req.deadline, req.status);
    const createdAt = new Date(req.created_at).toLocaleString('pt-BR');
    const updatedAt = req.updated_at ? new Date(req.updated_at).toLocaleString('pt-BR') : null;

    let fotosHTML = '';
    if (req.photos?.length) {
      fotosHTML = `
        <div class="fotos-section card">
          <h4>Fotos (${req.photos.length})</h4>
          <div class="fotos-grid">
            ${req.photos.map((url, i) => `<img class="foto-thumb" src="${url}" alt="Foto ${i+1}" data-url="${url}">`).join('')}
          </div>
        </div>
      `;
    }

    let acoesHTML = '';
    if (isResponsavel) {
      acoesHTML = `
        <div class="acoes-section card">
          <h4>Atualizar status</h4>
          <div class="status-buttons">
            ${req.status !== 'em_andamento' ? `<button class="btn btn-outline" data-action="em_andamento">▶ Marcar como Em Andamento</button>` : ''}
            ${req.status !== 'concluido' ? `<button class="btn btn-success" data-action="concluido">✓ Marcar como Concluído</button>` : ''}
            ${req.status !== 'pendente' ? `<button class="btn btn-outline" data-action="pendente">↩ Voltar para Pendente</button>` : ''}
          </div>
          <textarea id="status-notes" class="notas-input" rows="2" placeholder="Observações (opcional)...">${req.notes || ''}</textarea>
        </div>
      `;
    }

    return `
      <div class="detalhe-header card">
        <div class="detalhe-titulo">${escapeHtml(req.title)}</div>
        <div class="detalhe-badges">
          <span class="pendencia-urgencia-badge badge-${req.urgency}">${urgencyLabel(req.urgency)}</span>
          <span class="pendencia-status status-${req.status}">${statusLabel(req.status)}</span>
        </div>
        <div class="detalhe-info-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
          <span>${escapeHtml(propName)}</span>
        </div>
        ${req.deadline ? `
        <div class="detalhe-info-row ${overdue ? 'prazo-vencido' : ''}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>Prazo: ${formatDate(req.deadline)}${overdue ? ' ⚠️ VENCIDO' : ''}</span>
        </div>` : ''}
        ${req.description ? `<div class="detalhe-descricao">${escapeHtml(req.description)}</div>` : ''}
      </div>
      ${fotosHTML}
      ${acoesHTML}
      <div class="criado-por-section">
        <strong>Criado por:</strong> ${escapeHtml(req.creator?.name || 'Desconhecido')} — ${createdAt}
        ${updatedAt ? `<br><strong>Última atualização:</strong> ${updatedAt}` : ''}
        ${req.notes ? `<br><strong>Obs. do responsável:</strong> ${escapeHtml(req.notes)}` : ''}
      </div>
      ${!isResponsavel ? `
      <button class="btn btn-danger btn-full" id="btn-excluir-pendencia" style="margin-top:8px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        Excluir Pendência
      </button>` : ''}
    `;
  }

  return {
    list, getById, create, updateStatus, remove,
    invalidateCache,
    initPhotoPicker, getPendingPhotos, clearPendingPhotos,
    urgencyLabel, statusLabel, formatDate, isOverdue,
    renderCard, renderDetalhe
  };
})();
