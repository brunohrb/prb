// =============================================
// APP.JS - Controlador Principal
// Bandeira Obras PWA
// =============================================

// ---- Utilitários globais ----

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

function setLoading(btn, loading, text = '') {
  if (!btn) return;
  if (loading) {
    btn.dataset.origText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-sm"></span>${text || ''}`;
    btn.classList.add('btn-loading');
  } else {
    btn.innerHTML = btn.dataset.origText || btn.innerHTML;
    btn.classList.remove('btn-loading');
  }
}

// ---- Estado da app ----
let currentView = 'dashboard';
let currentRequestId = null;
let currentProjectId = null;
let filterState = { status: 'todos', propertyId: '', urgency: '' };
let filterProjetoStatus = 'todos';

// ---- Inicialização ----

document.addEventListener('DOMContentLoaded', async () => {
  // Registra service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  showScreen('loading');

  // Verifica sessão
  try {
    const session = await Auth.getSession();
    if (session) {
      await initApp();
    } else {
      showScreen('login');
    }
  } catch (e) {
    showScreen('login');
  }

  // Listener de auth
  Auth.onAuthChange(async (event, session) => {
    if (event === 'SIGNED_IN') {
      await initApp();
    } else if (event === 'SIGNED_OUT') {
      Notifications.unsubscribe();
      showScreen('login');
    }
  });

  setupLoginForm();
});

// ---- Telas ----

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${name}`);
  if (el) el.classList.add('active');
}

// ---- Init App ----

async function initApp() {
  const profile = Auth.getProfile();
  if (!profile) {
    showToast('Perfil não encontrado. Contate o administrador.', 'error');
    await Auth.logout();
    showScreen('login');
    return;
  }

  // Configura UI do usuário
  updateUserUI(profile);

  // Pede permissão de notificação
  await Notifications.requestPermission();

  // Carrega dados iniciais em paralelo
  await Promise.all([Properties.list(), Projects.list()]);
  await Properties.populateSelects(['filter-imovel', 'nova-imovel']);

  // Atualiza badge de notificações
  const count = await Notifications.getUnreadCount();
  Notifications.updateBadges(count);

  // Inscreve em notificações em tempo real
  Notifications.subscribe();

  // Setup eventos
  setupApp();

  // Mostra tela principal
  showScreen('app');
  navigateTo('dashboard');
}

function updateUserUI(profile) {
  const name = profile.name || profile.email || '?';
  const initial = name.charAt(0).toUpperCase();
  document.getElementById('user-name').textContent = name;
  document.getElementById('user-avatar').textContent = initial;
  document.getElementById('user-role-label').textContent =
    profile.role === 'responsavel' ? 'Responsável pelas Obras' : 'Sócio';

  // Mostra menu de usuários apenas para sócios
  if (Auth.isAdmin()) {
    document.getElementById('menu-usuarios').style.display = 'flex';
  }
}

// ---- Setup eventos ----

function setupApp() {
  // Header
  document.getElementById('btn-notif').addEventListener('click', () => navigateTo('notificacoes'));
  document.getElementById('btn-back').addEventListener('click', goBack);
  document.getElementById('btn-menu').addEventListener('click', toggleMenu);

  // Fecha menu ao clicar fora
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('dropdown-menu');
    if (!menu.classList.contains('hidden') &&
        !e.target.closest('#dropdown-menu') &&
        !e.target.closest('#btn-menu')) {
      menu.classList.add('hidden');
    }
  });

  // Menu itens
  document.getElementById('menu-projetos').addEventListener('click', () => {
    document.getElementById('dropdown-menu').classList.add('hidden');
    navigateTo('projetos');
  });
  document.getElementById('menu-imoveis').addEventListener('click', () => {
    document.getElementById('dropdown-menu').classList.add('hidden');
    navigateTo('imoveis');
  });
  document.getElementById('menu-usuarios').addEventListener('click', () => {
    document.getElementById('dropdown-menu').classList.add('hidden');
    navigateTo('usuarios');
  });
  document.getElementById('menu-financeiro').addEventListener('click', () => {
    document.getElementById('dropdown-menu').classList.add('hidden');
    navigateTo('financeiro');
  });
  document.getElementById('menu-semana').addEventListener('click', () => {
    document.getElementById('dropdown-menu').classList.add('hidden');
    navigateTo('semana');
  });
  document.getElementById('menu-logout').addEventListener('click', handleLogout);

  // Bottom nav
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.view));
  });
  document.getElementById('nav-nova').addEventListener('click', () => navigateTo('nova'));

  // Filtros
  document.getElementById('filter-status').addEventListener('click', (e) => {
    const tab = e.target.closest('.filter-tab');
    if (!tab) return;
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    filterState.status = tab.dataset.status;
    loadDashboard();
  });
  document.getElementById('filter-imovel').addEventListener('change', (e) => {
    filterState.propertyId = e.target.value;
    loadDashboard();
  });
  document.getElementById('filter-urgencia').addEventListener('change', (e) => {
    filterState.urgency = e.target.value;
    loadDashboard();
  });

  // Formulário nova pendência
  setupNovaForm();

  // Modais imóveis
  setupImoveisModal();

  // Modal usuários
  setupUsuariosModal();

  // Modal projetos (Grandes Obras)
  setupProjetosModal();

  // Financeiro
  setupGastoForm();
  setupFinanceiroFilters();

  // Notificações - limpar
  document.getElementById('btn-limpar-notifs').addEventListener('click', async () => {
    await Notifications.markAllRead();
    loadNotificacoes();
    showToast('Todas as notificações marcadas como lidas');
  });

  // Toggle senha
  document.getElementById('toggle-password')?.addEventListener('click', () => {
    const input = document.getElementById('login-password');
    input.type = input.type === 'password' ? 'text' : 'password';
  });
}

function toggleMenu() {
  document.getElementById('dropdown-menu').classList.toggle('hidden');
}

// ---- Navegação ----

let viewHistory = [];

function navigateTo(viewName, pushHistory = true) {
  const views = ['dashboard', 'nova', 'detalhe', 'imoveis', 'notificacoes', 'usuarios', 'projetos', 'projeto-detalhe', 'financeiro', 'novo-gasto', 'semana'];
  if (!views.includes(viewName)) return;

  if (pushHistory && currentView !== viewName) {
    viewHistory.push(currentView);
  }
  currentView = viewName;

  // Atualiza views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewName}`)?.classList.add('active');

  // Atualiza bottom nav
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });

  // Atualiza header
  const titles = {
    dashboard: 'Pendências',
    nova: 'Nova Pendência',
    detalhe: 'Detalhes',
    imoveis: 'Imóveis',
    notificacoes: 'Notificações',
    usuarios: 'Usuários',
    projetos: 'Grandes Obras',
    'projeto-detalhe': 'Pendências da Obra',
    financeiro: 'Financeiro',
    'novo-gasto': 'Novo Gasto',
    semana: 'Pagamento da Semana'
  };
  document.getElementById('page-title').textContent = titles[viewName] || viewName;

  // Botão voltar
  const backBtn = document.getElementById('btn-back');
  const showBack = ['nova', 'detalhe', 'imoveis', 'notificacoes', 'usuarios', 'projetos', 'projeto-detalhe', 'financeiro', 'novo-gasto', 'semana'].includes(viewName);
  backBtn.classList.toggle('hidden', !showBack);
  document.querySelector('.header-logo').classList.toggle('hidden', showBack);

  // Carrega dados da view
  switch (viewName) {
    case 'dashboard': loadDashboard(); break;
    case 'imoveis': loadImoveis(); break;
    case 'notificacoes': loadNotificacoes(); break;
    case 'usuarios': loadUsuarios(); break;
    case 'projetos': loadProjetos(); break;
    case 'financeiro': loadFinanceiro(); break;
    case 'novo-gasto': openNovoGasto(); break;
    case 'semana': loadSemana(); break;
    case 'nova':
      Requests.initPhotoPicker();
      Requests.clearPendingPhotos();
      document.getElementById('form-nova').reset();
      Properties.populateSelects(['nova-imovel']);
      Projects.populateSelect('nova-projeto');
      setTipoNova('imovel');
      document.getElementById('photo-preview').innerHTML = '';
      document.getElementById('nova-error').classList.add('hidden');
      break;
  }
}

