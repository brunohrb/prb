// =============================================
// AUTH MODULE - Bandeira Obras
// =============================================

const Auth = (() => {
  let currentUser = null;
  let currentProfile = null;

  const SAVED_USER_KEY    = 'bop_saved_user';
  const BIOMETRIC_KEY     = 'bop_biometric_cred';
  const BIOMETRIC_NEVER   = 'bop_biometric_never';

  // Converte nome de usuário simples para email interno
  function toEmail(username) {
    if (username.includes('@')) return username;
    return `${username.toLowerCase().trim()}@bandeira.app`;
  }

  // ---- Autenticação por senha ----

  async function login(username, password) {
    const email = toEmail(username);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function logout() {
    // Não limpa a biometria no logout — a credencial permanece válida no dispositivo.
    // Se a sessão expirar, verifyBiometric retorna SESSAO_EXPIRADA e o usuário refaz login com senha.
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    currentUser = null;
    currentProfile = null;
  }

  async function getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      currentUser = session.user;
      await loadProfile(session.user.id);
    }
    return session;
  }

  async function loadProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (!error && data) currentProfile = data;
    return currentProfile;
  }

  async function createUser(username, password, name, role) {
    const email = toEmail(username);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, role } }
    });
    if (error) throw error;

    if (data.user) {
      await supabase.from('profiles').upsert({ id: data.user.id, email, name, role });
    }

    if (data.user && !data.session) {
      throw new Error('CONFIRM_EMAIL');
    }

    return data;
  }

  // ---- Lembrar usuário ----

  function saveUsername(username) {
    localStorage.setItem(SAVED_USER_KEY, username.toLowerCase().trim());
  }

  function getSavedUsername() {
    return localStorage.getItem(SAVED_USER_KEY) || '';
  }

  function clearSavedUsername() {
    localStorage.removeItem(SAVED_USER_KEY);
  }

  // ---- Biometria (WebAuthn) ----

  async function isBiometricAvailable() {
    if (!window.PublicKeyCredential) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch { return false; }
  }

  function hasBiometricSaved() {
    return !!localStorage.getItem(BIOMETRIC_KEY);
  }

  async function registerBiometric(username) {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = new TextEncoder().encode(username);

    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Bandeira Obras', id: location.hostname },
        user: { id: userId, name: username, displayName: username },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },   // ES256 (Face ID / digital)
          { alg: -257, type: 'public-key' }   // RS256 (fallback)
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform', // biometria do próprio aparelho
          userVerification: 'required',
          residentKey: 'preferred'
        },
        timeout: 60000
      }
    });

    // Salva o ID da credencial no localStorage
    const rawId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
    localStorage.setItem(BIOMETRIC_KEY, rawId);
    return true;
  }

  // Verifica biometria e restaura a sessão Supabase existente
  async function verifyBiometric() {
    const rawIdStr = localStorage.getItem(BIOMETRIC_KEY);
    if (!rawIdStr) throw new Error('SEM_BIOMETRIA');

    const rawId = Uint8Array.from(atob(rawIdStr), c => c.charCodeAt(0));
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    // Abre o prompt de Face ID / digital
    try {
      await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ id: rawId, type: 'public-key' }],
          userVerification: 'required',
          timeout: 60000
        }
      });
    } catch (webAuthnErr) {
      // NotAllowedError = usuário cancelou (não limpa credencial)
      if (webAuthnErr.name === 'NotAllowedError') throw webAuthnErr;
      // Qualquer outro erro = credencial inválida/não encontrada no dispositivo
      localStorage.removeItem(BIOMETRIC_KEY);
      throw new Error('CREDENCIAL_INVALIDA');
    }

    // Biometria ok — verifica se ainda há sessão ativa
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
      localStorage.removeItem(BIOMETRIC_KEY); // limpa credencial expirada
      throw new Error('SESSAO_EXPIRADA');
    }

    currentUser = session.user;
    await loadProfile(session.user.id);
    return { session };
  }

  function clearBiometric() {
    localStorage.removeItem(BIOMETRIC_KEY);
  }

  function dismissBiometricOffer() {
    localStorage.setItem(BIOMETRIC_NEVER, '1');
  }

  function isBiometricOfferDismissed() {
    return !!localStorage.getItem(BIOMETRIC_NEVER);
  }

  // ---- Auth state listener ----

  function onAuthChange(callback) {
    return supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        currentUser = session.user;
        await loadProfile(session.user.id);
      } else {
        currentUser = null;
        currentProfile = null;
      }
      callback(event, session);
    });
  }

  // ---- Getters ----
  function getUser() { return currentUser; }
  function getProfile() { return currentProfile; }
  function isLoggedIn() { return !!currentUser; }
  function isResponsavel() { return currentProfile?.role === 'responsavel'; }
  function isSocio() { return currentProfile?.role === 'socio'; }
  function isAdmin() { return currentProfile?.role === 'socio'; }

  return {
    login, logout, getSession, loadProfile, createUser,
    saveUsername, getSavedUsername, clearSavedUsername,
    isBiometricAvailable, hasBiometricSaved, registerBiometric, verifyBiometric, clearBiometric,
    dismissBiometricOffer, isBiometricOfferDismissed,
    getUser, getProfile, isLoggedIn, isResponsavel, isSocio, isAdmin,
    onAuthChange
  };
})();
