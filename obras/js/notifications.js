// =============================================
// NOTIFICATIONS MODULE - Bandeira Obras
// Notificações em tempo real via Supabase
// =============================================

const Notifications = (() => {
  let realtimeChannel = null;
  let unreadCount = 0;

  // ---- Envio de notificações ----

  // Busca nome do imóvel ou projeto vinculado à pendência
  async function getLocationName(request) {
    if (request.property_id) {
      const { data: prop } = await supabase
        .from('properties')
        .select('name, unit')
        .eq('id', request.property_id)
        .single();
      if (prop) return prop.unit ? `${prop.unit} · ${prop.name}` : prop.name;
    }
    if (request.project_id) {
      const { data: proj } = await supabase
        .from('projects')
        .select('name')
        .eq('id', request.project_id)
        .single();
      if (proj) return `🏗️ ${proj.name}`;
    }
    return 'imóvel';
  }

  // Notifica responsáveis quando nova pendência é criada
  async function notifyNew(request) {
    // Busca todos os responsáveis
    const { data: responsaveis } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'responsavel');

    if (!responsaveis?.length) return;

    const locationName = await getLocationName(request);

    const notifications = responsaveis.map(r => ({
      user_id: r.id,
      request_id: request.id,
      type: 'nova_pendencia',
      message: `📋 Nova pendência em ${locationName}: "${request.title}" — ${Requests.urgencyLabel(request.urgency)}`
    }));

    await supabase.from('notifications').insert(notifications);
  }

  // Notifica criador quando pendência é concluída
  async function notifyDone(request) {
    if (!request.created_by) return;

    const locationName = await getLocationName(request);

    await supabase.from('notifications').insert({
      user_id: request.created_by,
      request_id: request.id,
      type: 'concluido',
      message: `✅ Pendência concluída em ${locationName}: "${request.title}"`
    });
  }

  // Notifica criador quando status muda
  async function notifyUpdate(request, newStatus) {
    if (!request.created_by) return;

    const locationName = await getLocationName(request);

    const statusMessages = {
      'em andamento': `🔨 Pendência em andamento em ${locationName}: "${request.title}"`,
      'pendente': `↩ Pendência retornou para pendente em ${locationName}: "${request.title}"`
    };

    await supabase.from('notifications').insert({
      user_id: request.created_by,
      request_id: request.id,
      type: 'atualizado',
      message: statusMessages[newStatus] || `🔨 Pendência atualizada em ${locationName}: "${request.title}"`
    });
  }

  // ---- Leitura de notificações ----

  async function list() {
    const userId = Auth.getUser()?.id;
    if (!userId) return [];

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return data || [];
  }

  async function getUnreadCount() {
    const userId = Auth.getUser()?.id;
    if (!userId) return 0;

    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false);

    unreadCount = count || 0;
    return unreadCount;
  }

  async function markAllRead() {
    const userId = Auth.getUser()?.id;
    if (!userId) return;
    await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false);
    unreadCount = 0;
    updateBadges(0);
  }

  async function markRead(id) {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
  }

  // ---- Real-time ----

  function subscribe() {
    const userId = Auth.getUser()?.id;
    if (!userId) return;

    // Cancela subscription anterior
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
    }

    realtimeChannel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`
        },
        (payload) => {
          handleNewNotification(payload.new);
        }
      )
      .subscribe();
  }

  function unsubscribe() {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  }

  function handleNewNotification(notif) {
    unreadCount++;
    updateBadges(unreadCount);
    showBrowserNotification(notif.message);
    showToast(notif.message, 'info');
  }

  // ---- UI ----

  function updateBadges(count) {
    const badge = document.getElementById('notif-badge');
    const badgeNav = document.getElementById('notif-badge-nav');

    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
    if (badgeNav) {
      if (count > 0) {
        badgeNav.textContent = count > 99 ? '99+' : count;
        badgeNav.classList.remove('hidden');
      } else {
        badgeNav.classList.add('hidden');
      }
    }
  }

  // Notificação do browser (quando app está aberto)
  async function requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }

  function showBrowserNotification(message) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    // Só mostra se o app não está em foco
    if (!document.hidden) return; // Já mostra via toast
    new Notification('Bandeira Obras', {
      body: message,
      icon: 'assets/logo.png',
      badge: 'assets/logo.png',
      vibrate: [200, 100, 200]
    });
  }

  // Renderiza item de notificação
  function renderItem(notif) {
    const time = timeAgo(new Date(notif.created_at));
    const icons = {
      nova_pendencia: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>`,
      concluido: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
      atualizado: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>`
    };

    const item = document.createElement('div');
    item.className = `notif-item ${notif.read ? 'lida' : ''}`;
    item.dataset.id = notif.id;
    item.dataset.requestId = notif.request_id;
    item.innerHTML = `
      <div class="notif-icon ${notif.type}">${icons[notif.type] || icons.atualizado}</div>
      <div class="notif-body">
        <div class="notif-msg">${escapeHtml(notif.message)}</div>
        <div class="notif-time">${time}</div>
      </div>
      <div class="notif-dot ${notif.read ? 'hidden' : ''}"></div>
    `;
    return item;
  }

  function timeAgo(date) {
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return 'Agora mesmo';
    if (diff < 3600) return `${Math.floor(diff / 60)} min atrás`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d atrás`;
    return date.toLocaleDateString('pt-BR');
  }

  return {
    notifyNew,
    notifyDone,
    notifyUpdate,
    list,
    getUnreadCount,
    markAllRead,
    markRead,
    subscribe,
    unsubscribe,
    updateBadges,
    requestPermission,
    renderItem,
    timeAgo
  };
})();