function goBack() {
  if (viewHistory.length > 0) {
    const prev = viewHistory.pop();
    navigateTo(prev, false);
  } else {
    navigateTo('dashboard', false);
  }
}

// ---- Login ----

function setupLoginForm() {
  // Auto-preenche usuário salvo
  restoreLoginForm();

  // Mostra botão de biometria se disponível e registrado
  Auth.isBiometricAvailable().then(available => {
    if (available && Auth.hasBiometricSaved()) {
      document.getElementById('btn-biometrico').classList.remove('hidden');
    }
  });

  // Login com biometria
  document.getElementById('btn-biometrico').addEventListener('click', async () => {
    const btn = document.getElementById('btn-biometrico');
    const errEl = document.getElementById('login-error');
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Verificando...';
    try {
      await Auth.verifyBiometric();
      await initApp(); // sessão restaurada com sucesso
    } catch (err) {
      if (err.message === 'SESSAO_EXPIRADA') {
        errEl.textContent = 'Sessão expirada. Faça login com senha — o Face ID continuará disponível.';
        btn.classList.add('hidden');
      } else if (err.message === 'CREDENCIAL_INVALIDA') {
        // Credencial removida do dispositivo (ex: trocou de celular). Permite reativar.
        errEl.textContent = 'Face ID não reconhecido neste dispositivo. Faça login com senha para reativar.';
        btn.classList.add('hidden');
      } else if (err.name === 'NotAllowedError') {
        errEl.textContent = 'Biometria cancelada.';
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22"><path d="M12 2C8.5 2 6 4.5 6 8v1"/><path d="M12 22c3.5 0 6-2.5 6-6v-1"/><path d="M9 8.5A3.5 3.5 0 0115 12v2"/><path d="M9 15.5A3.5 3.5 0 019 12v-1"/><path d="M12 8v8"/><path d="M6 12H3"/><path d="M21 12h-3"/></svg> Entrar com Face ID / Digital`;
      } else {
        errEl.textContent = 'Erro na biometria. Use sua senha.';
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22"><path d="M12 2C8.5 2 6 4.5 6 8v1"/><path d="M12 22c3.5 0 6-2.5 6-6v-1"/><path d="M9 8.5A3.5 3.5 0 0115 12v2"/><path d="M9 15.5A3.5 3.5 0 019 12v-1"/><path d="M12 8v8"/><path d="M6 12H3"/><path d="M21 12h-3"/></svg> Entrar com Face ID / Digital`;
      }
      errEl.classList.remove('hidden');
    }
  });

  // Login com senha
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const remember = document.getElementById('login-remember').checked;
    const btn = document.getElementById('login-btn');
    const errEl = document.getElementById('login-error');

    errEl.classList.add('hidden');
    setLoading(btn, true, 'Entrando...');

    try {
      await Auth.login(username, password);

      // Salva (ou remove) nome de usuário
      if (remember) {
        Auth.saveUsername(username);
      } else {
        Auth.clearSavedUsername();
      }

      // Oferece cadastro de biometria após login (com pequeno delay)
      setTimeout(() => offerBiometricRegistration(username), 1200);

      // initApp será chamado pelo listener de auth
    } catch (err) {
      errEl.textContent = translateError(err.message);
      errEl.classList.remove('hidden');
      setLoading(btn, false);
    }
  });
}

