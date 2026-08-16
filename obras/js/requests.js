// =============================================
// REQUESTS MODULE - Bandeira Obras
// (Pendências de manutenção)
// =============================================

const Requests = (() => {
  // ---- Config das fotos ----
  const MAX_PHOTOS     = 8;
  const PHOTO_MAX_DIM  = 1280;   // maior lado da imagem depois de comprimir
  const PHOTO_QUALITY  = 0.75;
  const COMPRESS_TIMEOUT = 20000;
  const UPLOAD_TIMEOUT   = 60000;

  // Cada foto escolhida vira um item com ciclo de vida próprio:
  // 'preparando' -> 'enviando' -> 'pronto' | 'erro'
  // O upload acontece assim que a foto é escolhida (não no submit),
  // então salvar a pendência é instantâneo na maioria das vezes.
  let photoItems = [];
  let photoSeq = 0;
  let pickerBound = false;

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

  // Cria nova pendência — as fotos já chegam aqui enviadas (upload em background)
  async function create({ propertyId, projectId, title, description, urgency, deadline, photoUrls = [] }) {
    invalidateCache();
    const userId = Auth.getUser()?.id;

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

  // Atualiza campos editáveis (título, descrição, urgência, prazo)
  async function update(id, { title, description, urgency, deadline }) {
    invalidateCache();
    const { data, error } = await supabase
      .from('maintenance_requests')
      .update({
        title,
        description: description || null,
        urgency,
        deadline: deadline || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
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

  // ---- FOTOS: upload ----

  // Sobe um arquivo via XHR (dá progresso real e timeout de verdade).
  // Cai para o SDK do Supabase se algo impedir o XHR.
  function uploadViaXhr(path, file, token, onProgress, onStart) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`, true);
      xhr.timeout = UPLOAD_TIMEOUT;
      xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
      xhr.setRequestHeader('authorization', `Bearer ${token}`);
      xhr.setRequestHeader('cache-control', 'max-age=3600');
      xhr.setRequestHeader('content-type', file.type || 'image/jpeg');
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`HTTP ${xhr.status}`));
      };
      xhr.onerror   = () => reject(new Error('Falha de conexão'));
      xhr.ontimeout = () => reject(new Error('Tempo esgotado'));
      xhr.onabort   = () => reject(new Error('Cancelado'));
      if (onStart) onStart(xhr);      // permite cancelar o envio
      if (onProgress) onProgress(0);
      xhr.send(file);
    });
  }

  // Se o caminho por XHR der erro de protocolo (não de rede), o app inteiro
  // passa a usar só o SDK — não adianta insistir a cada foto.
  let xhrUploadBroken = false;

  // Sobe uma foto com até 3 tentativas. Nunca lança — devolve {url, path} ou null.
  async function uploadOne(item) {
    const userId = Auth.getUser()?.id || 'anon';
    let lastErr = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      if (item.removed) return null;
      // caminho novo a cada tentativa: evita colisão com um upload
      // que estourou o timeout mas chegou no servidor
      const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
      const useXhr = !xhrUploadBroken && attempt < 3;
      try {
        if (useXhr) {
          const { data: sess } = await supabase.auth.getSession();
          const token = sess?.session?.access_token;
          if (!token) throw new Error('Sessão expirada');
          await uploadViaXhr(
            path,
            item.file,
            token,
            (frac) => { item.progress = frac; paintItem(item); },
            (xhr) => { item.xhr = xhr; }
          );
        } else {
          // caminho do SDK: sem progresso, mas é a via mais testada
          item.progress = 0;
          paintItem(item);
          const { error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(path, item.file, { cacheControl: '3600', upsert: false });
          if (error) throw error;
        }
        const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
        return { url: urlData.publicUrl, path };
      } catch (err) {
        lastErr = err;
        item.xhr = null;
        if (item.removed || err.message === 'Cancelado') return null;
        // 4xx = a requisição em si está errada -> passa a usar só o SDK.
        // 5xx / queda de rede são passageiros: continua tentando pelo XHR.
        if (useXhr && /^HTTP 4\d\d$/.test(err.message || '')) xhrUploadBroken = true;
        console.error(`Upload da foto falhou (tentativa ${attempt}/3):`, err);
        if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1500));
      }
    }
    item.error = lastErr?.message || 'Erro desconhecido';
    return null;
  }

  async function deletePhotos(urls) {
    const paths = urls.map(url => url.split(`/${STORAGE_BUCKET}/`)[1]).filter(Boolean);
    if (paths.length) {
      await supabase.storage.from(STORAGE_BUCKET).remove(paths);
    }
  }

  // ---- FOTOS: compressão ----

  // Reduz a imagem. Se o navegador não conseguir decodificar (HEIC em alguns
  // Androids, arquivo corrompido) devolve o arquivo original em vez de travar.
  function compressImage(file) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (objUrl) URL.revokeObjectURL(objUrl);
        resolve(result);
      };
      const timer = setTimeout(() => finish(file), COMPRESS_TIMEOUT);

      let objUrl = null;
      try {
        objUrl = URL.createObjectURL(file);
      } catch {
        finish(file);
        return;
      }

      const img = new Image();
      img.onload = () => {
        try {
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          if (!w || !h) return finish(file);

          const scale = Math.min(1, PHOTO_MAX_DIM / Math.max(w, h));
          w = Math.round(w * scale);
          h = Math.round(h * scale);

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return finish(file);
          ctx.drawImage(img, 0, 0, w, h);

          canvas.toBlob(blob => {
            // toBlob pode devolver null; e não vale a pena trocar por um arquivo maior
            if (!blob || (file.size && blob.size >= file.size)) return finish(file);
            finish(new File([blob], 'foto.jpg', { type: 'image/jpeg' }));
          }, 'image/jpeg', PHOTO_QUALITY);
        } catch (err) {
          console.error('Erro ao comprimir foto:', err);
          finish(file);
        }
      };
      img.onerror = () => finish(file);
      img.src = objUrl;
    });
  }

  // ---- FOTOS: picker (câmera / galeria) ----

  // Liga os listeners UMA vez só. Antes isso rodava a cada abertura da tela
  // "Nova pendência", acumulando listeners: na 3ª visita cada foto escolhida
  // era adicionada 3 vezes e o botão abria a câmera 3 vezes.
  function bindPhotoPicker() {
    if (pickerBound) return;
    const camBtn  = document.getElementById('btn-camera');
    const galBtn  = document.getElementById('btn-galeria');
    const camIn   = document.getElementById('input-camera');
    const galIn   = document.getElementById('input-galeria');
    const preview = document.getElementById('photo-preview');
    if (!camBtn || !galBtn || !camIn || !galIn || !preview) return;

    camBtn.addEventListener('click', () => camIn.click());
    galBtn.addEventListener('click', () => galIn.click());

    const onChange = (e) => {
      handleFileSelect(e.target.files);
      e.target.value = '';
    };
    camIn.addEventListener('change', onChange);
    galIn.addEventListener('change', onChange);

    // delegação: os botões de cada miniatura não precisam de listener próprio
    preview.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const item = photoItems.find(i => i.id === Number(btn.dataset.id));
      if (!item) return;
      if (btn.dataset.act === 'remove') removePhoto(item);
      if (btn.dataset.act === 'retry')  startPhoto(item);
    });

    pickerBound = true;
  }

  // Chamado ao abrir a tela de nova pendência
  function initPhotoPicker() {
    bindPhotoPicker();
    resetPhotos();
  }

  function handleFileSelect(files) {
    const list = Array.from(files || []);
    let ignoradas = 0;

    for (const file of list) {
      // alguns pickers do Android mandam type vazio — deixa passar
      if (file.type && !file.type.startsWith('image/')) continue;
      if (photoItems.length >= MAX_PHOTOS) { ignoradas++; continue; }

      const item = {
        id: ++photoSeq,
        file,
        original: file,
        status: 'preparando',
        progress: 0,
        url: null,
        path: null,
        error: null,
        removed: false,
        xhr: null,
        task: null,
        previewUrl: null
      };
      try { item.previewUrl = URL.createObjectURL(file); } catch { /* sem preview */ }
      photoItems.push(item);
      renderPhotos();
      startPhoto(item);
    }

    if (ignoradas > 0) showToast(`Máximo de ${MAX_PHOTOS} fotos por pendência`, 'error');
  }

  // Comprime e sobe a foto em background
  function startPhoto(item) {
    if (item.removed) return;
    item.error = null;
    item.progress = 0;
    item.status = 'preparando';
    paintItem(item);

    item.task = (async () => {
      try {
        item.file = await compressImage(item.original);
        if (item.removed) return;
        item.status = 'enviando';
        paintItem(item);

        const res = await uploadOne(item);
        if (item.removed) {
          // saiu da lista durante o upload: limpa o arquivo órfão
          if (res) deletePhotos([res.url]).catch(() => {});
          return;
        }
        if (res) {
          item.url = res.url;
          item.path = res.path;
          item.status = 'pronto';
          item.progress = 1;
        } else {
          item.status = 'erro';
        }
      } catch (err) {
        console.error('Erro ao processar foto:', err);
        item.error = err.message;
        item.status = 'erro';
      } finally {
        item.xhr = null;
        paintItem(item);
      }
    })();
  }

  function removePhoto(item) {
    item.removed = true;
    try { item.xhr?.abort(); } catch { /* ignora */ }
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (item.url) deletePhotos([item.url]).catch(() => {});
    photoItems = photoItems.filter(i => i.id !== item.id);
    renderPhotos();
  }

  // Limpa tudo. `keepUploaded` = true depois de salvar a pendência
  // (as fotos agora pertencem ao registro e não devem ser apagadas).
  function resetPhotos(keepUploaded = false) {
    for (const item of photoItems) {
      item.removed = true;
      try { item.xhr?.abort(); } catch { /* ignora */ }
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      if (!keepUploaded && item.url) deletePhotos([item.url]).catch(() => {});
    }
    photoItems = [];
    renderPhotos();
  }

  // ---- FOTOS: estado consultado pelo formulário ----

  function hasPendingUploads() {
    return photoItems.some(i => i.status === 'preparando' || i.status === 'enviando');
  }

  async function waitForUploads() {
    await Promise.allSettled(photoItems.map(i => i.task).filter(Boolean));
  }

  function getPhotoStatus() {
    return {
      total:   photoItems.length,
      ok:      photoItems.filter(i => i.status === 'pronto').length,
      failed:  photoItems.filter(i => i.status === 'erro').length,
      pending: photoItems.filter(i => i.status === 'preparando' || i.status === 'enviando').length
    };
  }

  function getPhotoUrls() {
    return photoItems.filter(i => i.status === 'pronto' && i.url).map(i => i.url);
  }

  // ---- FOTOS: render ----

  function statusHint(item) {
    if (item.status === 'preparando') return 'Preparando…';
    if (item.status === 'enviando')   return `Enviando ${Math.round((item.progress || 0) * 100)}%`;
    if (item.status === 'erro')       return item.error || 'Falhou';
    return 'Enviada';
  }

  function itemHTML(item) {
    const pct = Math.round((item.progress || 0) * 100);
    const busy = item.status === 'preparando' || item.status === 'enviando';
    return `
      ${item.previewUrl ? `<img src="${item.previewUrl}" alt="Foto">` : '<div class="photo-noimg">IMG</div>'}
      ${busy ? `<div class="photo-overlay"><span class="photo-spinner"></span></div>` : ''}
      ${item.status === 'erro' ? `
        <button type="button" class="photo-overlay photo-overlay-erro" data-act="retry" data-id="${item.id}" title="Tentar de novo">↻</button>
      ` : ''}
      ${item.status === 'pronto' ? `<span class="photo-ok">✓</span>` : ''}
      ${item.status === 'enviando' ? `<div class="photo-progress"><i style="width:${pct}%"></i></div>` : ''}
      <button type="button" class="photo-remove" data-act="remove" data-id="${item.id}" aria-label="Remover foto">×</button>
      <span class="photo-hint">${statusHint(item)}</span>
    `;
  }

  // Atualiza só uma miniatura (progresso não pode redesenhar a lista inteira)
  function paintItem(item) {
    const el = document.querySelector(`.photo-item[data-id="${item.id}"]`);
    if (!el) return;
    if (item.status === 'enviando') {
      const bar = el.querySelector('.photo-progress i');
      const hint = el.querySelector('.photo-hint');
      // no meio do envio só mexe na barra, evita piscar a imagem
      if (bar && el.dataset.status === 'enviando') {
        bar.style.width = `${Math.round((item.progress || 0) * 100)}%`;
        if (hint) hint.textContent = statusHint(item);
        return;
      }
    }
    el.dataset.status = item.status;
    el.innerHTML = itemHTML(item);
  }

  function renderPhotos() {
    const preview = document.getElementById('photo-preview');
    if (!preview) return;
    preview.innerHTML = '';
    for (const item of photoItems) {
      const el = document.createElement('div');
      el.className = 'photo-item';
      el.dataset.id = item.id;
      el.dataset.status = item.status;
      el.innerHTML = itemHTML(item);
      preview.appendChild(el);
    }
  }

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

  function renderDetalhe(req) {
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

    const acoesHTML = `
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
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-outline" id="btn-editar-pendencia" style="flex:1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Editar
        </button>
        <button class="btn btn-danger" id="btn-excluir-pendencia" style="flex:1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          Excluir
        </button>
      </div>
    `;
  }

  return {
    list, getById, create, update, updateStatus, remove,
    invalidateCache,
    initPhotoPicker, resetPhotos,
    hasPendingUploads, waitForUploads, getPhotoStatus, getPhotoUrls,
    urgencyLabel, statusLabel, formatDate, isOverdue,
    renderCard, renderDetalhe
  };
})();
