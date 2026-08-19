/**
 * ============================================================
 * BACKEND.JS — Connexion au serveur (Supabase)
 * Centralise toute la communication avec Supabase : authentification
 * (email/mot de passe), chargement/sauvegarde des données de jeu
 * (partagées, "game_data") et des sauvegardes joueur ("player_saves").
 * Aucune logique de jeu ici — uniquement le transport des données.
 * ============================================================
 */

'use strict';

const WBBackend = (() => {

  // Project URL + clé publique (sûre à exposer côté client, cf. RLS pour la sécurité réelle)
  const SUPABASE_URL = 'https://dvssuwhgcxpjdbkqllnt.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_lgqyY4rrTMefClxYclHfpQ_uCX-grLg';

  let _client = null;
  let _currentUserId = null;

  /** Mémorise l'utilisateur actuellement connecté (appelé une fois au démarrage) */
  function setCurrentUserId(id) { _currentUserId = id; }
  /** @returns {string|null} l'ID du compte actuellement connecté */
  function getCurrentUserId() { return _currentUserId; }

  /** Accès direct au client Supabase (utilisé par audio.js pour le Storage) */
  function storageClient() { return _client.storage; }

  /** Initialise le client Supabase. À appeler une seule fois, avant tout le reste. */
  function init() {
    if (_client) return _client;
    if (!window.supabase?.createClient) {
      throw new Error('[WBBackend] Librairie supabase-js introuvable (script CDN non chargé ?)');
    }
    _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return _client;
  }

  // ─── AUTHENTIFICATION ──────────────────────────────────────────────────────

  /** Session active, ou null si personne n'est connecté */
  async function getSession() {
    const { data, error } = await _client.auth.getSession();
    if (error) { console.error('[WBBackend] getSession:', error); return null; }
    return data.session;
  }

  /** Inscription par email/mot de passe. Lève une erreur lisible en cas d'échec. */
  async function signUp(email, password) {
    const { data, error } = await _client.auth.signUp({ email, password });
    if (error) throw new Error(_friendlyAuthError(error));
    return data;
  }

  /** Connexion par email/mot de passe. Lève une erreur lisible en cas d'échec. */
  async function signIn(email, password) {
    const { data, error } = await _client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(_friendlyAuthError(error));
    return data;
  }

  async function signOut() {
    await _client.auth.signOut();
  }

  /** Traduit les erreurs Supabase les plus courantes en français lisible */
  function _friendlyAuthError(error) {
    const msg = error?.message || '';
    if (/already registered|already exists/i.test(msg))   return 'Un compte existe déjà avec cet email.';
    if (/invalid login credentials/i.test(msg))            return 'Email ou mot de passe incorrect.';
    if (/password.*(least|short|6 characters)/i.test(msg)) return 'Le mot de passe doit faire au moins 6 caractères.';
    if (/invalid email/i.test(msg))                        return 'Adresse email invalide.';
    if (/rate limit/i.test(msg))                            return 'Trop de tentatives, réessaie dans quelques instants.';
    return msg || 'Une erreur est survenue.';
  }

  // ─── DONNÉES DE JEU (structurelles, partagées, admin uniquement en écriture) ─

  /**
   * Charge les données structurelles du jeu (personnages, équipements, config...).
   * @returns {object} objet vide {} si rien n'a encore été sauvegardé par l'admin
   */
  async function loadGameData() {
    const { data, error } = await _client
      .from('game_data').select('data').eq('id', 'main').maybeSingle();
    if (error) { console.error('[WBBackend] loadGameData:', error); return {}; }
    return data?.data || {};
  }

  /** Sauvegarde les données structurelles (rejeté côté serveur si le compte n'est pas admin) */
  async function saveGameData(structuralData) {
    const { error } = await _client
      .from('game_data')
      .upsert({ id: 'main', data: structuralData, updated_at: new Date().toISOString() });
    if (error) { console.error('[WBBackend] saveGameData:', error); throw new Error(error.message || 'Échec de sauvegarde des données de jeu'); }
  }

  // ─── SAUVEGARDE JOUEUR (privée, une ligne par compte) ─────────────────────────

  /**
   * Charge la sauvegarde du joueur connecté.
   * @returns {object|null} null si c'est un tout nouveau compte (jamais sauvegardé)
   */
  async function loadPlayerSave(userId) {
    const { data, error } = await _client
      .from('player_saves').select('data').eq('user_id', userId).maybeSingle();
    if (error) { console.error('[WBBackend] loadPlayerSave:', error); return null; }
    return data?.data || null;
  }

  /** Sauvegarde (crée ou met à jour) la progression du joueur connecté */
  async function savePlayerData(userId, playerData) {
    const { error } = await _client
      .from('player_saves')
      .upsert({ user_id: userId, data: playerData, updated_at: new Date().toISOString() });
    if (error) { console.error('[WBBackend] savePlayerData:', error); throw new Error(error.message || 'Échec de sauvegarde de la progression joueur'); }
  }

  // ─── PROFIL / DROITS ADMIN ─────────────────────────────────────────────────

  /** @returns {boolean} true si ce compte a les droits d'administration */
  async function isCurrentUserAdmin(userId) {
    const { data, error } = await _client
      .from('profiles').select('is_admin').eq('id', userId).maybeSingle();
    if (error) { console.error('[WBBackend] isCurrentUserAdmin:', error); return false; }
    return !!data?.is_admin;
  }

  // ─── ADMIN : TOUS LES COMPTES JOUEURS ──────────────────────────────────────
  // Nécessite les droits admin (appliqué côté serveur par les policies RLS
  // ajoutées via supabase_setup_admin_accounts.sql — un compte non-admin
  // obtient simplement une liste vide, jamais une erreur qui casserait l'UI).

  /** @returns {Array<{id, display_name, is_admin, created_at}>} tous les profils joueurs */
  async function loadAllProfiles() {
    const { data, error } = await _client
      .from('profiles').select('id, display_name, is_admin, created_at');
    if (error) { console.error('[WBBackend] loadAllProfiles:', error); return []; }
    return data || [];
  }

  /** @returns {Array<{user_id, data, updated_at}>} la sauvegarde de TOUS les joueurs */
  async function loadAllPlayerSaves() {
    const { data, error } = await _client
      .from('player_saves').select('user_id, data, updated_at');
    if (error) { console.error('[WBBackend] loadAllPlayerSaves:', error); return []; }
    return data || [];
  }

  /** @returns {Array<{user_id, backed_up_at}>} la liste des sauvegardes de secours disponibles */
  async function loadBackupDates() {
    const { data, error } = await _client
      .from('player_saves_backup').select('user_id, backed_up_at');
    if (error) { console.error('[WBBackend] loadBackupDates:', error); return []; }
    return data || [];
  }

  /** Restaure la sauvegarde de secours d'un joueur (écrase sa sauvegarde actuelle) */
  async function restorePlayerFromBackup(userId) {
    const { data, error } = await _client
      .from('player_saves_backup').select('data').eq('user_id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Aucune sauvegarde de secours trouvée pour ce joueur.');
    await savePlayerData(userId, data.data);
  }

  // ─── CLASSEMENTS (leaderboards) ────────────────────────────────────────────

  /**
   * Publie les chiffres de classement du joueur connecté (calculés localement,
   * cf. WBGameState.getLeaderboardSnapshot()). Chaque joueur ne peut publier
   * que sa propre ligne (cf. policies RLS).
   */
  async function saveLeaderboardStats(userId, displayName, stats) {
    const { error } = await _client.from('leaderboard_stats').upsert({
      user_id: userId,
      display_name: displayName,
      aura_total: stats.auraTotal,
      tournee_progress: stats.tourneeProgress,
      gallery_entries: stats.galleryEntries,
      trophy_best_score: stats.trophyBestScore,
      pvp_elo: stats.pvpEloAsync,
      pvp_elo_live: stats.pvpEloLive,
      updated_at: new Date().toISOString(),
    });
    if (error) console.error('[WBBackend] saveLeaderboardStats:', error);
  }

  /**
   * Charge le classement public, trié par la colonne demandée.
   * @param {'aura_total'|'tournee_progress'|'gallery_entries'|'trophy_best_score'|'pvp_elo'|'pvp_elo_live'} column
   * @param {number} [limit=100]
   */
  async function loadLeaderboard(column, limit = 100) {
    const { data, error } = await _client
      .from('leaderboard_stats')
      .select(`user_id, display_name, ${column}`)
      .order(column, { ascending: false })
      .limit(limit);
    if (error) { console.error('[WBBackend] loadLeaderboard:', error); return []; }
    return data || [];
  }

  // ─── PVP (équipes de défense publiques, matchmaking aléatoire) ───────────────

  /** Publie/actualise son équipe de défense PvP (stats déjà calculées, ELO, victoires/défaites) */
  async function savePvpDefenseTeam(userId, displayName, teamSnapshot, elo, wins, losses) {
    const { error } = await _client.from('pvp_defense_teams').upsert({
      user_id: userId,
      display_name: displayName,
      team_snapshot: teamSnapshot,
      elo, wins, losses,
      updated_at: new Date().toISOString(),
    });
    if (error) console.error('[WBBackend] savePvpDefenseTeam:', error);
  }

  /**
   * Tire un adversaire PvP au hasard parmi les joueurs ayant publié une équipe
   * de défense (jamais soi-même). Retourne null si aucun adversaire disponible.
   * @param {string} excludeUserId
   */
  async function loadRandomPvpOpponent(excludeUserId) {
    // On récupère un lot (jusqu'à 50) puis on tire au hasard côté client —
    // Supabase ne propose pas nativement un "ORDER BY random()" simple à filtrer.
    const { data, error } = await _client
      .from('pvp_defense_teams')
      .select('user_id, display_name, team_snapshot, elo, wins, losses')
      .neq('user_id', excludeUserId)
      .limit(50);
    if (error) { console.error('[WBBackend] loadRandomPvpOpponent:', error); return null; }
    if (!data || data.length === 0) return null;
    return data[Math.floor(Math.random() * data.length)];
  }

  /** Charge une petite liste d'adversaires PvP potentiels (pour l'animation de roulette) */
  async function loadPvpOpponentPool(excludeUserId, limit = 12) {
    const { data, error } = await _client
      .from('pvp_defense_teams')
      .select('user_id, display_name, elo, team_snapshot')
      .neq('user_id', excludeUserId)
      .limit(limit);
    if (error) { console.error('[WBBackend] loadPvpOpponentPool:', error); return []; }
    return data || [];
  }

  // ─── DUEL EN DIRECT (PvP temps réel) ──────────────────────────────────────────

  /** Rejoint la file d'attente du Duel en Direct */
  async function joinPvpLiveQueue(userId, displayName, elo, teamSnapshot) {
    const { error } = await _client.from('pvp_live_queue').upsert({
      user_id: userId, display_name: displayName, elo, team_snapshot: teamSnapshot, joined_at: new Date().toISOString(),
    });
    if (error) console.error('[WBBackend] joinPvpLiveQueue:', error);
  }

  /** Quitte la file d'attente (recherche annulée) */
  async function leavePvpLiveQueue(userId) {
    const { error } = await _client.from('pvp_live_queue').delete().eq('user_id', userId);
    if (error) console.error('[WBBackend] leavePvpLiveQueue:', error);
  }

  /**
   * Cherche un autre joueur déjà en attente (jamais soi-même). Ne retire PAS
   * la ligne trouvée — c'est à l'appelant de gérer la création du salon et le
   * retrait des deux lignes de la file, pour limiter le risque de double-appariement.
   */
  async function findPvpLiveOpponent(excludeUserId) {
    const { data, error } = await _client
      .from('pvp_live_queue')
      .select('user_id, display_name, elo, team_snapshot')
      .neq('user_id', excludeUserId)
      .order('joined_at', { ascending: true })
      .limit(1);
    if (error) { console.error('[WBBackend] findPvpLiveOpponent:', error); return null; }
    return (data && data[0]) || null;
  }

  /** Crée le salon de duel (appelé par celui qui déclenche l'appariement) */
  async function createPvpLiveDuel(duel) {
    const { data, error } = await _client.from('pvp_live_duels').insert(duel).select().single();
    if (error) { console.error('[WBBackend] createPvpLiveDuel:', error); return null; }
    return data;
  }

  /** Charge l'état actuel d'un salon de duel (utile à la reconnexion) */
  async function loadPvpLiveDuel(duelId) {
    const { data, error } = await _client.from('pvp_live_duels').select('*').eq('id', duelId).single();
    if (error) { console.error('[WBBackend] loadPvpLiveDuel:', error); return null; }
    return data;
  }

  /** Met à jour l'état du salon de duel (appelé par l'hôte après chaque action résolue) */
  async function updatePvpLiveDuel(duelId, patch) {
    const { error } = await _client.from('pvp_live_duels')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', duelId);
    if (error) console.error('[WBBackend] updatePvpLiveDuel:', error);
  }

  /** S'abonne aux mises à jour en temps réel d'un salon de duel précis */
  function subscribePvpLiveDuel(duelId, onUpdate) {
    const channel = _client
      .channel(`pvp_duel_${duelId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pvp_live_duels', filter: `id=eq.${duelId}` },
        (payload) => onUpdate(payload.new))
      .subscribe();
    return () => _client.removeChannel(channel);
  }

  /** Cherche un salon de duel actif où l'utilisateur est participant (hôte OU invité) */
  async function findMyActivePvpLiveDuel(userId) {
    const { data, error } = await _client
      .from('pvp_live_duels')
      .select('*')
      .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
      .neq('status', 'finished')
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) { console.error('[WBBackend] findMyActivePvpLiveDuel:', error); return null; }
    return (data && data[0]) || null;
  }

  return {
    init, getSession, signUp, signIn, signOut,
    loadGameData, saveGameData, loadPlayerSave, savePlayerData,
    isCurrentUserAdmin, setCurrentUserId, getCurrentUserId, storageClient,
    loadAllProfiles, loadAllPlayerSaves, loadBackupDates, restorePlayerFromBackup,
    saveLeaderboardStats, loadLeaderboard,
    savePvpDefenseTeam, loadRandomPvpOpponent, loadPvpOpponentPool,
    joinPvpLiveQueue, leavePvpLiveQueue, findPvpLiveOpponent,
    createPvpLiveDuel, loadPvpLiveDuel, updatePvpLiveDuel, subscribePvpLiveDuel,
    findMyActivePvpLiveDuel,
  };
})();