// Oferece ativar biometria após login com senha
async function offerBiometricRegistration(username) {
  if (Auth.hasBiometricSaved()) return;       // já registrado neste dispositivo
  if (Auth.isBiometricOfferDismissed()) return; // usuário escolheu não ativar
  const available = await Auth.isBiometricAvailable();
  if (!available) return;

  // Remove banner anterior se existir
  document.querySelector('.biometric-offer-banner')?.remove();

  // Mostra banner discreto no topo do app
  const banner = document.createElement('div');
  banner.className = 'biometric-offer-banner';
  banner.innerHTML = `
    <span>Ativar login com Face ID / Digital?</span>
    <div class="biometric-offer-btns">
      <button id="bio-sim" class="btn btn-sm btn-primary">Ativar</button>
      <button id="bio-nao" class="btn btn-sm btn-outline">Não quero</button>
    </div>
  `;
  document.getElementById('screen-app').prepend(banner);

  banner.querySelector('#bio-sim').addEventListener('click', async () => {
    try {
      await Auth.registerBiometric(username);
      showToast('Face ID / Digital ativado! ✓', 'success');
      document.getElementById('btn-biometrico')?.classList.remove('hidden');
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        showToast('Ativação cancelada.', '');
      } else {
        showToast('Não foi possível ativar neste dispositivo.', 'error');
        Auth.dismissBiometricOffer(); // não tentar novamente
      }
    }
    banner.remove();
  });

  // "Não quero" salva a preferência permanentemente neste dispositivo
  banner.querySelector('#bio-nao').addEventListener('click', () => {
    Auth.dismissBiometricOffer();
    banner.remove();
  });
}

async function handleLogout() {
  document.getElementById('dropdown-menu').classList.add('hidden');
  await Auth.logout();
  showScreen('login');
  document.getElementById('login-form').reset();
  restoreLoginForm(); // Reaplica usuário salvo após o reset
}

// Reaplica usuário salvo e estado do checkbox
function restoreLoginForm() {
  const savedUser = Auth.getSavedUsername();
  if (savedUser) {
    document.getElementById('login-email').value = savedUser;
    document.getElementById('login-remember').checked = true;
  }
}

function translateError(msg) {
  if (msg.includes('Invalid login')) return 'E-mail ou senha incorretos.';
  if (msg.includes('Email not confirmed')) return 'Confirme seu e-mail antes de entrar.';
  if (msg.includes('Too many requests')) return 'Muitas tentativas. Aguarde um momento.';
  return 'Erro ao entrar. Tente novamente.';
}

// ---- Dashboard ----

async function loadDashboard() {
  const list = document.getElementById('list-pendencias');
  const empty = document.getElementById('empty-pendencias');
  list.querySelectorAll('.pendencia-card').forEach(c => c.remove());

  try {
    // Uma única busca (usa cache de 45s) — filtragem local
    const allReqs = await Requests.list({});

    // Stats sempre sobre todos
    document.getElementById('stat-pendente').textContent =
      allReqs.filter(r => r.status === 'pendente').length;
    document.getElementById('stat-critica').textContent =
      allReqs.filter(r => r.urgency === 'critica' && r.status !== 'concluido').length;
    document.getElementById('stat-concluido').textContent =
      allReqs.filter(r => r.status === 'concluido').length;

    // Aplica filtros localmente
    let reqs = allReqs;
    if (filterState.status !== 'todos') reqs = reqs.filter(r => r.status === filterState.status);
    if (filterState.propertyId) reqs = reqs.filter(r => r.property_id === filterState.propertyId);
    if (filterState.urgency) reqs = reqs.filter(r => r.urgency === filterState.urgency);

    if (reqs.length === 0) {
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      reqs.forEach(req => {
        const card = Requests.renderCard(req);
        card.addEventListener('click', () => openDetalhe(req.id));
        list.appendChild(card);
      });
    }
  } catch (err) {
    showToast('Erro ao carregar pendências', 'error');
    console.error(err);
  }
}

// ---- Detalhe ----

async function openDetalhe(id) {
  currentRequestId = id;
  navigateTo('detalhe');

  const content = document.getElementById('detalhe-content');
  content.innerHTML = '<div style="text-align:center;padding:40px"><div class="loading-spinner" style="margin:0 auto;border-color:rgba(0,0,0,0.15);border-top-color:var(--primary)"></div></div>';

  try {
    const req = await Requests.getById(id);
    content.innerHTML = Requests.renderDetalhe(req, Auth.isResponsavel());

    // Bind botões de status (apenas responsável)
    if (Auth.isResponsavel()) {
      content.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => updateStatus(id, btn.dataset.action));
      });
    }

    // Bind fotos (lightbox)
    content.querySelectorAll('.foto-thumb').forEach(img => {
      img.addEventListener('click', () => openImageViewer(img.dataset.url));
    });

    // Bind excluir (sócios)
    const btnExcluir = content.querySelector('#btn-excluir-pendencia');
    if (btnExcluir) {
      btnExcluir.addEventListener('click', () => confirmDelete(id));
    }
  } catch (err) {
    content.innerHTML = '<div class="empty-state"><p>Erro ao carregar pendência.</p></div>';
    console.error(err);
  }
}

async function updateStatus(id, status) {
  const notes = document.getElementById('status-notes')?.value || '';
  const btn = document.querySelector(`[data-action="${status}"]`);
  setLoading(btn, true, '...');

  try {
    await Requests.updateStatus(id, status, notes);
    showToast('Status atualizado! ✓', 'success');
    await openDetalhe(id); // Recarrega
  } catch (err) {
    showToast('Erro ao atualizar status', 'error');
    setLoading(btn, false);
    console.error(err);
  }
}

async function confirmDelete(id) {
  if (!confirm('Tem certeza que deseja excluir esta pendência? Esta ação não pode ser desfeita.')) return;
  try {
    await Requests.remove(id);
    showToast('Pendência excluída', 'success');
    goBack();
    loadDashboard();
  } catch (err) {
    showToast('Erro ao excluir', 'error');
    console.error(err);
  }
}

// ---- Tipo nova pendência (imóvel ou projeto) ----
let tipoNova = 'imovel';
function setTipoNova(tipo) {
  tipoNova = tipo;
  document.getElementById('nova-imovel').classList.toggle('hidden', tipo === 'projeto');
  document.getElementById('nova-projeto').classList.toggle('hidden', tipo === 'imovel');
  document.getElementById('tipo-imovel').className = `btn btn-sm ${tipo === 'imovel' ? 'btn-primary' : 'btn-outline'}`;
  document.getElementById('tipo-projeto').className = `btn btn-sm ${tipo === 'projeto' ? 'btn-primary' : 'btn-outline'}`;
}

// ---- Nova pendência ----

function setupNovaForm() {
  const form = document.getElementById('form-nova');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-salvar-nova');
    const errEl = document.getElementById('nova-error');
    errEl.classList.add('hidden');

    const propertyId = tipoNova === 'imovel' ? document.getElementById('nova-imovel').value : null;
    const projectId  = tipoNova === 'projeto' ? document.getElementById('nova-projeto').value : null;
    const title = document.getElementById('nova-titulo').value.trim();
    const description = document.getElementById('nova-descricao').value.trim();
    const urgency = document.getElementById('nova-urgencia').value;
    const deadline = document.getElementById('nova-prazo').value;

    if ((!propertyId && !projectId) || !title || !urgency) {
      errEl.textContent = 'Selecione um imóvel ou projeto, título e urgência (*)';
      errEl.classList.remove('hidden');
      return;
    }

    setLoading(btn, true, 'Salvando...');

    try {
      const photos = Requests.getPendingPhotos();
      await Requests.create({ propertyId, projectId, title, description, urgency, deadline, photos });

      showToast('Pendência criada! Responsável notificado. ✓', 'success');
      Requests.clearPendingPhotos();
      form.reset();
      document.getElementById('photo-preview').innerHTML = '';
      navigateTo('dashboard');
    } catch (err) {
      errEl.textContent = 'Erro ao salvar: ' + err.message;
      errEl.classList.remove('hidden');
      setLoading(btn, false);
      console.error(err);
    }
  });
}

// ---- Imóveis ----

async function loadImoveis() {
  const list = document.getElementById('list-imoveis');
  list.innerHTML = '<div style="text-align:center;padding:32px"><div class="loading-spinner" style="margin:0 auto;border-color:rgba(0,0,0,0.15);border-top-color:var(--primary)"></div></div>';

  try {
    const props = await Properties.list();
    const reqs = await Requests.list({});
    list.innerHTML = '';

    if (props.length === 0) {
      list.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg><p>Nenhum imóvel cadastrado</p></div>';
      return;
    }

    props.forEach(p => {
      const pending = reqs.filter(r => r.property_id === p.id && r.status !== 'concluido').length;
      const card = Properties.renderCard(p, pending);
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-edit-imovel')) {
          openEditImovel(p);
        } else {
          // Filtra por imóvel no dashboard
          filterState.propertyId = p.id;
          document.getElementById('filter-imovel').value = p.id;
          navigateTo('dashboard');
        }
      });
      list.appendChild(card);
    });
  } catch (err) {
    showToast('Erro ao carregar imóveis', 'error');
    console.error(err);
  }
}

function setupImoveisModal() {
  const modal = document.getElementById('modal-imovel');
  const form = document.getElementById('form-imovel');

  document.getElementById('btn-novo-imovel').addEventListener('click', () => {
    document.getElementById('modal-imovel-title').textContent = 'Novo Imóvel';
    document.getElementById('imovel-edit-id').value = '';
    form.reset();
    modal.classList.remove('hidden');
  });

  document.getElementById('close-modal-imovel').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('cancel-modal-imovel').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('imovel-edit-id').value;
    const nome = document.getElementById('imovel-nome').value.trim();
    const unidade = document.getElementById('imovel-unidade').value.trim();
    const endereco = document.getElementById('imovel-endereco').value.trim();

    try {
      if (id) {
        await Properties.update(id, nome, unidade, endereco);
        showToast('Imóvel atualizado ✓', 'success');
      } else {
        await Properties.create(nome, unidade, endereco);
        showToast('Imóvel criado ✓', 'success');
      }
      modal.classList.add('hidden');
      await Properties.list();
      await Properties.populateSelects(['filter-imovel', 'nova-imovel']);
      loadImoveis();
    } catch (err) {
      showToast('Erro ao salvar imóvel', 'error');
      console.error(err);
    }
  });
}

function openEditImovel(property) {
  document.getElementById('modal-imovel-title').textContent = 'Editar Imóvel';
  document.getElementById('imovel-edit-id').value = property.id;
  document.getElementById('imovel-nome').value = property.name;
  document.getElementById('imovel-unidade').value = property.unit || '';
  document.getElementById('imovel-endereco').value = property.address || '';
  document.getElementById('modal-imovel').classList.remove('hidden');
}

// ---- Notificações ----

async function loadNotificacoes() {
  const list = document.getElementById('list-notificacoes');
  list.innerHTML = '';

  try {
    const notifs = await Notifications.list();
    if (notifs.length === 0) {
      list.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg><p>Nenhuma notificação</p></div>';
      return;
    }

    notifs.forEach(notif => {
      const item = Notifications.renderItem(notif);
      item.addEventListener('click', async () => {
        if (!notif.read) {
          await Notifications.markRead(notif.id);
          notif.read = true;
          item.classList.add('lida');
          item.querySelector('.notif-dot')?.classList.add('hidden');
          const count = await Notifications.getUnreadCount();
          Notifications.updateBadges(count);
        }
        if (notif.request_id) {
          openDetalhe(notif.request_id);
        }
      });
      list.appendChild(item);
    });

    // Atualiza badge
    const count = await Notifications.getUnreadCount();
    Notifications.updateBadges(count);
  } catch (err) {
    console.error(err);
  }
}

// ---- Usuários ----

async function loadUsuarios() {
  if (!Auth.isAdmin()) return;
  const list = document.getElementById('list-usuarios');
  list.innerHTML = '';

  try {
    const { data: users, error } = await supabase
      .from('profiles')
      .select('*')
      .order('name');
    if (error) throw error;

    if (!users?.length) {
      list.innerHTML = '<div class="empty-state"><p>Nenhum usuário cadastrado</p></div>';
      return;
    }

    // Remove duplicatas pelo e-mail (mantém o primeiro de cada)
    const seen = new Set();
    const uniqueUsers = users.filter(u => {
      if (seen.has(u.email)) return false;
      seen.add(u.email);
      return true;
    });

    uniqueUsers.forEach(u => {
      const card = document.createElement('div');
      card.className = 'usuario-card';
      const initial = (u.name || u.email || '?').charAt(0).toUpperCase();
      card.innerHTML = `
        <div class="usuario-avatar">${initial}</div>
        <div class="usuario-info">
          <div class="usuario-nome">${escapeHtml(u.name || '—')}</div>
          <div class="usuario-email">${escapeHtml(u.email)}</div>
          <span class="usuario-role role-${u.role}">${u.role === 'responsavel' ? 'Responsável pelas Obras' : 'Sócio'}</span>
        </div>
      `;
      list.appendChild(card);
    });
  } catch (err) {
    showToast('Erro ao carregar usuários', 'error');
    console.error(err);
  }
}

function setupUsuariosModal() {
  const modal = document.getElementById('modal-usuario');
  const form = document.getElementById('form-usuario');

  document.getElementById('btn-novo-usuario').addEventListener('click', () => {
    form.reset();
    document.getElementById('usuario-error').classList.add('hidden');
    modal.classList.remove('hidden');
  });

  document.getElementById('close-modal-usuario').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('cancel-modal-usuario').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('usuario-error');
    errEl.classList.add('hidden');

    const nome = document.getElementById('usuario-nome').value.trim();
    const email = document.getElementById('usuario-email').value.trim();
    const senha = document.getElementById('usuario-senha').value;
    const perfil = document.getElementById('usuario-perfil').value;

    try {
      const usuario = document.getElementById('usuario-email').value.trim();
      await Auth.createUser(usuario, senha, nome, perfil);
      showToast(`Usuário "${usuario}" criado com sucesso! ✓`, 'success');
      modal.classList.add('hidden');
      loadUsuarios();
    } catch (err) {
      if (err.message === 'CONFIRM_EMAIL') {
        errEl.textContent = '⚠️ Usuário criado mas precisa de confirmação. Desative "Confirm email" em Authentication → Providers → Email no Supabase para evitar isso.';
      } else {
        errEl.textContent = translateError(err.message) || err.message;
      }
      errEl.classList.remove('hidden');
      console.error(err);
    }
  });
}

// ---- Projetos ----

async function loadProjetos() {
  const list = document.getElementById('list-projetos');
  list.innerHTML = '<div style="text-align:center;padding:32px"><div class="loading-spinner" style="margin:0 auto;border-color:rgba(0,0,0,0.15);border-top-color:var(--primary)"></div></div>';
  try {
    const projetos = await Projects.list();
    const reqs = await Requests.list({});
    list.innerHTML = '';
    if (!projetos.length) {
      list.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg><p>Nenhum projeto cadastrado</p></div>';
      return;
    }
    projetos.forEach(p => {
      const total = reqs.filter(r => r.project_id === p.id).length;
      const abertas = reqs.filter(r => r.project_id === p.id && r.status !== 'concluido').length;
      const card = Projects.renderCard(p, { total, abertas });
      card.querySelector('.btn-ver-project')?.addEventListener('click', () => openProjetoDetalhe(p.id));
      card.querySelector('.btn-edit-project')?.addEventListener('click', () => openEditProjeto(p));
      list.appendChild(card);
    });
  } catch (err) {
    showToast('Erro ao carregar projetos', 'error');
  }
}

async function openProjetoDetalhe(projectId) {
  currentProjectId = projectId;
  filterProjetoStatus = 'todos';
  navigateTo('projeto-detalhe');

  const header = document.getElementById('projeto-detalhe-header');
  const listEl = document.getElementById('list-projeto-pendencias');

  try {
    const projeto = await Projects.getById(projectId);
    header.innerHTML = `
      <h2>${escapeHtml(projeto.name)}</h2>
      <div class="meta">
        <span class="${'pendencia-status ' + (Projects.STATUS_COLORS[projeto.status] || '')}">${Projects.STATUS_LABELS[projeto.status]}</span>
        ${projeto.location ? `<span>📍 ${escapeHtml(projeto.location)}</span>` : ''}
        ${projeto.end_date ? `<span>🗓️ Até ${Requests.formatDate(projeto.end_date)}</span>` : ''}
      </div>
      ${projeto.description ? `<p style="margin-top:8px;font-size:14px;color:var(--text-secondary)">${escapeHtml(projeto.description)}</p>` : ''}
    `;
  } catch (err) { header.innerHTML = ''; }

  // Filtros do projeto
  document.querySelectorAll('#filter-status-projeto .filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#filter-status-projeto .filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      filterProjetoStatus = tab.dataset.status;
      loadProjetoPendencias(projectId);
    });
  });

  // Botão nova pendência dentro do projeto
  document.getElementById('btn-nova-pendencia-projeto').onclick = () => {
    navigateTo('nova');
    // Pré-seleciona o projeto no form nova (se existir campo)
  };

  loadProjetoPendencias(projectId);
}

async function loadProjetoPendencias(projectId) {
  const listEl = document.getElementById('list-projeto-pendencias');
  listEl.innerHTML = '';
  try {
    let reqs = await Requests.list({});
    reqs = reqs.filter(r => r.project_id === projectId);
    if (filterProjetoStatus !== 'todos') reqs = reqs.filter(r => r.status === filterProjetoStatus);

    if (!reqs.length) {
      listEl.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg><p>Nenhuma pendência neste projeto</p></div>';
      return;
    }
    reqs.forEach(req => {
      const card = Requests.renderCard(req);
      card.addEventListener('click', () => openDetalhe(req.id));
      listEl.appendChild(card);
    });
  } catch (err) { showToast('Erro ao carregar pendências', 'error'); }
}

function setupProjetosModal() {
  const modal = document.getElementById('modal-projeto');
  const form = document.getElementById('form-projeto');

  document.getElementById('btn-novo-projeto').addEventListener('click', () => {
    document.getElementById('modal-projeto-title').textContent = 'Nova Grande Obra';
    document.getElementById('projeto-edit-id').value = '';
    form.reset();
    modal.classList.remove('hidden');
  });
  document.getElementById('close-modal-projeto').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('cancel-modal-projeto').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('projeto-edit-id').value;
    const fields = {
      name: document.getElementById('projeto-nome').value.trim(),
      location: document.getElementById('projeto-local').value.trim(),
      description: document.getElementById('projeto-desc').value.trim(),
      status: document.getElementById('projeto-status').value,
      endDate: document.getElementById('projeto-end').value
    };
    try {
      if (id) {
        await Projects.update(id, { name: fields.name, location: fields.location, description: fields.description, status: fields.status, end_date: fields.endDate || null });
        showToast('Projeto atualizado ✓', 'success');
      } else {
        await Projects.create(fields);
        showToast('Projeto criado ✓', 'success');
      }
      modal.classList.add('hidden');
      await Projects.list();
      loadProjetos();
    } catch (err) {
      showToast('Erro ao salvar projeto', 'error');
    }
  });
}

function openEditProjeto(projeto) {
  document.getElementById('modal-projeto-title').textContent = 'Editar Grande Obra';
  document.getElementById('projeto-edit-id').value = projeto.id;
  document.getElementById('projeto-nome').value = projeto.name;
  document.getElementById('projeto-local').value = projeto.location || '';
  document.getElementById('projeto-desc').value = projeto.description || '';
  document.getElementById('projeto-status').value = projeto.status;
  document.getElementById('projeto-end').value = projeto.end_date || '';
  document.getElementById('modal-projeto').classList.remove('hidden');
}

// =============================================
// FINANCEIRO
// =============================================

let filterGastoDest = 'todos';
let filterGastoCat = '';
let tipoGasto = 'socio';

// ---- Tipo de destino ----
function setDestGasto(dest) {
  tipoGasto = dest;
  document.querySelectorAll('.dest-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.dest === dest);
  });
  document.querySelector('.dest-field-socio')  .classList.toggle('hidden', dest !== 'socio');
  document.querySelector('.dest-field-familia').classList.toggle('hidden', dest !== 'familia');
  document.querySelector('.dest-field-obra')   .classList.toggle('hidden', dest !== 'obra');
}

// ---- Carrega view Financeiro ----
async function loadFinanceiro() {
  const list = document.getElementById('list-expenses');
  const empty = document.getElementById('empty-expenses');
  list.querySelectorAll('.expense-card').forEach(c => c.remove());

  try {
    const filters = {};
    if (filterGastoDest !== 'todos') filters.destinationType = filterGastoDest;
    if (filterGastoCat)              filters.category = filterGastoCat;

    const [expenses, totals] = await Promise.all([
      Finance.list(filters),
      Finance.getTotals()
    ]);

    document.getElementById('fin-total').textContent  = Finance.formatBRL(totals.total);
    document.getElementById('fin-pago').textContent   = Finance.formatBRL(totals.pago);
    document.getElementById('fin-semana').textContent = Finance.formatBRL(totals.semana);

    if (!expenses.length) {
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      expenses.forEach(e => {
        const card = Finance.renderCard(e);
        card.addEventListener('click', () => openDetalheGasto(e.id));
        list.appendChild(card);
      });
    }
  } catch (err) {
    showToast('Erro ao carregar gastos', 'error');
    console.error(err);
  }
}

// ---- Detalhe do gasto (modal simples p/ excluir/editar pagamento) ----
async function openDetalheGasto(id) {
  try {
    const exp = await Finance.getById(id);
    const destInfo = exp.destination_type === 'socio'   ? ((exp.destination_socio_name || '—').toUpperCase())
                   : exp.destination_type === 'familia' ? (exp.destination_family || '—')
                   : (exp.projects?.name || exp.properties?.name || 'Obra');
    const msg = `Valor: ${Finance.formatBRL(exp.amount)}\n` +
                `Descrição: ${exp.description}\n` +
                `Direcionado a: ${exp.destination_type} — ${destInfo}\n` +
                `Data: ${exp.expense_date}\n` +
                (exp.worker_name ? `Prestador: ${exp.worker_name}\n` : '') +
                `\nExcluir este gasto?`;
    if (confirm(msg)) {
      await Finance.remove(id);
      showToast('Gasto excluído', 'success');
      loadFinanceiro();
    }
  } catch (err) {
    showToast('Erro ao abrir gasto', 'error');
    console.error(err);
  }
}

// ---- Novo Gasto ----
async function openNovoGasto() {
  document.getElementById('form-gasto').reset();
  document.getElementById('gasto-error').classList.add('hidden');
  document.getElementById('gasto-data').value = new Date().toISOString().slice(0, 10);
  document.getElementById('gasto-worker-fields').classList.add('hidden');
  setDestGasto('socio');

  // Popula selects
  await populateSociosSelect('gasto-socio');
  await Properties.populateSelects(['gasto-imovel']);
  await Projects.populateSelect('gasto-projeto');
}

// Lista fixa dos sócios (mesmas entidades do pró-labore do PRB)
const SOCIOS_PRB = ['paulo', 'rafael', 'bruno'];

function populateSociosSelect(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">Selecione o sócio</option>';
  SOCIOS_PRB.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s.charAt(0).toUpperCase() + s.slice(1);
    sel.appendChild(opt);
  });
}

function setupGastoForm() {
  const form = document.getElementById('form-gasto');

  // Mostra campos de prestador quando categoria exige
  document.getElementById('gasto-cat').addEventListener('change', (e) => {
    const show = ['servico', 'pedreiro'].includes(e.target.value);
    document.getElementById('gasto-worker-fields').classList.toggle('hidden', !show);
  });

  // Imóvel e projeto — apenas 1 por vez
  document.getElementById('gasto-imovel').addEventListener('change', () => {
    if (document.getElementById('gasto-imovel').value)
      document.getElementById('gasto-projeto').value = '';
  });
  document.getElementById('gasto-projeto').addEventListener('change', () => {
    if (document.getElementById('gasto-projeto').value)
      document.getElementById('gasto-imovel').value = '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-salvar-gasto');
    const errEl = document.getElementById('gasto-error');
    errEl.classList.add('hidden');

    const valor = parseFloat(document.getElementById('gasto-valor').value);
    const desc  = document.getElementById('gasto-desc').value.trim();
    const data  = document.getElementById('gasto-data').value;
    const cat   = document.getElementById('gasto-cat').value;

    if (!valor || valor <= 0 || !desc || !data || !cat) {
      errEl.textContent = 'Preencha valor, descrição, data e categoria.';
      errEl.classList.remove('hidden');
      return;
    }

    const payload = {
      description: desc,
      amount: valor,
      expense_date: data,
      category: cat,
      service_type: document.getElementById('gasto-servicetype').value.trim() || null,
      worker_name:  document.getElementById('gasto-worker').value.trim() || null,
      notes:        document.getElementById('gasto-notes').value.trim() || null,
      destination_type: tipoGasto
    };

    if (tipoGasto === 'socio') {
      payload.destination_socio_name = document.getElementById('gasto-socio').value;
      if (!payload.destination_socio_name) {
        errEl.textContent = 'Selecione o sócio.';
        errEl.classList.remove('hidden'); return;
      }
    } else if (tipoGasto === 'familia') {
      payload.destination_family = document.getElementById('gasto-familia').value.trim();
      if (!payload.destination_family) {
        errEl.textContent = 'Informe o nome do familiar.';
        errEl.classList.remove('hidden'); return;
      }
    } else if (tipoGasto === 'obra') {
      payload.property_id = document.getElementById('gasto-imovel').value || null;
      payload.project_id  = document.getElementById('gasto-projeto').value || null;
    }

    setLoading(btn, true, 'Salvando...');
    try {
      await Finance.create(payload);
      showToast('Gasto lançado! Sócios notificados ✓', 'success');
      navigateTo('financeiro');
    } catch (err) {
      errEl.textContent = 'Erro ao salvar: ' + err.message;
      errEl.classList.remove('hidden');
      setLoading(btn, false);
      console.error(err);
    }
  });
}

// ---- Filtros da view Financeiro ----
function setupFinanceiroFilters() {
  document.getElementById('filter-fin-dest').addEventListener('click', (e) => {
    const tab = e.target.closest('.filter-tab');
    if (!tab) return;
    document.querySelectorAll('#filter-fin-dest .filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    filterGastoDest = tab.dataset.dest;
    loadFinanceiro();
  });
  document.getElementById('filter-fin-cat').addEventListener('change', (e) => {
    filterGastoCat = e.target.value;
    loadFinanceiro();
  });
  document.getElementById('btn-novo-gasto').addEventListener('click', () => navigateTo('novo-gasto'));
}

// ---- Pagamento da Semana ----
async function loadSemana() {
  const listEl = document.getElementById('list-workers');
  listEl.innerHTML = '<div style="text-align:center;padding:32px"><div class="loading-spinner" style="margin:0 auto;border-color:rgba(0,0,0,0.15);border-top-color:var(--fin-primary)"></div></div>';

  try {
    const { range, groups } = await Finance.getWeekWorkers();

    // Header
    const [y1,m1,d1] = range.start.split('-');
    const [y2,m2,d2] = range.end.split('-');
    document.getElementById('week-range').textContent =
      `${d1}/${m1} → ${d2}/${m2}/${y2}`;
    document.getElementById('week-title').textContent =
      'Prestadores da semana';
    const totalPending = groups.reduce((s, g) => s + g.total_pending, 0);
    document.getElementById('week-total-pending').textContent =
      Finance.formatBRL(totalPending);

    listEl.innerHTML = '';
    if (!groups.length) {
      listEl.innerHTML = '<div class="empty-state"><p>Nenhum gasto de serviço nesta semana</p></div>';
      return;
    }

    groups.forEach(g => {
      const card = Finance.renderWeekWorkerCard(g);
      listEl.appendChild(card);

      // Copiar PIX
      card.querySelector('.btn-copy-pix').addEventListener('click', () => {
        const pix = card.querySelector('.input-pix').value.trim();
        if (!pix) return showToast('Informe a chave PIX primeiro', 'error');
        navigator.clipboard?.writeText(pix).then(
          () => showToast('Chave PIX copiada ✓', 'success'),
          () => showToast('Não foi possível copiar', 'error')
        );
      });

      // Pagar item individual
      card.querySelectorAll('.btn-pay-item').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          const pix = card.querySelector('.input-pix').value.trim();
          setLoading(btn, true, '...');
          try {
            await Finance.markPaid(id, { pix_key: pix });
            showToast('Marcado como pago ✓', 'success');
            loadSemana();
          } catch (err) {
            showToast('Erro ao pagar', 'error');
            setLoading(btn, false);
          }
        });
      });

      // Pagar tudo da semana (do prestador)
      const payAll = card.querySelector('.btn-pay-all');
      payAll.addEventListener('click', async () => {
        const pix = card.querySelector('.input-pix').value.trim();
        const pend = g.items.filter(i => !i.paid);
        if (!pend.length) return;
        if (!confirm(`Marcar ${pend.length} lançamento(s) de ${g.worker_name} como PAGO?`)) return;
        setLoading(payAll, true, '...');
        try {
          await Promise.all(pend.map(i => Finance.markPaid(i.id, { pix_key: pix })));
          showToast('Semana paga ✓', 'success');
          loadSemana();
        } catch (err) {
          showToast('Erro no pagamento', 'error');
          setLoading(payAll, false);
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = '<div class="empty-state"><p>Erro ao carregar</p></div>';
    console.error(err);
  }
}

// ---- Image Viewer ----

function openImageViewer(url) {
  const viewer = document.createElement('div');
  viewer.className = 'img-viewer';
  viewer.innerHTML = `
    <img src="${url}" alt="Foto">
    <button class="img-viewer-close">×</button>
  `;
  viewer.querySelector('.img-viewer-close').addEventListener('click', () => viewer.remove());
  viewer.addEventListener('click', (e) => { if (e.target === viewer) viewer.remove(); });
  document.body.appendChild(viewer);
}
