/**
 * ============================================================
 * UI.JS — Interface utilisateur du jeu
 * Gère tous les écrans : Collection, Préparation, Gacha, Combat, Catalogue
 * ============================================================
 */

'use strict';

const WBGameUI = (() => {

  // ─── ÉTAT UI ──────────────────────────────────────────────────────────────────
  let _currentScreen = 'collection';
  let _battle        = null;
  let _combatMode    = 'story';   // 'story' | 'line' | 'fullRandom' | 'arena'
  let _selectedLine  = null;       // ID de la lignée évolutive choisie en mode 'line'
  let _selectedArenaType = null;   // ID du type choisi en mode 'arena'
  let _gachaTab      = 'chars';   // 'chars' | 'equip'
  let _equipCharId   = null;       // instanceId du perso sélectionné dans l'écran équip

  // Tri des listes de personnages (mémorisé indépendamment par écran)
  let _collectionSort   = 'name';
  let _collectionFilters = { search: '', rarity: '', type: '', statKey: 'level', statMin: '' };
  let _teamSort          = 'name';
  let _teamFilters       = { search: '', rarity: '', type: '', statKey: 'level', statMin: '' };
  let _equipSort         = 'name';   // tri du sélecteur de personnage (écran Équiper)
  let _equipSlotOpen     = null;     // slot actuellement ouvert dans le panneau inline (0/1/2 ou null)
  let _equipSlotSearch   = '';       // recherche texte dans le panneau inline de sélection de slot
  let _autoEquipResult   = null;     // résumé du dernier "Équipement auto" (affiché puis auto-effacé)
  let _autoEquipResultTimer = null;

  // Onglet d'équipement actif dans l'écran Équiper, et tri/filtre par onglet
  let _equipInvTab = 'weapon';
  let _equipInvSort = { weapon: 'name', armor: 'name', accessory: 'name' };
  let _equipInvFilters = {
    weapon:    { search: '', rarity: '', statKey: 'atk', statMin: '' },
    armor:     { search: '', rarity: '', statKey: 'def', statMin: '' },
    accessory: { search: '', rarity: '', statKey: 'hp',  statMin: '' },
  };
  let _equipUnequippedFilter = { weapon: false, armor: false, accessory: false }; // filtres "sans équipement" indépendants par catégorie

  const RARITY_ORDER  = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  const STAT_OPTIONS  = [
    { key: 'level', label: 'Niveau' },
    { key: 'hp',    label: 'PV' },
    { key: 'atk',   label: 'Puissance' },
    { key: 'def',   label: 'Résistance' },
    { key: 'spd',   label: 'Agilité' },
  ];

  // Slots d'équipement : 3 emplacements fixes, dans l'ordre des index 0/1/2
  const EQUIP_SLOT_ORDER  = WBGameDatabase.EQUIP_SLOTS || ['weapon', 'armor', 'accessory'];
  const EQUIP_SLOT_LABELS = { weapon: '⚔️ Arme', armor: '👗 Tenue', accessory: '💍 Bijou' };
  // Icône seule par catégorie d'équipement — alignée sur les catégories de l'admin
  // (épées croisées / bouclier / bague), utilisée partout où un équipement doit
  // afficher un symbole automatique (ex: vignette dans le Shop).
  const EQUIP_SLOT_ICON = { weapon: '⚔️', armor: '🛡️', accessory: '💍' };

  // ─── TRI & FILTRES DES PERSONNAGES ───────────────────────────────────────────────

  /**
   * Décore une liste d'instances avec leur définition et leurs stats calculées.
   * @param {Array<object>} instances
   * @param {object} state
   * @returns {Array<{inst:object, def:object, stats:object}>}
   */
  function _decorateInstances(instances, state) {
    return instances.map(inst => {
      const def = WBGameState.getCharDef(inst.charId);
      if (!def) return null;
      const stats = _computeFullStats(inst, def).total;
      const aura  = WBGameDatabase.computeAuraScore(stats, state.config.combat);
      return { inst, def, stats, aura };
    }).filter(Boolean);
  }

  /**
   * Filtre une liste décorée de personnages selon une recherche par nom, une rareté,
   * un type (principal ou secondaire), et un seuil minimum sur une stat au choix.
   * @param {Array<{inst,def,stats}>} decorated
   * @param {{search:string, rarity:string, type:string, statKey:string, statMin:string}} filters
   */
  function _applyCharFilters(decorated, filters) {
    if (!filters) return decorated;
    return decorated.filter(({ inst, def, stats }) => {
      if (filters.search && !def.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
      if (filters.rarity && def.rarity !== filters.rarity) return false;
      if (filters.type && def.type1 !== filters.type && def.type2 !== filters.type) return false;
      if (filters.statKey && filters.statMin !== '' && filters.statMin != null) {
        const val = filters.statKey === 'level' ? inst.level : stats[filters.statKey];
        if (val < Number(filters.statMin)) return false;
      }
      return true;
    });
  }

  /**
   * Trie une liste décorée de personnages.
   * @param {Array<{inst,def,stats}>} decorated
   * @param {'name'|'level'|'rarity'|'type'|'hp'|'atk'|'def'|'spd'} sortKey
   * @param {object} state
   */
  function _sortDecoratedChars(decorated, sortKey, state) {
    const types = state.types;
    const typeIndex   = (id) => { const idx = types.findIndex(t => t.id === id); return idx === -1 ? 999 : idx; };
    const rarityIndex = (r)  => { const idx = RARITY_ORDER.indexOf(r); return idx === -1 ? 0 : idx; };
    const sorted = [...decorated];
    switch (sortKey) {
      case 'level':  sorted.sort((a, b) => b.inst.level - a.inst.level || a.def.name.localeCompare(b.def.name)); break;
      case 'rarity':  sorted.sort((a, b) => rarityIndex(b.def.rarity) - rarityIndex(a.def.rarity) || a.def.name.localeCompare(b.def.name)); break;
      case 'type':    sorted.sort((a, b) => typeIndex(a.def.type1) - typeIndex(b.def.type1) || a.def.name.localeCompare(b.def.name)); break;
      case 'hp':      sorted.sort((a, b) => b.stats.hp  - a.stats.hp); break;
      case 'atk':     sorted.sort((a, b) => b.stats.atk - a.stats.atk); break;
      case 'def':     sorted.sort((a, b) => b.stats.def - a.stats.def); break;
      case 'spd':     sorted.sort((a, b) => b.stats.spd - a.stats.spd); break;
      case 'aura':    sorted.sort((a, b) => b.aura - a.aura); break;
      case 'name':
      default:        sorted.sort((a, b) => a.def.name.localeCompare(b.def.name)); break;
    }
    return sorted;
  }

  /** Pipeline complet : décore, filtre puis trie une liste de personnages */
  function _decorateFilterSortChars(instances, sortKey, filters, state) {
    return _sortDecoratedChars(_applyCharFilters(_decorateInstances(instances, state), filters), sortKey, state);
  }

  /** Génère un menu déroulant de tri (personnages) couvrant tous les critères demandés */
  function _renderSortSelect(id, current) {
    return `
      <select class="sort-select" id="${id}">
        <option value="name"   ${current === 'name'   ? 'selected' : ''}>Trier : Nom (A-Z)</option>
        <option value="level"  ${current === 'level'  ? 'selected' : ''}>Trier : Niveau</option>
        <option value="rarity" ${current === 'rarity' ? 'selected' : ''}>Trier : Rareté</option>
        <option value="type"   ${current === 'type'   ? 'selected' : ''}>Trier : Type</option>
        <option value="hp"     ${current === 'hp'     ? 'selected' : ''}>Trier : PV</option>
        <option value="atk"    ${current === 'atk'    ? 'selected' : ''}>Trier : Puissance</option>
        <option value="def"    ${current === 'def'    ? 'selected' : ''}>Trier : Résistance</option>
        <option value="spd"    ${current === 'spd'    ? 'selected' : ''}>Trier : Agilité</option>
        <option value="aura"   ${current === 'aura'   ? 'selected' : ''}>Trier : ⭐ Attrait</option>
      </select>
    `;
  }

  /**
   * Génère la barre de filtres réutilisable pour les écrans de personnages
   * (recherche par nom, rareté, type, seuil minimum sur une stat au choix).
   */
  function _renderCharFilterBar(prefix, filters, state) {
    return `
      <div class="filter-bar">
        <input type="text" class="search-input" id="${prefix}-search" placeholder="Rechercher un nom..." value="${filters.search || ''}">
        <select class="sort-select" id="${prefix}-filter-rarity">
          <option value="">Toutes raretés</option>
          ${RARITY_ORDER.map(r => `<option value="${r}" ${filters.rarity === r ? 'selected' : ''}>${RARITY_LABELS_FR[r]}</option>`).join('')}
        </select>
        <select class="sort-select" id="${prefix}-filter-type">
          <option value="">Tous types</option>
          ${state.types.map(t => `<option value="${t.id}" ${filters.type === t.id ? 'selected' : ''}>${t.icon} ${t.name}</option>`).join('')}
        </select>
        <div class="stat-filter-group">
          <select class="sort-select" id="${prefix}-filter-statkey">
            ${STAT_OPTIONS.map(s => `<option value="${s.key}" ${filters.statKey === s.key ? 'selected' : ''}>${s.label} ≥</option>`).join('')}
          </select>
          <input type="number" class="search-input stat-filter-input" id="${prefix}-filter-statmin" placeholder="min." value="${filters.statMin || ''}">
        </div>
      </div>
    `;
  }

  /** Lie les contrôles de la barre de filtres aux champs de l'objet filters fourni, et appelle onChange à chaque modification */
  function _bindCharFilterBar(prefix, filters, onChange) {
    document.getElementById(`${prefix}-search`)?.addEventListener('input', e => { filters.search = e.target.value; onChange(); });
    document.getElementById(`${prefix}-filter-rarity`)?.addEventListener('change', e => { filters.rarity = e.target.value; onChange(); });
    document.getElementById(`${prefix}-filter-type`)?.addEventListener('change', e => { filters.type = e.target.value; onChange(); });
    document.getElementById(`${prefix}-filter-statkey`)?.addEventListener('change', e => { filters.statKey = e.target.value; onChange(); });
    document.getElementById(`${prefix}-filter-statmin`)?.addEventListener('input', e => { filters.statMin = e.target.value; onChange(); });
  }

  const RARITY_LABELS_FR = {
    common: 'Commune', uncommon: 'Peu commune', rare: 'Rare',
    epic: 'Épique', legendary: 'Légendaire', mythic: 'Mythique',
  };

  // ─── INITIALISATION ──────────────────────────────────────────────────────────

  function init() {
    _renderNav();
    _bindNav();
    WBAudioSystem.init().then(() => WBAudioSystem.playGlobal());
    _bindMusicToggle();
    // Les navigateurs bloquent le son tant qu'il n'y a pas eu d'interaction :
    // on active donc le son (à 10%) dès le tout premier clic/touche/tap du joueur,
    // sans qu'il ait besoin de cliquer explicitement sur le bouton 🔊.
    const _autoEnableSound = (e) => {
      // Ne pas interférer si le joueur clique justement sur le bouton son / sa popup
      // de volume : son propre gestionnaire de clic sait déjà activer le son correctement.
      if (e.target.closest && e.target.closest('#music-toggle, #volume-popup')) return;
      WBAudioSystem.enableSound();
      _updateMusicToggle();
    };
    document.addEventListener('pointerdown', _autoEnableSound, { once: true });
    document.addEventListener('keydown',     _autoEnableSound, { once: true });
    showScreen('hub');
    _startResourceTicker();
    _initPlayerMenu();
    _refreshAvatarDisplays(); // affiche l'avatar sauvegardé dès le démarrage (pas seulement à l'ouverture du menu)

    WBGameState.checkDailyQuests();

    const player = WBGameState.getPlayer();
    const tutorialDone = player.tutorialDone;

    if (!tutorialDone) {
      // Première ouverture : écran titre → tutoriel → Chapitre 1 Stage 1 (avec dialogue) → récompenses connexion
      _showTitleScreen(() => {
        _runTutorial(() => {
          const state0 = WBGameState.get();
          const ch0    = state0.config.storyMode?.chapters?.[0];
          _launchStoryStage(0, 1, ch0, () => {
            _launchDailyRewards();
          });
        });
      });
    } else {
      // Joueur connu : récompenses de connexion directement
      _launchDailyRewards();
    }

    WBGameState.subscribe((event, data) => {
      _onStateChange(event, data);
    });
  }

  function _launchDailyRewards() {
    const claimableCycles = WBGameState.getDailyLoginClaimable?.() || [];
    if (claimableCycles.length > 0) {
      setTimeout(() => {
        claimableCycles.forEach(info => {
          _enqueueAnimation(() => new Promise(resolve => _showDailyLoginClaimPopup(info, resolve)));
        });
      }, 400);
    }
  }

  // ─── ÉCRAN TITRE ─────────────────────────────────────────────────────────────

  function _showTitleScreen(onStart) {
    const state  = WBGameState.get();
    const tplMsg = state.config.tutorial?.welcomeMessage || 'La Réserve Sauvage vous attend...';

    const el = document.getElementById('title-screen');
    const tagEl = document.getElementById('title-tagline');
    const btn = document.getElementById('title-start-btn');
    if (!el) { onStart?.(); return; }

    if (tagEl) tagEl.textContent = tplMsg;
    el.style.display = 'flex';

    btn?.addEventListener('click', () => {
      el.style.transition = 'opacity 400ms';
      el.style.opacity    = '0';
      setTimeout(() => { el.style.display = 'none'; onStart?.(); }, 400);
    }, { once: true });
  }

  // ─── TUTORIEL ────────────────────────────────────────────────────────────────

  function _runTutorial(onComplete) {
    const state  = WBGameState.get();
    const tpl    = state.config.tutorial;
    const steps  = tpl?.steps?.length ? tpl.steps : _getTutorialDefaultSteps();

    const overlay   = document.getElementById('tutorial-overlay');
    const titleEl   = document.getElementById('tuto-title');
    const textEl    = document.getElementById('tuto-text');
    const nameWrap  = document.getElementById('tuto-name-input-wrap');
    const nameInput = document.getElementById('tuto-name-input');
    const rewWrap   = document.getElementById('tuto-reward-wrap');
    const nextBtn   = document.getElementById('tuto-btn-next');
    const progEl    = document.getElementById('tuto-progress');
    const speakerName = document.getElementById('tuto-speaker-name');
    const portraitEl  = document.getElementById('tuto-portrait');

    if (!overlay) { onComplete?.(); return; }
    overlay.style.display = 'flex';
    _combatInProgress = false;

    let stepIdx        = 0;
    let waitingForClic = false;
    let pendingCombatDone = null;

    const sub = (txt) => {
      const n = WBGameState.getPlayer().name || 'Ranger';
      return (txt || '').replace(/\{nom\}/gi, n);
    };

    const renderProgress = () => {
      if (!progEl) return;
      progEl.innerHTML = steps.map((_, i) =>
        `<div class="tuto-dot ${i < stepIdx ? 'done' : i === stepIdx ? 'active' : ''}"></div>`
      ).join('');
    };

    const showStep = (idx) => {
      const s = steps[idx];
      if (!s) return;
      if (titleEl) titleEl.textContent = sub(s.title || '');
      if (textEl)  textEl.textContent  = sub(s.text  || '');
      if (speakerName) speakerName.textContent = tpl?.narratorName || 'Le Ranger';
      const charImg = document.getElementById('tuto-char-img');
      const portrait = tpl?.narratorPortrait || '';
      if (charImg) {
        if (portrait) { charImg.src = portrait; charImg.style.display = 'block'; charImg.classList.remove('entering'); void charImg.offsetWidth; charImg.classList.add('entering'); }
        else charImg.style.display = 'none';
      }
      if (portraitEl) portraitEl.style.display = 'none';
      if (nameWrap) nameWrap.style.display = s.type === 'name' ? 'block' : 'none';
      if (rewWrap)  { rewWrap.style.display = 'none'; rewWrap.innerHTML = ''; }
      if (s.type === 'currency') {
        const cr = s.crystals ?? 500, go = s.gold ?? 500;
        if (rewWrap) { rewWrap.style.display = 'block'; rewWrap.innerHTML =
          (cr > 0 ? `<div class="tuto-reward-card"><span class="tuto-reward-icon">💧</span><div><div class="tuto-reward-label">+${cr} Essence Sauvage</div></div></div>` : '') +
          (go > 0 ? `<div class="tuto-reward-card"><span class="tuto-reward-icon">💵</span><div><div class="tuto-reward-label">+${go} Dollars</div></div></div>` : ''); }
      }
      if (s.type === 'reward') {
        const chars = _pickTutorialChars();
        if (rewWrap && chars.length) {
          rewWrap.style.display = 'block';
          rewWrap.innerHTML = chars.map((def, i) => {
            const rd = WBGameDatabase.RARITIES[def.rarity] || {};
            return `<div class="tuto-reward-card" style="animation-delay:${i*.1}s">
              <span class="tuto-reward-icon">${def.portrait ? `<img src="${def.portrait}" style="width:38px;height:38px;border-radius:50%;object-fit:cover">` : '🎭'}</span>
              <div><div class="tuto-reward-label" style="color:${rd.color||'#e2d9f3'}">${def.name}</div><div class="tuto-reward-sub">${rd.name||def.rarity}</div></div></div>`;
          }).join('');
        }
      }
      if (nextBtn) nextBtn.textContent = idx === steps.length - 1 ? 'Commencer !' : 'Continuer ›';
      renderProgress();
      waitingForClic = true;

      // Mesurer la hauteur de .tuto-box et mettre à jour la variable CSS
      requestAnimationFrame(() => {
        const box = document.querySelector('.tuto-box');
        const overlay = document.getElementById('tutorial-overlay');
        if (box && overlay) {
          const h = box.getBoundingClientRect().height;
          overlay.style.setProperty('--tuto-box-h', h + 'px');
        }
      });
    };

    const goNext = (idx) => {
      const next = idx + 1;
      if (next >= steps.length) { endTutorial(); return; }
      stepIdx = next;
      const box = document.querySelector('.tuto-box');
      if (box) { box.style.opacity = '0'; box.style.transform = 'translateY(10px)'; }
      setTimeout(() => {
        showStep(next);
        if (box) { box.style.transition = 'opacity 250ms,transform 250ms'; box.style.opacity = '1'; box.style.transform = ''; setTimeout(() => { box.style.transition = ''; }, 300); }
      }, 180);
    };

    const endTutorial = () => {
      WBGameState.updatePlayer({ tutorialDone: true });
      overlay.style.transition = 'opacity 350ms';
      overlay.style.opacity    = '0';
      setTimeout(() => { overlay.style.display = 'none'; overlay.style.opacity = ''; _updateHUD(); _showToast('Bienvenue dans la Réserve Sauvage !', 'success'); onComplete?.(); }, 350);
    };

    // UN seul listener sur nextBtn pour tout le tutoriel
    const onNextClick = () => {
      if (!waitingForClic) return;
      waitingForClic = false;

      if (pendingCombatDone) {
        // Fin du combat : aller à l'étape suivante
        const cb = pendingCombatDone;
        pendingCombatDone = null;
        cb();
      } else {
        const s = steps[stepIdx];
        if (s.type === 'name') { const n = (nameInput?.value||'').trim(); if(n) WBGameState.updatePlayer({name:n}); goNext(stepIdx); }
        else if (s.type === 'currency') { WBGameState.modifyResources({crystals:s.crystals??500,gold:s.gold??500}); _updateHUD(); goNext(stepIdx); }
        else if (s.type === 'reward')   { _grantTutorialChars(); goNext(stepIdx); }
        else if (s.type === 'combat')   { launchTutorialCombat(s, stepIdx); }
        else goNext(stepIdx);
      }
    };

    nextBtn?.addEventListener('click', onNextClick);

    const launchTutorialCombat = (s, idx) => {
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.style.display = 'none'; overlay.style.opacity = '';
        showScreen('combat');
        const battleArea = document.getElementById('battle-area');
        const lobby      = document.querySelector('.combat-lobby');
        if (!battleArea || !lobby) { _showToast('Erreur : écran combat introuvable.', 'error'); return; }
        _battle = WBCombatEngine.start(_onBattleEvent, { mode: 'tutorial' });
        if (!_battle) { _showToast('Impossible de lancer le combat du tutoriel.', 'error'); return; }
        _combatInProgress = true;
        document.body.classList.add('battle-active');
        lobby.style.display      = 'none';
        battleArea.style.display = 'block';
        // Pendant le tutoriel aussi : masquer les raccourcis de mode et le menu du bas
        const tutoTabsEl = document.querySelector('.combat-mode-tabs');
        if (tutoTabsEl) tutoTabsEl.style.display = 'none';
        const tutoEventBannerEl = document.querySelector('.event-combat-banner');
        if (tutoEventBannerEl) tutoEventBannerEl.style.display = 'none';
        const tutoNavEl = document.getElementById('main-nav');
        if (tutoNavEl) tutoNavEl.style.display = 'none';
        document.getElementById('plus-menu')?.classList.remove('open');
        WBAudioSystem.playCombat?.();
        _renderBattle();
        const preTxt = s.preCombatText || 'Voici votre premier combat !';
        setTimeout(() => _showTutoCombatDialogue(preTxt, tpl, () => {}), 400);
        // Le callback sera appelé par _onBattleEvent
        _tutorialCombatEndCb = (evt) => {
          _combatInProgress = false;
          const ba = document.getElementById('battle-area');
          if (ba) ba.style.display = 'none';
          overlay.style.display = 'flex';
          overlay.style.opacity = '0'; overlay.style.transition = 'opacity 300ms';
          requestAnimationFrame(() => { overlay.style.opacity = '1'; });
          setTimeout(() => { overlay.style.transition = ''; }, 320);
          if (titleEl)  titleEl.textContent = evt === 'victory' ? '✨ Bravo !' : 'Courage !';
          if (textEl)   textEl.textContent  = sub(s.postCombatText || '');
          if (nameWrap) nameWrap.style.display = 'none';
          if (rewWrap)  rewWrap.style.display  = 'none';
          if (nextBtn)  nextBtn.textContent = 'Continuer ›';
          renderProgress();
          // Quand le joueur cliquera "Continuer", pendingCombatDone appellera goNext
          pendingCombatDone = () => goNext(idx);
          waitingForClic = true;
        };
      }, 300);
    };

    showStep(0);
  }

  /**
   * Affiche un overlay de dialogue par-dessus le combat, bloquant les interactions
   * jusqu'à ce que le joueur clique "Continuer".
   */
  function _showTutoCombatDialogue(text, tpl, onClose) {
    const existing = document.getElementById('tuto-combat-dialogue');
    existing?.remove();

    const dlg = document.createElement('div');
    dlg.id = 'tuto-combat-dialogue';
    dlg.style.cssText = `
      position:absolute; inset:0; z-index:3000;
      background:rgba(5,2,14,.75); backdrop-filter:blur(2px);
      display:flex; align-items:flex-end; justify-content:center;
      pointer-events:all;
    `;

    const narratorName    = tpl?.narratorName    || 'Le Ranger';
    const narratorPortrait= tpl?.narratorPortrait|| '';

    dlg.innerHTML = `
      ${narratorPortrait ? `<img src="${narratorPortrait}" alt="${narratorName}"
        style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);
               height:100%;max-width:60%;object-fit:contain;object-position:bottom;
               pointer-events:none;z-index:0;
               mask-image:linear-gradient(to top,rgba(0,0,0,1) 40%,rgba(0,0,0,.6) 70%,rgba(0,0,0,0) 100%);
               -webkit-mask-image:linear-gradient(to top,rgba(0,0,0,1) 40%,rgba(0,0,0,.6) 70%,rgba(0,0,0,0) 100%)">` : ''}
      <div style="position:relative;z-index:1;width:100%;
                  background:linear-gradient(180deg,rgba(10,5,24,.93),rgba(8,3,18,.98));
                  border-top:1px solid rgba(167,139,250,.25);padding:14px 18px 24px">
        <div style="font-family:var(--font-display);font-size:.75rem;font-weight:800;
                    color:rgba(167,139,250,.8);letter-spacing:.08em;text-transform:uppercase;
                    margin-bottom:6px">${narratorName}</div>
        <div style="font-size:.84rem;color:var(--text-dim);line-height:1.65;margin-bottom:14px">${text}</div>
        <div style="display:flex;justify-content:flex-end">
          <button id="tuto-combat-dlg-close" style="padding:10px 28px;
            background:linear-gradient(135deg,rgba(124,58,237,.5),rgba(167,139,250,.35));
            border:1.5px solid rgba(167,139,250,.5);border-radius:999px;
            color:#e2d9f3;font-family:var(--font-display);font-size:.85rem;font-weight:800;
            letter-spacing:.05em;cursor:pointer">Au combat ! ›</button>
        </div>
      </div>`;

    const shell = document.querySelector('.app-shell') || document.body;
    shell.appendChild(dlg);

    document.getElementById('tuto-combat-dlg-close')?.addEventListener('click', () => {
      dlg.style.opacity = '0';
      dlg.style.transition = 'opacity 250ms';
      setTimeout(() => { dlg.remove(); onClose?.(); }, 250);
    }, { once: true });
  }
  let _tutorialCharDefs = null;
  function _pickTutorialChars() {
    if (_tutorialCharDefs) return _tutorialCharDefs;
    const chars = WBGameState.get().characters.filter(c => c.evolutionStage === 0);
    const commons = chars.filter(c => c.rarity === 'common').sort(() => Math.random() - .5).slice(0, 2);
    const rares   = chars.filter(c => c.rarity === 'rare')  .sort(() => Math.random() - .5).slice(0, 1);
    _tutorialCharDefs = [...commons, ...rares];
    return _tutorialCharDefs;
  }

  function _grantTutorialChars() {
    const defs = _pickTutorialChars();
    defs.forEach(def => WBGameState.addCharacterToCollection?.(def.id, 'tutorial'));
    _tutorialCharDefs = null;

    // Intégrer immédiatement (synchrone) dans l'équipe
    const player  = WBGameState.getPlayer();
    const cfg     = WBGameState.getConfig();
    const maxTeam = cfg.game?.maxTeamSize || 3;
    const collection = player.collection || [];
    const instIds = collection
      .filter(inst => defs.some(d => d.id === inst.charId))
      .slice(-defs.length)
      .map(inst => inst.instanceId)
      .slice(0, maxTeam);
    if (instIds.length > 0) {
      WBGameState.setTeam(instIds);
    }
    setTimeout(() => renderCollection?.(), 100);
  }

  function _getTutorialDefaultSteps() {
    return [
      { type:'lore',     title:'La Réserve Sauvage',     text:"Une faille dimensionnelle a effacé les frontières entre les continents et les époques. Des créatures de toutes origines et de toutes les ères se retrouvent désormais réunies au même endroit : la Réserve Sauvage." },
      { type:'name',     title:'Qui êtes-vous ?',        text:"Avant de commencer, comment souhaitez-vous être appelée ?" },
      { type:'currency', title:'Ressources de démarrage', text:"Pour vous lancer dans l'aventure, la Réserve vous offre quelques ressources.", crystals:500, gold:500 },
      { type:'reward',   title:'Vos premières créatures', text:"Trois créatures ont répondu à votre appel. Elles seront vos compagnes pour débuter cette aventure." },
      { type:'free',     title:"L'aventure commence",    text:"La Réserve Sauvage est vaste. Des dizaines de créatures n'attendent que vous. Bonne chance, Ranger." },
    ];
  }

  /** Branche le bouton flottant de musique (présent une seule fois dans le DOM, jamais recréé) */
  function _bindMusicToggle() {
    const btn    = document.getElementById('music-toggle');
    const popup  = document.getElementById('volume-popup');
    const slider = document.getElementById('volume-slider');
    const valEl  = document.getElementById('volume-value');
    if (!btn) return;
    _updateMusicToggle();

    // Clic sur le bouton : mute/unmute + afficher/masquer la popup volume
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      WBAudioSystem.toggleMute();
      _updateMusicToggle();
      if (popup) popup.classList.toggle('open');
    });

    // Slider de volume
    if (slider) {
      slider.addEventListener('input', () => {
        const vol = parseInt(slider.value) / 100;
        WBAudioSystem.setVolume(vol);
        if (valEl) valEl.textContent = `${slider.value}%`;
        // Si on monte le volume et qu'on était muet, réactiver
        if (vol > 0 && WBAudioSystem.isMuted()) {
          WBAudioSystem.toggleMute();
          _updateMusicToggle();
        }
      });
    }

    // Fermer la popup si on clique ailleurs
    document.addEventListener('click', (e) => {
      if (popup && popup.classList.contains('open') && !popup.contains(e.target) && e.target !== btn) {
        popup.classList.remove('open');
      }
    });
  }

  /** Met à jour l'icône et l'état visuel du bouton musique selon l'état coupé/actif */
  function _updateMusicToggle() {
    const btn = document.getElementById('music-toggle');
    if (!btn) return;
    const muted = WBAudioSystem.isMuted();
    btn.textContent = muted ? '🔇' : '🔊';
    btn.classList.toggle('is-on', !muted);
  }

  function _onStateChange(event, data) {
    if (event === 'configChanged') {
      _refreshAllScreenBackgrounds();
    }

    // ── Évolution : l'affichage est entièrement géré par les appelants (combat,
    // utilisation d'objet) via _showEvolutionShowcase, qui passe par la file
    // d'animations commune. On ne déclenche plus rien ici directement, pour
    // éviter un double affichage et toute superposition.
    if (event === 'evolved') {
      return;
    }

    // ── Montée de niveau du JOUEUR : grosse animation plein écran, mise en file
    // pour ne jamais se superposer à une autre animation (évolution, etc.) ──────
    if (event === 'playerLevelUp') {
      _enqueueAnimation(() => new Promise(resolve => _showPlayerLevelUpShowcase(data, resolve)));
    }

    _updateHUD();
    if (_currentScreen === 'collection') renderCollection();
    if (_currentScreen === 'team') renderTeam();
    if (_currentScreen === 'catalogue') renderCatalogue();
    if (_currentScreen === 'quests' && (event === 'questProgress' || event === 'questClaimed' || event === 'dailyQuestsRefreshed')) {
      renderQuests();
    }
  }

  // ─── FILE D'ANIMATIONS PLEIN ÉCRAN (séquencées) ──────────────────────────────
  // Toute "grosse" animation plein écran (évolution, montée de niveau joueur, et
  // toute autre à venir) passe par cette file commune : elles se jouent une par
  // une, jamais simultanément, même si plusieurs évènements arrivent au même
  // moment (ex: un combat qui fait évoluer 2 créatures ET monter le joueur de
  // niveau au même instant).

  let _animQueue = [];
  let _animBusy  = false;

  // ── Queue spécifique aux animations de combat ──────────────────────────────
  // Distincte de la queue principale pour ne pas bloquer les popups de niveau/évolution.
  // Chaque animation de combat appelle _combatAnimDone() quand elle est terminée.
  let _combatAnimQueue = [];
  let _combatAnimBusy  = false;

  function _queueCombatAnim(fn) {
    _combatAnimQueue.push(fn);
    _drainCombatAnimQueue();
  }
  function _drainCombatAnimQueue() {
    if (_combatAnimBusy || _combatAnimQueue.length === 0) return;
    _combatAnimBusy = true;
    _combatAnimQueue.shift()();
  }
  function _combatAnimDone() {
    _combatAnimBusy = false;
    _drainCombatAnimQueue();
  }
  function _resetCombatAnimQueue() {
    _combatAnimQueue = [];
    _combatAnimBusy = false;
    // Débloquer les boutons si besoin
    document.querySelectorAll('.btn-target').forEach(b => { b.disabled = false; b.style.opacity = ''; });
  }

  /**
   * Ajoute une animation plein écran à la file d'attente commune.
   * @param {Function} taskFn - () => Promise<void> ; doit se résoudre une fois
   *   l'animation entièrement fermée (clic ou délai automatique).
   */
  function _enqueueAnimation(taskFn) {
    _animQueue.push(taskFn);
    _runAnimQueue();
  }

  function _runAnimQueue() {
    if (_animBusy || _animQueue.length === 0) return;
    _animBusy = true;
    const taskFn = _animQueue.shift();
    Promise.resolve(taskFn()).then(() => {
      _animBusy = false;
      _runAnimQueue();
    });
  }

  // ─── FONDS D'ÉCRAN PERSONNALISÉS ─────────────────────────────────────────────
  // Une image hébergée (URL) par écran, définie depuis l'admin (config.backgrounds).
  // Appliquée en fond de l'écran concerné avec un léger voile sombre pour
  // conserver la lisibilité du contenu par-dessus.

  function _screenElForBg(screenId) {
    if (screenId === 'hub') return document.getElementById('screen-hub');
    if (screenId === 'combat-select') return document.getElementById('screen-combat-select');
    return document.getElementById(`screen-${screenId}`);
  }

  function _applyScreenBackground(screenId) {
    const el = _screenElForBg(screenId);
    if (!el) return;
    const bgCfg = WBGameState.get().config.backgrounds || {};
    const url = bgCfg[screenId];
    if (url) {
      el.style.backgroundImage = `linear-gradient(180deg, rgba(9,4,15,.6), rgba(9,4,15,.8)), url("${url}")`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.style.backgroundRepeat = 'no-repeat';
    } else {
      el.style.backgroundImage = '';
      el.style.backgroundSize = '';
      el.style.backgroundPosition = '';
      el.style.backgroundRepeat = '';
    }
  }

  /** Réapplique le fond d'écran courant (et celui de la sélection combat) — utilisé après une modification en admin */
  function _refreshAllScreenBackgrounds() {
    const bgCfg = WBGameState.get().config.backgrounds || {};
    Object.keys(bgCfg).forEach(screenId => _applyScreenBackground(screenId));
  }

  // ─── NAVIGATION ──────────────────────────────────────────────────────────────

  /** Vrai si un combat est en cours (hors écran de résultat victoire/défaite) */
  function _isBattleActive() {
    return !!_battle && _battle.phase !== 'end';
  }

  function _renderNav() {
    const nav = document.getElementById('main-nav');
    if (!nav) return;
    nav.className = 'app-nav-new';
    nav.innerHTML = `
      <div class="nav-new-btn active" data-screen="hub">
        <span class="nav-ico">🏕️</span><span class="nav-lbl">BASE</span>
      </div>
      <div class="nav-new-btn" data-screen="collection">
        <span class="nav-ico">✨</span><span class="nav-lbl">COLLECTION</span>
      </div>
      <div class="nav-new-btn" data-screen="team-hub">
        <span class="nav-ico">🎒</span><span class="nav-lbl">PRÉPARATION</span>
      </div>
      <div class="nav-combat-btn" id="nav-combat-btn">
        <span class="nav-badge" id="nav-combat-badge" style="display:none">!</span>
        <span class="nav-ico">⚔️</span>
        <span class="nav-lbl">COMBAT</span>
      </div>
      <div class="nav-new-btn" id="nav-gacha-btn" data-screen="gacha">
        <span class="nav-ico">📡</span><span class="nav-lbl">SIGNAL</span>
      </div>
      <div class="nav-new-btn" id="nav-shop-btn" data-screen="shop">
        <span class="nav-ico">🛍️</span><span class="nav-lbl">SHOP</span>
      </div>
      <div class="nav-new-btn" id="nav-plus-btn">
        <span class="nav-ico">≡</span><span class="nav-lbl">PLUS</span>
      </div>
    `;

    // Bouton Signal (gacha) — verrouillé si feature pas débloquée
    const gachaBtn = document.getElementById('nav-gacha-btn');
    const gachaUnlocked = WBGameState.isFeatureUnlocked?.('gacha') ?? true;
    if (!gachaUnlocked && gachaBtn) {
      gachaBtn.style.opacity = '.45';
      gachaBtn.title = 'Disponible au Chapitre 2, Stage 5';
    }
    gachaBtn?.addEventListener('click', () => {
      if (!WBGameState.isFeatureUnlocked?.('gacha')) {
        _showToast('🔒 Signal disponible au Chapitre 2, Stage 5', 'info');
        return;
      }
      showScreen('gacha');
      _setNavActive('gacha');
    });

    // Afficher/masquer le badge verrou sur la zone gacha du hub
    const lockBadge = document.getElementById('hub-gacha-lock');
    if (lockBadge) lockBadge.style.display = gachaUnlocked ? 'none' : 'flex';

    // Bouton Shop — verrouillé en même temps que le Signal
    const shopBtn = document.getElementById('nav-shop-btn');
    if (!gachaUnlocked && shopBtn) {
      shopBtn.style.opacity = '.45';
      shopBtn.title = 'Disponible au Chapitre 2, Stage 5';
    }
    shopBtn?.addEventListener('click', () => {
      if (!WBGameState.isFeatureUnlocked?.('gacha')) {
        _showToast('🔒 Shop disponible au Chapitre 2, Stage 5', 'info');
        return;
      }
      showScreen('shop');
      _setNavActive('shop');
    });

    // Hub zones
    document.querySelectorAll('.hub-zone').forEach(z => {
      z.addEventListener('click', () => {
        const t = z.dataset.target;
        if (t === 'gacha' && !WBGameState.isFeatureUnlocked?.('gacha')) {
          _showToast('🔒 Le Gacha se déverrouille au Chapitre 2, Stage 5', 'info');
          return;
        }
        showScreen(t);
      });
    });

    // Boutons nav
    nav.querySelectorAll('.nav-new-btn[data-screen]').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = btn.dataset.screen;
        if (s === 'hub')       { showScreen('hub');        _setNavActive('hub');        return; }
        if (s === 'collection'){ showScreen('collection'); _setNavActive('collection'); return; }
        if (s === 'team-hub')  { showScreen('team-hub');  _setNavActive('team-hub');  return; }
      });
    });

    // Bouton combat
    document.getElementById('nav-combat-btn')?.addEventListener('click', _showCombatSelect);

    // Bouton Plus
    document.getElementById('nav-plus-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = document.getElementById('plus-menu');
      if (m) m.classList.toggle('open');
    });
    document.querySelectorAll('#plus-menu .plus-item').forEach(item => {
      item.addEventListener('click', () => {
        const t = item.dataset.target;
        document.getElementById('plus-menu')?.classList.remove('open');
        showScreen(t); _setNavActive(t);
      });
    });
    document.addEventListener('click', () => {
      document.getElementById('plus-menu')?.classList.remove('open');
    });

    // Bouton retour écran combat-select
    document.getElementById('cs-back-btn')?.addEventListener('click', () => {
      showScreen('hub');
    });
  }

  function _setNavActive(screenId) {
    document.querySelectorAll('.nav-new-btn').forEach(b => b.classList.remove('active'));
    const map = { hub:'hub', team:'team-hub', 'team-hub':'team-hub', shop:'shop' };
    const target = map[screenId];
    if (target) {
      document.querySelector(`.nav-new-btn[data-screen="${target}"]`)?.classList.add('active');
    }
  }

  function _showCombatSelect() {
    if (_isBattleActive()) return; // combat en cours : on ne peut pas revenir à la sélection
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-hub')?.classList.remove('active');
    const el = document.getElementById('screen-combat-select');
    if (!el) return;
    el.classList.add('active');
    _applyScreenBackground('combat-select');

    const state = WBGameState.get();
    const ev    = WBGameState.getActiveEvent();
    const costs = state.config?.energy?.costs || {};
    const costKeyByModeId = { storyMode:'storyMode', story:'story', byLine:'line', fullRandom:'fullRandom', arena:'arena', trophy:'trophy' };

    const modes = [
      // Histoire — featured, toujours disponible
      { id:'storyMode',    icon:'📖', name:'Mode Histoire',    desc:'Suivez la trame narrative de la Réserve Sauvage',          featured:true,  unlocked:true,  lockedDesc:'' },
      // Ordre de déblocage
      { id:'fullRandom',   icon:'🎲', name:'Battue',           desc:'Équipe aléatoire, ennemies aléatoires',               featured:false, unlocked:WBGameState.isFeatureUnlocked?.('caprice')   ?? true, lockedDesc:'🔒 Disponible à la fin du Chapitre 2' },
      { id:'story',        icon:'🌍', name:'Expédition',       desc:'Progressez monde par monde',                          featured:false, unlocked:WBGameState.isFeatureUnlocked?.('tournee')   ?? true, lockedDesc:'🔒 Disponible à la fin du Chapitre 3' },
      { id:'byLine',       icon:'🐾', name:'Élevage',          desc:'Affrontez toute une lignée',                          featured:false, unlocked:WBGameState.isFeatureUnlocked?.('saga')      ?? true, lockedDesc:'🔒 Disponible à la fin du Chapitre 4' },
      { id:'arena',        icon:'🗺️', name:'Territoire',       desc:'Affrontez 6 créatures du même type',                  featured:false, unlocked:WBGameState.isFeatureUnlocked?.('grandgala') ?? true, lockedDesc:'🔒 Disponible à la fin du Chapitre 5' },
      { id:'trophy',       icon:'🎯', name:'Traque',           desc:'Battez vos propres records',                          featured:false, unlocked:WBGameState.isFeatureUnlocked?.('trophy')    ?? true, lockedDesc:'🔒 Disponible à la fin du Chapitre 6' },
      { id:'challenge',    icon:'🌀', name:'???',              desc:'Un nouveau défi vous attend...',                      featured:false, unlocked:false, lockedDesc:'🔒 Bientôt disponible' },
      // Événement — blingbling, pleine largeur
      { id:'event',        icon:'⭐', name:'Événement',        desc:'Des histoires exclusives aux créatures de l\'Event',   featured:false, unlocked:false, lockedDesc:'🔒 Bientôt disponible', eventFeatured:true },
      // Sous-modes Event
      { id:'capriceEvent', icon:'🎲', name:'Battue Event',     desc:'Équipe aléatoire — ennemies de l\'Event',             featured:false, unlocked:false, lockedDesc:'🔒 Bientôt disponible', eventSub:true },
      { id:'combatTag',    icon:'👗', name:'Défi Event',     desc:'Créatures et ennemies du Tag Event uniquement',        featured:false, unlocked:false, lockedDesc:'🔒 Bientôt disponible', eventSub:true },
    ];

    const grid = document.getElementById('cs-grid');
    if (grid) grid.innerHTML = modes.map(m => {
      let cls = 'cs-card';
      if (m.featured)      cls += ' featured';
      if (m.eventFeatured) cls += ' event-featured';
      if (m.eventSub)      cls += ' event-sub';
      if (!m.unlocked)     cls += ' locked';
      if (m.unlocked)      cls += ' unlocked';
      return `<div class="${cls}" data-mode="${m.id}"
        style="${!m.unlocked ? 'opacity:.45;cursor:not-allowed' : ''}">
        <div class="cs-card-icon">${m.icon}${!m.unlocked ? ' 🔒' : ''}</div>
        <div class="cs-card-name">${m.name}</div>
        <div class="cs-card-desc">${m.unlocked ? m.desc : m.lockedDesc}</div>
        ${m.unlocked && costKeyByModeId[m.id] != null ? `<div class="energy-cost-badge">⚡${costs[costKeyByModeId[m.id]] ?? 10}</div>` : ''}
      </div>`;
    }).join('');

    grid?.querySelectorAll('.cs-card:not(.locked)').forEach(card => {
      card.addEventListener('click', () => {
        const mode = card.dataset.mode;
        el.classList.remove('active');
        if (mode === 'storyMode') { showScreen('story-chapters'); return; }
        if (mode === 'trophy') { showScreen('trophy-hub'); return; }
        if (mode === 'story' || mode === 'byLine' || mode === 'arena') {
          _combatMode = mode === 'byLine' ? 'line' : mode;
          _selectedLine = null;
          _selectedArenaType = null;
          showScreen('combat');
          return;
        }
        showScreen('combat');
        setTimeout(() => _launchCombat({ mode: mode === 'fullRandom' ? 'fullRandom' : mode }), 100);
      });
    });
  }

  function _bindNav() {
    document.getElementById('main-nav')?.addEventListener('click', e => {
      const btn = e.target.closest('.nav-btn');
      if (btn) showScreen(btn.dataset.screen);
    });
  }

  function showScreen(screenId) {
    // Combat en cours : impossible de changer d'écran tant qu'il n'est pas terminé
    if (_isBattleActive() && screenId !== 'combat') {
      _showToast('Impossible de quitter le combat en cours !', 'error');
      return;
    }

    _currentScreen = screenId;

    // Restaurer la navigation (peut avoir été masquée par un combat précédent)
    const navEl = document.getElementById('main-nav');
    if (navEl) navEl.style.display = '';
    document.getElementById('plus-menu')?.classList.remove('open');

    // Masquer TOUS les écrans
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-hub')?.classList.remove('active');
    document.getElementById('screen-combat-select')?.classList.remove('active');

    if (screenId === 'hub') {
      document.getElementById('screen-hub')?.classList.add('active');
      _setNavActive('hub');
      _updateHUD();
      _applyScreenBackground('hub');
      return;
    }

    if (screenId === 'combat-select') {
      _showCombatSelect();
      return;
    }

    const el = document.getElementById(`screen-${screenId}`);
    if (el) el.classList.add('active');
    _applyScreenBackground(screenId);

    WBAudioSystem.playGlobal();

    const renderers = {
      collection:       renderCollection,
      team:             renderTeam,
      'team-hub':       renderTeamHub,
      combat:           renderCombatLobby,
      gacha:            renderGacha,
      equip:            renderEquip,
      inventory:        renderInventory,
      shop:             renderShop,
      quests:           renderQuests,
      catalogue:        renderCatalogue,
      'story-chapters': renderStoryChapters,
      'story-chapter':  () => renderStoryChapter(_storyCurrentChapter),
      leaderboard:      renderLeaderboard,
      'trophy-hub':     renderTrophyHub,
      'trophy-rewards': renderTrophyRewards,
    };
    renderers[screenId]?.();
    _setNavActive(screenId);
    _updateHUD();
  }

  // ─── HUD (RESSOURCES) ─────────────────────────────────────────────────────────

  function _updateHUD() {
    WBGameState.regenEnergy();
    const player = WBGameState.getPlayer();
    const cfg    = WBGameState.getConfig();
    const hud    = document.getElementById('hud');
    const infoBar = document.getElementById('player-info-bar');
    if (!hud) return;
    const energyPct = cfg.energy.enabled ? Math.round((player.energy.current / player.energy.max) * 100) : 100;

    if (infoBar) {
      const xpCurrent = Math.floor(player.experience || 0);
      const xpNeeded  = WBGameDatabase.xpForPlayerLevel(player.level + 1, cfg.playerLevel);
      const xpPct     = xpNeeded > 0 ? Math.min(100, Math.round((xpCurrent / xpNeeded) * 100)) : 0;
      infoBar.innerHTML = `
        <span class="player-info-name" title="${player.name}">${player.name}</span>
        <span class="player-info-level">Niv. ${player.level}</span>
        <div class="player-xp-bar-wrap" title="${xpCurrent} / ${xpNeeded} XP">
          <div class="player-xp-bar-fill" style="width:${xpPct}%"></div>
        </div>
      `;
    }

    hud.innerHTML = `
      <div class="hud-item">
        <span class="hud-icon">💧</span>
        <span class="hud-val">${player.currency.crystals.toLocaleString()}</span>
      </div>
      <div class="hud-item">
        <span class="hud-icon">💵</span>
        <span class="hud-val">${(player.currency.gold || 0).toLocaleString()}</span>
      </div>
      <div class="hud-item" title="Énergie">
        <span class="hud-icon">⚡</span>
        <span class="hud-val">${cfg.energy.enabled ? `${player.energy.current}/${player.energy.max}` : '∞'}</span>
        ${cfg.energy.enabled ? `<div class="hud-bar"><div class="hud-bar-fill" style="width:${energyPct}%"></div></div>` : ''}
      </div>
    `;
    _updateNavDots();
  }

  function _updateNavDots() {
    const player = WBGameState.getPlayer();
    const state  = WBGameState.get();
    const dq = player.dailyQuestState || {};
    const hasClaimable = (dq.activeQuestIds || []).some(qid => {
      const def = (state.dailyQuests || []).find(q => q.id === qid);
      return def && (dq.progress?.[qid] || 0) >= def.target && !dq.claimed?.[qid];
    });
    const ev = player.event?.current;
    const hasEventQuest = ev?.active && (ev.questConfig?.quests || []).some((q, i) =>
      (ev.questProgress?.[i] || 0) >= q.target && !ev.questClaimed?.[i]
    );
    const badge = document.getElementById('nav-combat-badge');
    if (badge) badge.style.display = ev?.active ? 'block' : 'none';
  }

  function _startResourceTicker() {
    setInterval(_updateHUD, 15000);
  }

  // ─── MODE HISTOIRE ───────────────────────────────────────────────────────────

  const NARRATIVE_STAGES = [1, 5, 8, 10];

  const STAGE_NARRATIVE_LABELS = {
    1:  { icon: '📖', label: 'Découverte'    },
    5:  { icon: '📖', label: 'Questionnement' },
    8:  { icon: '📖', label: 'Compréhension'  },
    10: { icon: '📖', label: 'Résolution'     },
  };

  let _storyCurrentChapter = 0; // index du chapitre affiché

  function renderStoryChapters() {
    const el = document.getElementById('screen-story-chapters');
    if (!el) return;
    const state    = WBGameState.get();
    const chapters = state.config.storyMode?.chapters || [];

    el.innerHTML = `
      <div class="story-header-banner">
        <h2>📖 Mode Histoire</h2>
        <p>Suivez la trame narrative de la Réserve Sauvage</p>
      </div>
      <div class="story-chapters-grid">
        ${chapters.length ? chapters.map((ch, ci) => {
          const prog         = WBGameState.getStoryChapterProgress(ci);
          const completed    = prog.completedStages.length;
          const pct          = Math.round(completed / 10 * 100);
          const isCompleted  = completed >= 10;
          const isLocked     = ci > 0 && (WBGameState.getStoryChapterProgress(ci-1).completedStages.length < 10);
          const statusIcon   = isCompleted ? '✅' : isLocked ? '🔒' : '✨';
          return `
            <div class="story-chapter-card${isLocked?' locked':''}${isCompleted?' completed':''}"
                 data-chapter="${ci}" ${isLocked?'':'style="cursor:pointer"'}>
              <div class="story-chapter-card-header">
                <span class="story-chapter-num">Chapitre ${ci + 1}</span>
                <span class="story-chapter-status">${statusIcon}</span>
              </div>
              <div class="story-chapter-title">${ch.title || `Chapitre ${ci+1}`}</div>
              ${ch.difficultyNote ? `<div class="story-chapter-diff">${ch.difficultyNote}</div>` : ''}
              <div class="story-chapter-progress">
                <div class="story-chapter-bar">
                  <div class="story-chapter-bar-fill" style="width:${pct}%"></div>
                </div>
                <span class="story-chapter-progress-label">${completed}/10</span>
              </div>
            </div>`;
        }).join('') : '<p style="color:#888;padding:20px;text-align:center">Aucun chapitre configuré.<br><small>Ajoutez des chapitres dans l\'admin → 📖 Mode Histoire</small></p>'}
      </div>`;

    el.querySelectorAll('.story-chapter-card:not(.locked)').forEach(card => {
      card.addEventListener('click', () => {
        _storyCurrentChapter = parseInt(card.dataset.chapter);
        renderStoryChapter(_storyCurrentChapter);
        showScreen('story-chapter');
      });
    });
  }

  function renderStoryChapter(ci) {
    const el = document.getElementById('screen-story-chapter');
    if (!el) return;
    const state  = WBGameState.get();
    const ch     = state.config.storyMode?.chapters?.[ci];
    const prog   = WBGameState.getStoryChapterProgress(ci);
    const done   = prog.completedStages || [];
    const next   = (done.length === 0) ? 1 : Math.max(...done) + 1;

    const cells = Array.from({ length: 10 }, (_, i) => {
      const stage      = i + 1;
      const isNarr     = NARRATIVE_STAGES.includes(stage);
      const isDone     = done.includes(stage);
      const isActive   = stage === next || (isDone && stage <= next);
      const isLocked   = !isDone && stage > next;
      const nl         = STAGE_NARRATIVE_LABELS[stage];

      let cls = 'story-stage-cell';
      if (isDone)     cls += ' completed';
      if (isNarr)     cls += ' narrative';
      if (isActive && !isDone) cls += ' active';
      if (isLocked)   cls += ' locked';

      return `<div class="${cls}" data-stage="${stage}">
        ${isDone ? '<span class="story-stage-check">✓</span>' : ''}
        ${isNarr && !isDone ? `<span class="story-stage-icon">${nl.icon}</span>` : ''}
        <span class="story-stage-num">${stage}</span>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="story-chapter-detail-header">
        <button class="story-back-btn" id="story-back-chapters">‹</button>
        <span class="story-chapter-detail-title">${ch?.title || `Chapitre ${ci+1}`}</span>
      </div>
      ${ch?.synopsis ? `<p class="story-chapter-synopsis">${ch.synopsis}</p>` : ''}
      <div class="story-stages-grid">${cells}</div>`;

    document.getElementById('story-back-chapters')?.addEventListener('click', () => {
      renderStoryChapters();
      showScreen('story-chapters');
    });

    el.querySelectorAll('.story-stage-cell:not(.locked)').forEach(cell => {
      cell.addEventListener('click', () => {
        const stage = parseInt(cell.dataset.stage);
        _launchStoryStage(ci, stage, ch);
      });
    });
  }

  function _launchStoryStage(ci, stage, ch, onDone) {
    const isNarr = NARRATIVE_STAGES.includes(stage);
    const dlg    = ch?.dialogues?.[stage];

    if (isNarr && dlg?.text) {
      // Afficher le dialogue narratif avant le combat
      _showStoryDialogue(dlg, () => _startStoryBattle(ci, stage, onDone));
    } else {
      _startStoryBattle(ci, stage, onDone);
    }
  }

  function _showStoryDialogue(dlg, onDone) {
    const overlay  = document.getElementById('story-dialogue-overlay');
    const speaker  = document.getElementById('story-dlg-speaker');
    const textEl   = document.getElementById('story-dlg-text');
    const btn      = document.getElementById('story-dlg-btn');
    const charImg  = document.getElementById('story-dlg-char-img');
    if (!overlay) { onDone?.(); return; }

    if (speaker) speaker.textContent = dlg.speaker || 'Le Ranger';
    if (textEl)  textEl.textContent  = dlg.text    || '';

    // Portrait si défini
    if (charImg) {
      if (dlg.portrait) {
        charImg.src           = dlg.portrait;
        charImg.style.display = 'block';
      } else {
        charImg.style.display = 'none';
      }
    }

    overlay.classList.add('open');

    // Texte secondaire : si text2, afficher en deux temps
    let phase = 1;
    const advance = () => {
      if (phase === 1 && dlg.text2) {
        if (textEl) textEl.textContent = dlg.text2;
        phase = 2;
      } else {
        overlay.classList.remove('open');
        btn?.removeEventListener('click', advance);
        onDone?.();
      }
    };

    btn?.removeEventListener('click', advance); // éviter accumulation
    btn?.addEventListener('click', advance);
  }

  function _startStoryBattle(ci, stage, onDone) {
    // Difficulté : +5% stats ennemies par stage
    const difficulty = 1 + (stage - 1) * 0.05;
    showScreen('combat');
    setTimeout(() => {
      _launchCombat({ mode: 'storyMode', storyChapter: ci, storyStage: stage, difficulty });
      // Après victoire : marquer le stage complété
      _storyPendingStage = { ci, stage, onDone };
    }, 100);
  }

  let _storyPendingStage = null;

  let _playerMenuOpen = false;
  let _tutorialCombatEndCb = null;
  let _combatInProgress    = false;
  let _storyPostDialogue   = null;

  // ─── ÉCRAN HUB ÉQUIPE ────────────────────────────────────────────────────────

  function renderTeamHub() {
    const el = document.getElementById('screen-team-hub');
    if (!el) return;
    const items = [
      { icon:'🎒', name:'Préparation',        desc:"Compose ton équipe de créatures pour partir au combat",                                    target:'team',  inactive:false },
      { icon:'⚔️', name:'Équipements',        desc:'Équipe tes créatures avec les meilleurs équipements',                          target:'equip', inactive:false },
      { icon:'🧵', name:'Atelier de Couture', desc:'Fusionne des équipements pour en créer de plus puissants',                              target:null,    inactive:true  },
      { icon:'✒️', name:'Signature',          desc:'Fusionne des équipements Mythiques identiques pour les élever au rang absolu',          target:null,    inactive:true  },
    ];
    el.innerHTML = `<div class="team-hub-screen">
      <div class="team-hub-title">🎒 Préparation</div>
      <div class="team-hub-subtitle">Constitue ta troupe et habille-la pour la gloire</div>
      ${items.map(item => `
        <div class="team-hub-card${item.inactive?' inactive':''}" ${item.target?`data-target="${item.target}"`:''}>
          <div class="team-hub-card-icon">${item.icon}</div>
          <div class="team-hub-card-body">
            <div class="team-hub-card-name">${item.name}</div>
            <div class="team-hub-card-desc">${item.desc}</div>
          </div>
          ${item.inactive ? '<span class="team-hub-card-soon">Bientôt</span>' : '<span class="team-hub-card-arrow">›</span>'}
        </div>`).join('')}
    </div>`;
    el.querySelectorAll('.team-hub-card:not(.inactive)').forEach(card => {
      card.addEventListener('click', () => { const t = card.dataset.target; if (t) showScreen(t); });
    });
  }

  function _initPlayerMenu() {
    document.getElementById('player-avatar-btn')?.addEventListener('click', _openPlayerMenu);
    document.getElementById('pm-close-btn')?.addEventListener('click', _closePlayerMenu);
    document.getElementById('player-menu-backdrop')?.addEventListener('click', _closePlayerMenu);
    document.getElementById('pm-edit-name-btn')?.addEventListener('click', _editPlayerName);
    // Clic avatar large → aller sur l'onglet avatar
    document.getElementById('pm-avatar-wrap')?.addEventListener('click', () => _pmSwitchTab('avatar'));
    // Onglets
    document.querySelectorAll('.pm-tab').forEach(btn => {
      btn.addEventListener('click', () => _pmSwitchTab(btn.dataset.tab));
    });
  }

  function _pmSwitchTab(tabId) {
    document.querySelectorAll('.pm-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.pm-tab-content').forEach(c => c.classList.toggle('active', c.id === `pm-tab-${tabId}`));
    if (tabId === 'avatar') _renderAvatarGrid();
  }

  function _openPlayerMenu() {
    _playerMenuOpen = true;
    document.getElementById('player-menu')?.classList.add('open');
    document.getElementById('player-menu-backdrop')?.classList.add('open');
    _renderPlayerMenu();
  }

  function _closePlayerMenu() {
    _playerMenuOpen = false;
    document.getElementById('player-menu')?.classList.remove('open');
    document.getElementById('player-menu-backdrop')?.classList.remove('open');
  }

  function _renderPlayerMenu() {
    const state  = WBGameState.get();
    const player = state.player;
    const stats  = player.stats || {};
    const cfg    = state.config;

    // Nom & niveau
    document.getElementById('pm-player-name').textContent = player.name || 'Joueuse';
    document.getElementById('pm-player-level').textContent = `Niveau ${player.level || 1}`;

    // Avatar
    _refreshAvatarDisplays();

    // ── Stats ────────────────────────────────────────────────────────────────
    const winRate = stats.totalBattles > 0
      ? Math.round((stats.totalVictories / stats.totalBattles) * 100) : 0;
    const ownedCount   = (player.collection || []).length;
    const galleryEntries = Object.keys(player.catalogue || {}).length;
    const catalogueTotal = (state.characters||[]).length; // toutes formes confondues, comme l'Encyclopédie
    const tourneeWorld    = player.story?.world    || 1;
    const tourneeSubLevel = player.story?.subLevel || 0;
    const tourneePerWorld = cfg.combat?.story?.subLevelsPerWorld || 25;

    // Bonus joueur total
    const bonusInfo = WBGameState.getPlayerStatBonus?.() || { bonus: 0, detail: [] };
    // Détail par clé de compteur, pour retrouver rapidement la progression de chacun
    const bonusByKey = {};
    (bonusInfo.detail || []).forEach(d => { bonusByKey[d.key] = d; });

    // Construit la barre de progression HTML vers le prochain palier de bonus de stat
    // (uniquement pour les compteurs qui offrent +1 stat bonus, cf. config playerBonus)
    const _progressBarHtml = (bonusKey) => {
      const d = bonusByKey[bonusKey];
      if (!d || !d.every) return '';
      const progress   = d.count % d.every;
      const pct        = Math.round((progress / d.every) * 100);
      const remaining  = d.every - progress;
      return `
        <div class="pm-stat-progress">
          <div class="pm-stat-progress-bar"><div class="pm-stat-progress-fill" style="width:${pct}%"></div></div>
          <div class="pm-stat-progress-label">${remaining} avant +1 aux stats</div>
        </div>`;
    };

    const statCards = [
      // Carte bonus en pleine largeur en tête
      { label: '✨ Bonus stats (toutes)', value: `+${bonusInfo.bonus}`, highlight: true, full: true },
      // Score / progression (le plus parlant en un coup d'œil)
      { label: '⭐ Attrait total',       value: (WBGameState.getPlayerAuraScoreTotal?.()||0).toLocaleString('fr-FR'), highlight: true, progress: _progressBarHtml('scoreTotal') },
      { label: '👑 Attrait d\'équipe',  value: (WBGameState.getPlayerAuraScoreTeam?.()||0).toLocaleString('fr-FR'),  highlight: true, progress: _progressBarHtml('scoreTeam') },
      { label: '🌍 Expédition',         value: `Monde ${tourneeWorld} — ${tourneeSubLevel}/${tourneePerWorld}`, highlight: true, progress: _progressBarHtml('tourneeProgress') },
      { label: '🎯 Meilleur score Traque', value: (player.trophy?.bestScore||0).toLocaleString('fr-FR'), highlight: true, progress: _progressBarHtml('trophyBestScore') },
      // Performance en combat
      { label: '⚔️ Combats',           value: (stats.totalBattles||0).toLocaleString('fr-FR'),    highlight: false, progress: _progressBarHtml('battles') },
      { label: '🏆 Victoires',          value: (stats.totalVictories||0).toLocaleString('fr-FR'),  highlight: true,  progress: _progressBarHtml('victories') },
      { label: '💥 Ennemis vaincus',   value: (stats.totalKills||0).toLocaleString('fr-FR'),       highlight: false, progress: _progressBarHtml('kills') },
      // Collection
      { label: '🐾 Apprivoisements',    value: (stats.totalCaptures||0).toLocaleString('fr-FR'),    highlight: false, progress: _progressBarHtml('captures') },
      { label: '💧 Invocations',        value: (stats.totalPulls||0).toLocaleString('fr-FR'),       highlight: false, progress: _progressBarHtml('pulls') },
      { label: '✨ Évolutions',         value: (stats.totalEvolutions||0).toLocaleString('fr-FR'), highlight: false, progress: _progressBarHtml('evolutions') },
      { label: '⭐ Éveils',             value: (stats.totalAwakenings||0).toLocaleString('fr-FR'), highlight: false, progress: _progressBarHtml('awakenings') },
      { label: '📚 Encyclopédie',        value: `${galleryEntries} / ${catalogueTotal}`,             highlight: galleryEntries===catalogueTotal, progress: _progressBarHtml('galleryEntries') },
    ];
    const statsEl = document.getElementById('pm-stats-grid');
    if (statsEl) statsEl.innerHTML = statCards.map(s => `
      <div class="pm-stat-card${s.highlight?' highlight':''}${s.full?' pm-stat-full':''}">
        <div class="pm-stat-label">${s.label}</div>
        <div class="pm-stat-value">${s.value}</div>
        ${s.progress || ''}
      </div>`).join('');

    // ── Son ──────────────────────────────────────────────────────────────────
    const audioCfg = cfg.audio || {};
    const isMuted  = WBAudioSystem.isMuted?.() ?? false;
    const soundEl  = document.getElementById('pm-sound-controls');
    if (soundEl) soundEl.innerHTML = `
      <div class="pm-sound-row">
        <span class="pm-sound-label">🎵 Musique de fond</span>
        <button class="pm-toggle-btn${!isMuted?' active':''}" id="pm-btn-music" onclick="WBGameUI._pmToggleMusic()">
          ${!isMuted ? '🔊 Activée' : '🔇 Désactivée'}
        </button>
      </div>
      <div class="pm-sound-row">
        <span class="pm-sound-label">Volume musique</span>
        <input type="range" class="pm-sound-slider" id="pm-vol-music" min="0" max="100"
          value="${Math.round((audioCfg.musicVolume ?? 0.7)*100)}"
          oninput="WBGameUI._pmSetMusicVol(this.value)">
        <span id="pm-vol-music-lbl" style="font-size:.72rem;color:#888;min-width:32px">${Math.round((audioCfg.musicVolume??0.7)*100)}%</span>
      </div>
      <div class="pm-sound-row">
        <span class="pm-sound-label">🔔 Effets sonores</span>
        <button class="pm-toggle-btn${audioCfg.sfxEnabled!==false?' active':''}" id="pm-btn-sfx" onclick="WBGameUI._pmToggleSfx()">
          ${audioCfg.sfxEnabled!==false ? '🔊 Activés' : '🔇 Désactivés'}
        </button>
      </div>
      <div class="pm-sound-row">
        <span class="pm-sound-label">Volume effets</span>
        <input type="range" class="pm-sound-slider" id="pm-vol-sfx" min="0" max="100"
          value="${Math.round((audioCfg.sfxVolume ?? 0.8)*100)}"
          oninput="WBGameUI._pmSetSfxVol(this.value)">
        <span id="pm-vol-sfx-lbl" style="font-size:.72rem;color:#888;min-width:32px">${Math.round((audioCfg.sfxVolume??0.8)*100)}%</span>
      </div>
    `;

    // ── Préférences ───────────────────────────────────────────────────────────
    const prefsEl = document.getElementById('pm-prefs');
    if (prefsEl) prefsEl.innerHTML = `
      <div class="pm-pref-row">
        <div>
          <div class="pm-pref-label">🌙 Mode économie d'énergie</div>
          <div class="pm-pref-sub">Réduit les animations pour économiser la batterie</div>
        </div>
        <label class="pm-switch">
          <input type="checkbox" id="pm-pref-perf" ${player.prefs?.reducedMotion?'checked':''}
            onchange="WBGameUI._pmTogglePref('reducedMotion',this.checked)">
          <span class="pm-switch-slider"></span>
        </label>
      </div>
      <div class="pm-pref-row">
        <div>
          <div class="pm-pref-label">⚡ Afficher les coûts d'énergie</div>
          <div class="pm-pref-sub">Montre le coût en énergie sur chaque bouton de combat</div>
        </div>
        <label class="pm-switch">
          <input type="checkbox" id="pm-pref-energy" ${player.prefs?.showEnergyCost!==false?'checked':''}
            onchange="WBGameUI._pmTogglePref('showEnergyCost',this.checked)">
          <span class="pm-switch-slider"></span>
        </label>
      </div>
      <div class="pm-pref-row">
        <div>
          <div class="pm-pref-label">🔔 Notifications de quêtes</div>
          <div class="pm-pref-sub">Pastille rouge quand une quête est prête à réclamer</div>
        </div>
        <label class="pm-switch">
          <input type="checkbox" id="pm-pref-notif" ${player.prefs?.questNotifications!==false?'checked':''}
            onchange="WBGameUI._pmTogglePref('questNotifications',this.checked)">
          <span class="pm-switch-slider"></span>
        </label>
      </div>
    `;

    // ── Avatars disponibles ───────────────────────────────────────────────────
    _renderAvatarGrid();
  }

  function _refreshAvatarDisplays() {
    const player = WBGameState.getPlayer();
    const def    = player.avatarCharId ? WBGameState.getCharDef(player.avatarCharId) : null;

    const applyCombatCrop = (ringId, innerId) => {
      const ring = document.getElementById(ringId);
      if (!ring) return;
      if (def?.portrait) {
        const crop = def.combatCrop || WBGameDatabase.defaultCombatCrop();
        const cx = crop.cx ?? 50, cy = crop.cy ?? 38, r = Math.max(1, crop.r ?? 38);
        const w  = +(5000 / r).toFixed(2);
        const l  = +(50 - cx * 50 / r).toFixed(2);
        const t  = +(50 - cy * 50 / r).toFixed(2);
        ring.innerHTML = `<img src="${def.portrait}" alt="${def.name}"
          style="position:absolute;width:${w}%;height:${w}%;
                 left:${l}%;top:${t}%;max-width:none;max-height:none;
                 object-fit:cover;object-position:50% 0%;display:block">`;
      } else {
        ring.innerHTML = `<span class="${ringId==='player-avatar-ring'?'player-avatar-placeholder':'pm-avatar-inner'}" id="${innerId}">${def ? def.name.charAt(0) : '?'}</span>`;
      }
    };
    applyCombatCrop('player-avatar-ring', 'player-avatar-inner');
    applyCombatCrop('pm-avatar-large',    'pm-avatar-inner');
  }

  function _renderAvatarGrid() {
    const state   = WBGameState.get();
    const player  = state.player;
    const current = player.avatarCharId;
    const catalogue = player.catalogue || {};

    // Tous les personnages découverts dans l'encyclopédie (toutes évolutions),
    // triés comme le catalogue : par lignée puis par stade d'évolution
    const discovered = (state.characters || []).filter(def => catalogue[def.id]?.discovered);

    const el = document.getElementById('pm-avatar-grid');
    if (!el) return;
    if (!discovered.length) {
      el.innerHTML = '<p style="font-size:.78rem;color:#888;grid-column:1/-1;padding:12px 0">Invoque des personnages pour débloquer des avatars.</p>';
      return;
    }

    el.innerHTML = discovered.map(def => {
      const sel = def.id === current;
      let imgHtml;
      if (def.portrait) {
        const crop = def.combatCrop || WBGameDatabase.defaultCombatCrop();
        const cx = crop.cx ?? 50, cy = crop.cy ?? 38, r = Math.max(1, crop.r ?? 38);
        const w  = +(5000 / r).toFixed(2);
        const l  = +(50 - cx * 50 / r).toFixed(2);
        const t  = +(50 - cy * 50 / r).toFixed(2);
        imgHtml = `<img src="${def.portrait}" alt="${def.name}"
          style="position:absolute;width:${w}%;height:${w}%;
                 left:${l}%;top:${t}%;max-width:none;max-height:none;
                 object-fit:cover;object-position:50% 0%;display:block">`;
      } else {
        imgHtml = `<span class="pm-av-ph">${def.name.charAt(0)}</span>`;
      }
      return `<div class="pm-avatar-option${sel?' selected':''}"
                   onclick="WBGameUI._pmSelectAvatar('${def.id}')"
                   title="${def.name}">${imgHtml}</div>`;
    }).join('');
  }

  function _pmSelectAvatar(charId) {
    WBGameState.updatePlayer({ avatarCharId: charId });
    _refreshAvatarDisplays();
    _renderAvatarGrid();
  }

  function _editPlayerName() {
    const current = WBGameState.getPlayer().name || '';
    const input   = document.createElement('input');
    input.type    = 'text';
    input.value   = current;
    input.maxLength = 20;
    input.style.cssText = `
      font-family:var(--font-display); font-size:1.05rem; font-weight:800;
      background:rgba(167,139,250,.1); border:1px solid rgba(167,139,250,.4);
      border-radius:8px; padding:4px 10px; color:#e2d9f3;
      text-align:center; width:150px;
    `;
    const nameEl = document.getElementById('pm-player-name');
    if (!nameEl) return;
    nameEl.replaceWith(input);
    input.id = 'pm-player-name-input';
    input.focus(); input.select();
    const save = () => {
      const newName = input.value.trim() || current;
      WBGameState.updatePlayer({ name: newName });
      input.replaceWith(Object.assign(document.createElement('span'), {
        id: 'pm-player-name', className: 'pm-player-name', textContent: newName
      }));
      document.getElementById('pm-edit-name-btn')?.addEventListener('click', _editPlayerName);
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => { if (e.key==='Enter') input.blur(); if (e.key==='Escape') { input.value=current; input.blur(); } });
  }

  function _pmToggleMusic() {
    WBAudioSystem.toggleMute?.();
    _renderPlayerMenu();
  }

  function _pmSetMusicVol(val) {
    const v = parseInt(val) / 100;
    WBAudioSystem.setMusicVolume?.(v);
    const lbl = document.getElementById('pm-vol-music-lbl');
    if (lbl) lbl.textContent = `${val}%`;
    const bgPlayer = document.getElementById('bg-audio-player');
    if (bgPlayer) bgPlayer.volume = v;
    WBGameState.updateConfig({ audio: { ...WBGameState.getConfig().audio, musicVolume: v } });
  }

  function _pmSetSfxVol(val) {
    const v = parseInt(val) / 100;
    WBAudioSystem.setSfxVolume?.(v);
    const lbl = document.getElementById('pm-vol-sfx-lbl');
    if (lbl) lbl.textContent = `${val}%`;
    WBGameState.updateConfig({ audio: { ...WBGameState.getConfig().audio, sfxVolume: v } });
  }

  function _pmToggleSfx() {
    const cfg = WBGameState.getConfig();
    const cur = cfg.audio?.sfxEnabled !== false;
    WBGameState.updateConfig({ audio: { ...cfg.audio, sfxEnabled: !cur } });
    _renderPlayerMenu();
  }

  function _pmTogglePref(key, value) {
    const player = WBGameState.getPlayer();
    WBGameState.updatePlayer({ prefs: { ...(player.prefs||{}), [key]: value } });
  }

  // ─── SYSTÈME DE BULLES D'AIDE CONTEXTUELLES ──────────────────────────────────

  const HELP_CONTENT = {
    collection: {
      title: '🎭 Ma Collection',
      text: `Toutes les créatures que tu as obtenues par invocations ou captures en combat.
Clique sur une carte pour voir sa fiche complète : stats, passif, affinités de types, historique.
Utilise les filtres et le tri en haut pour retrouver rapidement une créature.
Les chiffres en surimpression indiquent le niveau d'Éveil (★) et le niveau actuel.`,
    },
    team: {
      title: '🎒 Ma Préparation',
      text: `Compose ton équipe de combat.<br>
L'équipe est utilisée dans tous les modes sauf Battue (équipe aléatoire) et Combat Event (créatures du Tag uniquement).<br>
L'ordre n'a pas d'importance — l'initiative dépend de la <b>Grâce</b> de chaque créature.<br><br>
<b>Conseil</b> : équilibre Vitalité (tank), Puissance (dégâts) et Agilité (vitesse d'action).`,
    },
    combat: {
      title: '⚔️ Modes de Combat',
      text: `<b>🌍 Expédition</b> — Progression par monde. Clé pour la montée en niveau.<br>
<b>🐾 Élevage</b> — Affronte toute la lignée d'une créature (toutes ses évolutions).<br>
<b>🎲 Battue</b> — Équipe aléatoire tirée de ta collection.<br>
<b>🗺️ Territoire</b> — Affronte 6 créatures d'un même type, dans son propre territoire.<br>
<b>✨ Battue Sauvage</b> — Équipe aléatoire, ennemies du Tag Event uniquement.<br>
<b>✨ Combat [Tag]</b> — Alliées ET ennemies du Tag Event uniquement. Récompenses bonifiées.`,
    },
    trophy: {
      title: '🎯 Traque',
      text: `Des vagues de créatures Niveau 1 s'enchaînent à l'infini pendant un nombre de tours limité. Elles n'attaquent jamais — inflige un maximum de dégâts pour faire grimper ton score avant la fin du temps imparti.<br><br>
Chaque ennemi vaincu est immédiatement remplacé par un nouveau, et rapporte un bonus de points. Aucun XP, Or ou Essence Sauvage n'est gagné sur ce mode — uniquement du score.<br><br>
Ton meilleur score débloque des paliers de récompense, à réclamer manuellement sur l'écran <b>Récompenses</b> — rien n'est distribué automatiquement en fin de combat.`,
    },
    gacha: {
      title: '💧 Conquêtes — Invocations',
      text: `Dépense de l'Essence Sauvage pour rencontrer de nouvelles créatures.<br>
<b>×1</b> = 100 💧 &nbsp;|&nbsp; <b>×10</b> = 900 💧 (10% de réduction).<br><br>
<b>Pitié</b> : Rare garantie toutes les 10, Épique toutes les 50, Légendaire toutes les 100 invocations.<br><br>
La <b>Bannière Event</b> (si un Event est actif) propose uniquement des créatures du Tag avec des taux de rareté uniformes.`,
    },
    equip: {
      title: '⚔️ Équipements',
      text: `Équipe tes créatures avec 3 emplacements : <b>Arme</b>, <b>Armure</b> et <b>Accessoire</b>.<br>
Chaque équipement booste Vitalité, Puissance, Résistance et/ou Agilité.<br>
Les équipements mythiques ont les meilleurs bonus.<br><br>
Pour équiper : va dans <b>Ma Collection</b> → fiche d'une créature → onglet Équipements.`,
    },
    inventory: {
      title: '🎒 Inventaire',
      text: `Tes objets consommables et équipements non équipés.<br><br>
<b>💊 Pilule de Prestige</b> — Permet à une créature au niveau max de continuer à progresser (Éveil).<br>
<b>🧪 Nectar du Désir</b> — Restaure de l'Énergie immédiatement.<br><br>
Les objets s'utilisent depuis la fiche de la créature ou directement ici.`,
    },
    shop: {
      title: '🛍️ Shopping',
      text: `La boutique est organisée en 3 lignes :<br><br>
<b>Ligne 1 — Permanents</b> : Pilule de Prestige et Nectar du Désir, toujours disponibles.<br>
<b>Ligne 2 — Event</b> : Créatures du Tag Event en cours avec <b>-20%</b> (prix barré). Disponible uniquement pendant un Event.<br>
<b>Ligne 3 — Sélection du moment</b> : 9 articles renouvelés automatiquement chaque jour.`,
    },
    quests: {
      title: '🧭 Missions',
      text: `<b>✨ Missions Event</b> (bloc violet) — Quêtes liées au Tag Event. Remises à zéro à chaque nouvel Event. Récompenses en Essence Sauvage.<br><br>
<b>🗓️ Rituels Event</b> — Connexion quotidienne sur 10 jours. Le Jour 10 offre une créature <b>Épique</b> du Tag !<br><br>
<b>📅 Rendez-vous du jour</b> — Quêtes quotidiennes classiques : vaincre, capturer, invoquer...`,
    },
    catalogue: {
      title: '📖 Catalogue',
      text: `Encyclopédie de toutes les créatures du jeu, découvertes ou non.<br>
Les silhouettes grises représentent des créatures non encore rencontrées.<br>
Une créature est découverte quand tu l'as invoquée ou capturée au moins une fois.<br><br>
Le Catalogue affiche aussi les <b>lignées d'évolution</b> — une créature peut évoluer en progressant en niveau.`,
    },
  };

  function _helpBtn(key) {
    return `<button class="help-btn" onclick="WBGameUI.showHelp('${key}')" aria-label="Aide">❓</button>`;
  }

  function showHelp(key) {
    document.getElementById('help-bubble')?.remove();
    const content = HELP_CONTENT[key];
    if (!content) return;

    const bubble = document.createElement('div');
    bubble.id = 'help-bubble';
    bubble.className = 'help-bubble';
    bubble.innerHTML = `
      <div class="help-bubble-header">
        <span class="help-bubble-title">${content.title}</span>
        <button class="help-bubble-close" onclick="document.getElementById('help-bubble')?.remove()" aria-label="Fermer">✕</button>
      </div>
      <div class="help-bubble-body">${content.text}</div>
    `;

    const shell = document.querySelector('.app-shell') || document.body;
    shell.appendChild(bubble);

    // Fermer en cliquant en dehors
    setTimeout(() => {
      const close = (e) => {
        if (!bubble.contains(e.target) && !e.target.classList.contains('help-btn')) {
          bubble.remove();
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 50);
  }

  // ─── COLLECTION ───────────────────────────────────────────────────────────────

  function renderCollection() {
    const el = document.getElementById('screen-collection');
    if (!el) return;
    const player = WBGameState.getPlayer();
    const state  = WBGameState.get();

    el.innerHTML = `
      <div class="screen-header">
        <h2>Collection <span class="badge">${player.collection.length}</span></h2>
        ${_helpBtn('collection')}
      </div>
      <div class="screen-controls">
        ${_renderSortSelect('col-sort', _collectionSort)}
      </div>
      ${_renderCharFilterBar('col', _collectionFilters, state)}
      <div class="card-grid" id="collection-grid"></div>
    `;

    _refreshCollectionGrid();

    document.getElementById('col-sort')?.addEventListener('change', e => {
      _collectionSort = e.target.value;
      _refreshCollectionGrid();
    });
    _bindCharFilterBar('col', _collectionFilters, _refreshCollectionGrid);
  }

  function _refreshCollectionGrid() {
    const state  = WBGameState.get();
    const player = WBGameState.getPlayer();
    _renderCollectionGrid(_decorateFilterSortChars(player.collection, _collectionSort, _collectionFilters, state));
  }

  function _renderCollectionGrid(decorated) {
    const grid = document.getElementById('collection-grid');
    if (!grid) return;

    if (decorated.length === 0) {
      const hasAny = WBGameState.getPlayer().collection.length > 0;
      grid.innerHTML = `<p class="empty-msg">${hasAny ? 'Aucun personnage ne correspond aux filtres.' : 'Aucun personnage dans la collection.'}</p>`;
      return;
    }

    const state = WBGameState.get();
    const types = state.types;
    grid.innerHTML = decorated.map(({ inst, def, stats, aura }) => {
      const t1 = types.find(t => t.id === def.type1);
      const t2 = def.type2 ? types.find(t => t.id === def.type2) : null;
      const equipBonus = WBGameDatabase.computeEquipBonus(inst.equipment, state.player.equipInventory, state.equipment);
      return _buildCharCard(def, inst, stats, t1, t2, { equipBonus, aura });
    }).join('');

    grid.querySelectorAll('.char-card').forEach(card => {
      card.addEventListener('click', () => _openCharDetail(card.dataset.instanceId));
    });
  }

  function _buildCharCard(def, inst, stats, t1, t2, opts = {}) {
    const rarityDef = WBGameDatabase.RARITIES[def.rarity] || {};
    const maxAwk    = WBGameState.getConfig().awakening.maxLevel;
    const awakStars = '★'.repeat(inst.awakening || 0) + '☆'.repeat(Math.max(0, maxAwk - (inst.awakening || 0)));
    const xpNeeded  = WBGameDatabase.xpForLevel(inst.level + 1, WBGameState.getConfig().level);
    const xpPct     = Math.min(100, Math.round((inst.xp / xpNeeded) * 100));
    const inTeamClass = opts.inTeam ? 'in-team' : '';
    const awkMaxClass = (inst.awakening || 0) >= maxAwk ? 'awakening-max' : '';
    const eb = opts.equipBonus || { hp: 0, atk: 0, def: 0, spd: 0 };

    return `
    <div class="char-card rarity-${def.rarity} ${inTeamClass} ${awkMaxClass}" data-instance-id="${inst.instanceId}" ${opts.inTeam ? 'style="opacity:.6"' : ''}>
      <div class="card-portrait">
        ${_portraitImgHtml(def)}
        <div class="card-rarity-badge" style="background:${rarityDef.color || '#888'}">${rarityDef.name || def.rarity}</div>
        ${opts.aura != null ? `<div class="card-aura-badge">⭐ ${opts.aura.toLocaleString('fr-FR')}</div>` : ''}
        ${opts.inTeam ? '<div class="in-team-badge">ÉQUIPE</div>' : ''}
      </div>
      <div class="card-info">
        <div class="card-name">${def.name}</div>
        <div class="card-level">Niv. <strong>${inst.level}</strong></div>
        <div class="card-types">
          ${t1 ? `<span class="type-badge" style="background:${t1.color}">${t1.icon} ${t1.name}</span>` : ''}
          ${t2 ? `<span class="type-badge" style="background:${t2.color}">${t2.icon} ${t2.name}</span>` : ''}
        </div>
        <div class="card-awakening">${awakStars}</div>
        <div class="xp-bar" title="XP ${inst.xp} / ${xpNeeded}">
          <div class="xp-bar-fill" style="width:${xpPct}%"></div>
        </div>
        <div class="card-stats-mini">
          <span title="Vitalité">💗 ${stats.hp}</span>
          <span title="Puissance">💪 ${stats.atk}</span>
          <span title="Résistance">🛡️ ${stats.def}</span>
          <span title="Agilité">🐆 ${stats.spd}</span>
        </div>
      </div>
    </div>`;
  }

  // ─── DÉTAIL PERSONNAGE ────────────────────────────────────────────────────────

  /**
   * Calcule les affinités de type d'un personnage (ou combattant) contre TOUS
   * les types du jeu : multiplicateur de dégâts infligés (en tant qu'attaquant,
   * type1+type2 cumulés) et reçus (en tant que cible, type1+type2 cumulés).
   * Ne retient que les multiplicateurs ≠ 1 (neutre, non affiché).
   * @param {string} type1 @param {string|null} type2
   * @returns {{dealt:Array<{type,mult}>, received:Array<{type,mult}>}}
   */
  function _computeTypeAffinities(type1, type2) {
    const state  = WBGameState.get();
    const matrix = state.typeMatrix;
    const dealt = [], received = [];
    state.types.forEach(t => {
      const dealtMult    = WBGameDatabase.getTypeEffectiveness(type1, type2, t.id, null, matrix);
      const receivedMult = WBGameDatabase.getTypeEffectiveness(t.id, null, type1, type2, matrix);
      if (dealtMult !== 1)    dealt.push({ type: t, mult: dealtMult });
      if (receivedMult !== 1) received.push({ type: t, mult: receivedMult });
    });
    return { dealt, received };
  }

  /** Regroupe une liste d'affinités par valeur de multiplicateur, du plus fort au plus faible */
  function _groupAffinitiesByMult(list) {
    const groups = {};
    list.forEach(({ type, mult }) => {
      (groups[mult] = groups[mult] || []).push(type);
    });
    return Object.entries(groups)
      .map(([mult, types]) => ({ mult: parseFloat(mult), types }))
      .sort((a, b) => b.mult - a.mult);
  }

  /** Style + libellé associés à un multiplicateur d'affinité */
  function _affinityMeta(mult) {
    if (mult >= 4)    return { cls: 'affinity-super',  label: 'Très efficace' };
    if (mult >= 2)    return { cls: 'affinity-good',   label: 'Efficace' };
    if (mult === 0)   return { cls: 'affinity-immune', label: 'Immunité' };
    if (mult <= 0.25) return { cls: 'affinity-vbad',   label: 'Très peu efficace' };
    return { cls: 'affinity-bad', label: 'Peu efficace' };
  }

  /** Formate un multiplicateur pour l'affichage (×2, ×0.5, ×4, ×0.25...) */
  function _formatAffinityMult(m) {
    if (m % 1 === 0) return `×${m}`;
    return `×${m}`.replace('0.', ',');
  }

  /**
   * Construit la section "Affinités de type" (dégâts infligés / reçus) pour la
   * fiche détaillée d'un personnage, partagée entre Collection et Combat.
   * @param {string} type1 @param {string|null} type2
   */
  function _buildTypeAffinitiesHtml(type1, type2) {
    const { dealt, received } = _computeTypeAffinities(type1, type2);
    if (dealt.length === 0 && received.length === 0) return '';

    const renderGroups = (groups) => groups.map(({ mult, types }) => {
      const meta = _affinityMeta(mult);
      return `
        <div class="affinity-row ${meta.cls}">
          <span class="affinity-mult">${_formatAffinityMult(mult)}</span>
          <span class="affinity-types">
            ${types.map(t => `<span class="type-badge-mini" style="background:${t.color}" title="${t.name}">${t.icon} ${t.name}</span>`).join('')}
          </span>
        </div>
      `;
    }).join('');

    return `
      <div class="detail-affinities">
        ${dealt.length > 0 ? `
          <div class="affinity-section">
            <div class="affinity-section-title">⚔️ Dégâts infligés</div>
            ${renderGroups(_groupAffinitiesByMult(dealt))}
          </div>
        ` : ''}
        ${received.length > 0 ? `
          <div class="affinity-section">
            <div class="affinity-section-title">🛡️ Dégâts reçus</div>
            ${renderGroups(_groupAffinitiesByMult(received))}
          </div>
        ` : ''}
      </div>
    `;
  }

  function _openCharDetail(instanceId) {
    const inst  = WBGameState.getPlayerChar(instanceId);
    if (!inst) return;
    const def   = WBGameState.getCharDef(inst.charId);
    const state = WBGameState.get();
    const _fs   = _computeFullStats(inst, def);
    const stats  = _fs.total;
    const eqBonus = _fs.eqBonus;  // conservé pour compatibilité

    const modal = document.getElementById('modal');
    if (!modal) return;

    const rarityDef = WBGameDatabase.RARITIES[def.rarity] || {};
    const types     = WBGameState.getTypes();
    const t1 = types.find(t => t.id === def.type1);
    const t2 = def.type2 ? types.find(t => t.id === def.type2) : null;
    const xpNeeded = WBGameDatabase.xpForLevel(inst.level + 1, state.config.level);
    const passives = WBGameState.getPassivesForCharacter(def);

    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-box">
          <button class="modal-close" id="modal-close">✕</button>
          <div class="detail-layout">
            <div class="detail-portrait ${(inst.awakening || 0) >= state.config.awakening.maxLevel ? 'awakening-max' : ''}">
              ${_detailPortraitImgHtml(def)}
              <div class="detail-rarity" style="background:${rarityDef.color}">${rarityDef.name}</div>
            </div>
            <div class="detail-info">
              <h3>${def.name}</h3>
              <div class="detail-types">
                ${t1 ? `<span class="type-badge" style="background:${t1.color}">${t1.icon} ${t1.name}</span>` : ''}
                ${t2 ? `<span class="type-badge" style="background:${t2.color}">${t2.icon} ${t2.name}</span>` : ''}
              </div>
              ${passives.length > 0 ? `
                <div class="detail-passives">
                  ${passives.map(p => `
                    <div class="detail-passive-item">
                      <span class="detail-passive-name">✨ ${p.name}</span>
                      <span class="detail-passive-desc">${p.description}</span>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
              ${_buildTypeAffinitiesHtml(def.type1, def.type2)}
              <div class="detail-level">Niveau <strong>${inst.level}</strong> — XP : ${inst.xp} / ${xpNeeded}</div>
              <div class="detail-awakening">Renforcement : ${'★'.repeat(inst.awakening || 0)}</div>
              <div class="stat-grid">
                <div class="stat-row stat-aura-row">
                  <span>⭐ Attrait</span><strong>${WBGameDatabase.computeAuraScore(_fs.total, state.config.combat).toLocaleString('fr-FR')}</strong>
                </div>
                <div class="stat-row stat-clickable" onclick="WBGameUI._showStatDetail('${instanceId}','hp',event)">
                  <span>💗 Vitalité</span><strong>${_fs.total.hp}</strong><span class="stat-detail-hint">ℹ</span>
                </div>
                <div class="stat-row stat-clickable" onclick="WBGameUI._showStatDetail('${instanceId}','atk',event)">
                  <span>💪 Puissance</span><strong>${_fs.total.atk}</strong><span class="stat-detail-hint">ℹ</span>
                </div>
                <div class="stat-row stat-clickable" onclick="WBGameUI._showStatDetail('${instanceId}','def',event)">
                  <span>🛡️ Résistance</span><strong>${_fs.total.def}</strong><span class="stat-detail-hint">ℹ</span>
                </div>
                <div class="stat-row stat-clickable" onclick="WBGameUI._showStatDetail('${instanceId}','spd',event)">
                  <span>🐆 Agilité</span><strong>${_fs.total.spd}</strong><span class="stat-detail-hint">ℹ</span>
                </div>
              </div>
              <div class="detail-equip">
                <h4>Équipements</h4>
                <div class="equip-slots">
                  ${EQUIP_SLOT_ORDER.map((slotKey, slot) => {
                    const invId = inst.equipment[slot];
                    const invEntry = invId ? state.player.equipInventory.find(ei => ei.instanceId === invId) : null;
                    const eq = invEntry ? state.equipment.find(e => e.id === invEntry.equipId) : null;
                    return `<div class="equip-slot" data-slot="${slot}" data-instance="${instanceId}">
                      ${eq ? `<strong>${eq.name}</strong><br><small>${_formatEquipBonuses(eq.bonuses)}</small>` : `<span class="empty-slot">Vide</span>`}
                    </div>`;
                  }).join('')}
                </div>
              </div>
              ${def.evolvesTo ? `<div class="detail-evo">${_formatEvoConditionText(def)}</div>` : ''}
              <div class="detail-char-history">
                <div class="detail-history-row">
                  <span>📅 Obtenue le</span>
                  <strong>${inst.obtainedAt ? new Date(inst.obtainedAt).toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' }) : '—'}</strong>
                </div>
                <div class="detail-history-row">
                  <span>🏆 Combats gagnés</span>
                  <strong>${(inst.battlesWon || 0).toLocaleString('fr-FR')}</strong>
                </div>
                <div class="detail-history-row">
                  <span>⚔️ Ennemies vaincues</span>
                  <strong>${(inst.enemiesDefeated || 0).toLocaleString('fr-FR')}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    modal.style.display = 'block';
    document.getElementById('modal-close')?.addEventListener('click', _closeModal);
    document.getElementById('modal-backdrop')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) _closeModal();
    });
  }

  /**
   * Ouvre la fiche détaillée complète d'un combattant EN COMBAT (allié ou
   * ennemi) : mêmes informations que la fiche Collection (portrait, rareté,
   * types, passifs, affinités de type, stats), plus l'état propre au combat
   * (PV actuels, altérations en cours). L'équipement détaillé n'est pas
   * disponible ici (seul le total déjà appliqué aux stats l'est).
   * @param {string} instanceId
   */
  function _openCombatantDetail(instanceId) {
    const battle = WBCombatEngine.getBattle();
    if (!battle) return;
    const combatant = [...battle.playerTeam, ...battle.enemyTeam].find(c => c.instanceId === instanceId);
    if (!combatant) return;

    const modal = document.getElementById('modal');
    if (!modal) return;

    const state = WBGameState.get();
    const rarityDef = WBGameDatabase.RARITIES[combatant.rarity] || {};
    const types = state.types;
    const t1 = types.find(t => t.id === combatant.type1);
    const t2 = combatant.type2 ? types.find(t => t.id === combatant.type2) : null;
    const passives = _getCombatantAllPassives(combatant, state);
    const statusEntries = combatant.statusEffects || [];

    const STATUS_LABELS = { poison: '☠ Empoisonné(e)', paralysis: '⚡ Paralysé(e)', charm: '💞 Charmé(e)' };

    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-box">
          <button class="modal-close" id="modal-close">✕</button>
          <div class="detail-layout">
            <div class="detail-portrait ${(combatant.awakening || 0) >= state.config.awakening.maxLevel ? 'awakening-max' : ''} ${!combatant.alive ? 'defeated' : ''}">
              ${_detailPortraitImgHtml(WBGameState.getCharDef(combatant.charId) || combatant)}
              <div class="detail-rarity" style="background:${rarityDef.color}">${rarityDef.name}</div>
            </div>
            <div class="detail-info">
              <h3>${combatant.name} ${combatant.isEnemy ? '<span class="detail-side-tag detail-side-enemy">Ennemi</span>' : '<span class="detail-side-tag detail-side-ally">Allié</span>'}</h3>
              <div class="detail-types">
                ${t1 ? `<span class="type-badge" style="background:${t1.color}">${t1.icon} ${t1.name}</span>` : ''}
                ${t2 ? `<span class="type-badge" style="background:${t2.color}">${t2.icon} ${t2.name}</span>` : ''}
              </div>
              ${passives.length > 0 ? `
                <div class="detail-passives">
                  ${passives.map(p => `
                    <div class="detail-passive-item">
                      <span class="detail-passive-name">✨ ${p.name}</span>
                      <span class="detail-passive-desc">${p.description}</span>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
              ${_buildTypeAffinitiesHtml(combatant.type1, combatant.type2)}
              <div class="detail-level">Niveau <strong>${combatant.level}</strong>${!combatant.alive ? ' — <strong style="color:var(--danger)">K.O.</strong>' : ''}</div>
              <div class="detail-awakening">Renforcement : ${'★'.repeat(combatant.awakening || 0)}</div>
              ${statusEntries.length > 0 ? `
                <div class="detail-status-effects">
                  ${statusEntries.map(s => `<span class="status-badge-detail">${STATUS_LABELS[s.type] || s.type}</span>`).join('')}
                </div>
              ` : ''}
              <div class="stat-grid">
                <div class="stat-row"><span>💗 Vitalité</span><strong>${combatant.currentHp} / ${combatant.maxHp}</strong></div>
                <div class="stat-row"><span>💪 Puissance</span><strong>${combatant.atk}</strong></div>
                <div class="stat-row"><span>🛡️ Résistance</span><strong>${combatant.def}</strong></div>
                <div class="stat-row"><span>🐆 Agilité</span><strong>${combatant.spd}</strong></div>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    modal.style.display = 'block';
    document.getElementById('modal-close')?.addEventListener('click', _closeModal);
    document.getElementById('modal-backdrop')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) _closeModal();
    });
  }

  /** Renvoie tous les passifs actifs d'un combattant (natifs + acquis en combat, ex: Mystère) */
  function _getCombatantAllPassives(combatant, state) {
    const extra = (combatant.extraPassiveIds || []).map(id => state.passives.find(p => p.id === id)).filter(Boolean);
    return [...(combatant.passives || []), ...extra];
  }

  // ─── HELPERS DE RENDU DES PORTRAITS (avec recadrage et zoom) ─────────────────
  // Zoom correct : l'IMAGE grossit à l'intérieur d'un cadre fixe (overflow:hidden).
  // Le conteneur parent doit avoir position:relative + overflow:hidden.
  // Formule de positionnement : left = crop.x*(1-zoom)%, top = crop.y*(1-zoom)%
  // Ce calcul maintient le point focal à sa position dans le cadre quel que soit le zoom.

  function _cropImgHtml(src, name, crop) {
    if (!src) return null;
    const zoom = Math.max(1, Math.min(5, crop.zoom ?? 1));
    const x = crop.x ?? 50, y = crop.y ?? 20;
    return `<img src="${src}" alt="${name||''}"
      style="position:absolute;width:${zoom*100}%;height:${zoom*100}%;
             max-width:none;max-height:none;object-fit:cover;
             object-position:${x}% ${y}%;display:block;
             left:${(1-zoom)*x}%;top:${(1-zoom)*y}%">`;
  }

  function _combatCropImgHtml(src, name, crop) {
    if (!src) return null;
    const cx = crop.cx ?? 50, cy = crop.cy ?? 38, r = Math.max(1, crop.r ?? 38);
    // Formule géométrique : montre la même zone que le cercle de l'éditeur,
    // indépendante de la taille du conteneur (carré).
    // w = 5000/r %  |  l = 50 - cx*50/r %  |  t = 50 - cy*50/r %
    const w = +(5000 / r).toFixed(2);
    const l = +(50 - cx * 50 / r).toFixed(2);
    const t = +(50 - cy * 50 / r).toFixed(2);
    return `<img src="${src}" alt="${name||''}"
      style="position:absolute;
             width:${w}%;height:${w}%;
             left:${l}%;top:${t}%;
             max-width:none;max-height:none;
             object-fit:cover;object-position:50% 0%;
             display:block">`;
  }

  /** Portrait de la vignette Collection (petit carré). */
  function _portraitImgHtml(def) {
    const crop = def?.portraitCrop || WBGameDatabase.defaultPortraitCrop();
    return _cropImgHtml(def?.portrait, def?.name, crop)
      || `<div class="card-portrait-placeholder">${(def?.name||'?').charAt(0)}</div>`;
  }

  /** Portrait de la fiche personnage (grand rectangle vertical dans la modale). */
  function _detailPortraitImgHtml(def) {
    const crop = def?.detailCrop || WBGameDatabase.defaultDetailCrop();
    return _cropImgHtml(def?.portrait, def?.name, crop)
      || `<div class="detail-portrait-placeholder">${(def?.name||'?').charAt(0)}</div>`;
  }

  /** Portrait de combat (petit cercle). */
  function _combatPortraitImgHtml(def) {
    const crop = def?.combatCrop || WBGameDatabase.defaultCombatCrop();
    return _combatCropImgHtml(def?.portrait, def?.name, crop)
      || `<div class="portrait-ph">${(def?.name||'?').charAt(0)}</div>`;
  }

  /** Bonus d'un équipement ajustés selon le niveau de CET exemplaire précis (pas la valeur brute de la fiche) */
  function _scaledEquipBonuses(def, invInst) {
    const mult = WBGameDatabase.equipLevelMultiplier(invInst?.level);
    const b = def.bonuses || {};
    return {
      hp:  Math.round((b.hp  || 0) * mult),
      atk: Math.round((b.atk || 0) * mult),
      def: Math.round((b.def || 0) * mult),
      spd: Math.round((b.spd || 0) * mult),
    };
  }

  function _formatEquipBonuses(bonuses) {
    return Object.entries(bonuses)
      .filter(([,v]) => v !== 0)
      .map(([k,v]) => `${k.toUpperCase()}+${v}`)
      .join(' ');
  }

  /**
   * Formate une valeur de stat totale avec le delta apporté par l'équipement,
   * affiché en vert (+XX) si positif ou en rouge (-WW) si négatif. Sans delta,
   * retourne simplement la valeur.
   */
  function _formatStatWithBonus(total, bonus) {
    if (!bonus) return `${total}`;
    const cls  = bonus > 0 ? 'stat-bonus-pos' : 'stat-bonus-neg';
    const sign = bonus > 0 ? '+' : '';
    return `${total} <span class="${cls}">${sign}${bonus}</span>`;
  }

  /**
   * Calcule les stats complètes d'une instance avec TOUS les bonus :
   * base, croissance niveau, awakening, équipement, bonus joueur.
   * Retourne le détail par source pour l'affichage dans la fiche.
   */
  function _computeFullStats(inst, def) {
    const _zero = { hp:0, atk:0, def:0, spd:0 };
    try {
      const state  = WBGameState.get();
      const cfg    = state.config || {};
      const lc     = cfg.level   || {};
      const ac     = cfg.awakening || {};

      // Stats de base avec croissance de niveau
      const bs   = def?.baseStats || _zero;
      const grow = (base, stat) => {
        const rate = lc.statGrowthPerLevel?.[stat] || 0;
        return Math.floor(base * (1 + rate * ((inst.level || 1) - 1)));
      };
      const base = {
        hp:  grow(bs.hp  || 0, 'hp'),
        atk: grow(bs.atk || 0, 'atk'),
        def: grow(bs.def || 0, 'def'),
        spd: grow(bs.spd || 0, 'spd'),
      };

      // Bonus awakening
      const awk  = ac.bonusPerLevel?.[def?.rarity] || _zero;
      const awLv = inst?.awakening || 0;
      const awBonus = {
        hp:  Math.floor((base.hp  || 0) * ((awk.hp  || 0) / 100) * awLv),
        atk: Math.floor((base.atk || 0) * ((awk.atk || 0) / 100) * awLv),
        def: Math.floor((base.def || 0) * ((awk.def || 0) / 100) * awLv),
        spd: Math.floor((base.spd || 0) * ((awk.spd || 0) / 100) * awLv),
      };

      // Bonus équipement
      let eqBonus = _zero;
      try {
        eqBonus = WBGameDatabase.computeEquipBonus(
          inst?.equipment, state.player?.equipInventory, state.equipment
        ) || _zero;
      } catch (_) {}

      // Bonus joueur
      let playerBonusVal = 0;
      try {
        playerBonusVal = WBGameState.getPlayerStatBonus?.()?.bonus ?? 0;
      } catch (_) {}

      const total = {
        hp:  Math.min(999999, (base.hp  + awBonus.hp  + eqBonus.hp  + playerBonusVal)),
        atk: Math.min(99999,  (base.atk + awBonus.atk + eqBonus.atk + playerBonusVal)),
        def: Math.min(99999,  (base.def + awBonus.def + eqBonus.def + playerBonusVal)),
        spd: Math.min(99999,  (base.spd + awBonus.spd + eqBonus.spd + playerBonusVal)),
      };

      return { base, awBonus, eqBonus, playerBonus: playerBonusVal, total };
    } catch (e) {
      // Fallback absolu : stats brutes sans bonus
      const bs = def?.baseStats || _zero;
      return {
        base: { ...bs }, awBonus: { ..._zero }, eqBonus: { ..._zero }, playerBonus: 0,
        total: { hp: bs.hp||0, atk: bs.atk||0, def: bs.def||0, spd: bs.spd||0 },
      };
    }
  }

  function _showStatDetail(instanceId, statKey, event) {
    // Fermer un panel existant
    document.getElementById('stat-detail-panel')?.remove();

    const state   = WBGameState.get();
    const inst    = state.player.collection.find(c => c.instanceId === instanceId);
    const def     = inst ? WBGameState.getCharDef(inst.charId) : null;
    if (!inst || !def) return;

    const _fs = _computeFullStats(inst, def);
    const labels = { hp: '💗 Vitalité', atk: '💪 Puissance', def: '🛡️ Résistance', spd: '🐆 Agilité' };

    const base0         = def.baseStats[statKey];
    const baseWithLevel = _fs.base[statKey];
    const levelBonus    = baseWithLevel - base0;
    const awBonus       = _fs.awBonus[statKey];
    const eqBonus       = _fs.eqBonus[statKey];
    const pb            = _fs.playerBonus;
    const total         = _fs.total[statKey];

    const panel = document.createElement('div');
    panel.id    = 'stat-detail-panel';
    panel.className = 'stat-detail-panel';
    panel.innerHTML = `
      <div class="sdb-header">
        <span class="sdb-title">${labels[statKey]}</span>
        <button class="sdb-close" onclick="document.getElementById('stat-detail-panel')?.remove()">✕</button>
      </div>
      <div class="sdb-rows">
        <div class="sdb-row sdb-base">
          <span class="sdb-icon">📊</span>
          <span class="sdb-label">Stat de base (Niv.1)</span>
          <span class="sdb-value">${base0}</span>
        </div>
        ${levelBonus > 0 ? `<div class="sdb-row">
          <span class="sdb-icon">📈</span>
          <span class="sdb-label">Croissance (Niv.${inst.level})</span>
          <span class="sdb-value">+${levelBonus}</span>
        </div>` : ''}
        ${awBonus > 0 ? `<div class="sdb-row">
          <span class="sdb-icon">⭐</span>
          <span class="sdb-label">Renforcement ×${inst.awakening || 0}</span>
          <span class="sdb-value">+${awBonus}</span>
        </div>` : ''}
        ${eqBonus > 0 ? `<div class="sdb-row">
          <span class="sdb-icon">💍</span>
          <span class="sdb-label">Équipements équipés</span>
          <span class="sdb-value">+${eqBonus}</span>
        </div>` : ''}
        ${pb > 0 ? `<div class="sdb-row sdb-player">
          <span class="sdb-icon">🌟</span>
          <span class="sdb-label">Bonus joueur</span>
          <span class="sdb-value">+${pb}</span>
        </div>` : ''}
        <div class="sdb-row sdb-total">
          <span class="sdb-icon">∑</span>
          <span class="sdb-label">Total</span>
          <span class="sdb-value">${total}</span>
        </div>
      </div>
    `;

    // Position : utiliser les coordonnées de l'élément cliqué
    const trigger = (event?.currentTarget) || (event?.target);
    const rect    = trigger?.getBoundingClientRect?.();
    const shell   = document.querySelector('.app-shell');
    const shellRect = shell?.getBoundingClientRect() || { left: 0, top: 0, right: window.innerWidth };

    panel.style.position = 'fixed';
    panel.style.zIndex   = '9999';
    const panelW = 250;
    let left = rect ? rect.left : window.innerWidth / 2 - panelW / 2;
    let top  = rect ? rect.bottom + 4 : window.innerHeight / 2;
    // Ne pas dépasser à droite
    if (left + panelW > shellRect.right - 8) left = shellRect.right - panelW - 8;
    if (left < shellRect.left + 8)           left = shellRect.left + 8;
    panel.style.left  = `${left}px`;
    panel.style.top   = `${top}px`;
    panel.style.width = `${panelW}px`;

    document.body.appendChild(panel);

    // Fermer en cliquant ailleurs
    setTimeout(() => {
      const close = e => {
        if (!panel.contains(e.target)) {
          panel.remove();
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 50);
  }
  function _describeEquippedBy(equippedByInstanceId) {
    if (!equippedByInstanceId) return null;
    const holderInst = WBGameState.getPlayerChar(equippedByInstanceId);
    const holderDef  = holderInst ? WBGameState.getCharDef(holderInst.charId) : null;
    if (!holderDef) return null;
    return { name: holderDef.name, portrait: holderDef.portrait };
  }

  function _closeModal() {
    const modal = document.getElementById('modal');
    if (modal) modal.style.display = 'none';
  }

  // ─── ÉQUIPE ───────────────────────────────────────────────────────────────────

  function renderTeam() {
    const el = document.getElementById('screen-team');
    if (!el) return;
    const player = WBGameState.getPlayer();
    const cfg    = WBGameState.getConfig();
    const state  = WBGameState.get();
    const types  = state.types;

    el.innerHTML = `
      <div class="screen-header"><h2>Ma Préparation <small>(${WBGameState.getTeam().length}/${cfg.game.maxTeamSize})</small></h2>${_helpBtn('team')}</div>
      <div class="team-slots" id="team-slots">
        ${Array.from({length: cfg.game.maxTeamSize}, (_, i) => {
          const member = player.team[i] ? player.collection.find(c => c.instanceId === player.team[i]) : null;
          const def    = member ? WBGameState.getCharDef(member.charId) : null;
          const _mfs   = (member && def) ? _computeFullStats(member, def) : null;
          const stats  = _mfs?.total || null;
          const eb     = { hp:0, atk:0, def:0, spd:0 };
          const t1 = def ? types.find(t => t.id === def.type1) : null;
          const t2 = def?.type2 ? types.find(t => t.id === def.type2) : null;
          const isAwkMax = member ? (member.awakening || 0) >= state.config.awakening.maxLevel : false;
          return `
          <div class="team-slot ${member ? 'filled' : 'empty'}" data-slot="${i}">
            ${member && def ? `
              <div class="team-member-card ${isAwkMax ? 'awakening-max' : ''}" data-instance-id="${member.instanceId}">
                <div class="team-portrait">
                  ${_portraitImgHtml(def)}
                </div>
                <div class="team-info">
                  <div class="team-name">${def.name}</div>
                  <div class="team-level">Niv. ${member.level}</div>
                  <div class="team-types">
                    ${t1 ? `<span class="type-badge" style="background:${t1.color}">${t1.icon} ${t1.name}</span>` : ''}
                    ${t2 ? `<span class="type-badge" style="background:${t2.color}">${t2.icon} ${t2.name}</span>` : ''}
                  </div>
                  <div class="team-stats-mini">
                    <span title="Vitalité">💗 ${stats.hp}</span>
                    <span title="Puissance">💪 ${stats.atk}</span>
                    <span title="Résistance">🛡️ ${stats.def}</span>
                    <span title="Agilité">🐆 ${stats.spd}</span>
                  </div>
                </div>
                <button class="btn-remove-team" data-instance-id="${member.instanceId}">✕</button>
              </div>` :
              `<div class="empty-slot-label">+ Ajouter</div>`}
          </div>`;
        }).join('')}
      </div>
      <div class="screen-header" style="margin-top:2rem">
        <h2>Collection</h2>
      </div>
      <div class="screen-controls">
        ${_renderSortSelect('team-sort', _teamSort)}
      </div>
      ${_renderCharFilterBar('team', _teamFilters, state)}
      <div class="card-grid" id="team-collection-grid"></div>
    `;

    _refreshTeamCollectionGrid();

    document.getElementById('team-sort')?.addEventListener('change', e => {
      _teamSort = e.target.value;
      _refreshTeamCollectionGrid();
    });
    _bindCharFilterBar('team', _teamFilters, _refreshTeamCollectionGrid);

    // Boutons retrait de l'équipe
    el.querySelectorAll('.btn-remove-team').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const iid = btn.dataset.instanceId;
        WBGameState.setTeam(WBGameState.getPlayer().team.filter(id => id !== iid));
      });
    });
  }

  /** Rafraîchit la grille de sélection de personnages dans l'écran Préparation (triée + filtrée) */
  function _refreshTeamCollectionGrid() {
    const state  = WBGameState.get();
    const player = WBGameState.getPlayer();
    const cfg    = state.config;
    const grid   = document.getElementById('team-collection-grid');
    if (!grid) return;

    const inTeam = new Set(player.team.filter(Boolean));
    const types  = state.types;
    const decorated = _decorateFilterSortChars(player.collection, _teamSort, _teamFilters, state);

    if (decorated.length === 0) {
      const hasAny = player.collection.length > 0;
      grid.innerHTML = `<p class="empty-msg">${hasAny ? 'Aucun personnage ne correspond aux filtres.' : 'Aucun personnage dans la collection.'}</p>`;
      return;
    }

    grid.innerHTML = decorated.map(({ inst, def, stats, aura }) => {
      const t1 = types.find(t => t.id === def.type1);
      const t2 = def.type2 ? types.find(t => t.id === def.type2) : null;
      const equipBonus = WBGameDatabase.computeEquipBonus(inst.equipment, player.equipInventory, state.equipment);
      return _buildCharCard(def, inst, stats, t1, t2, { inTeam: inTeam.has(inst.instanceId), equipBonus, aura });
    }).join('');

    grid.querySelectorAll('.char-card').forEach(card => {
      card.addEventListener('click', () => {
        const iid = card.dataset.instanceId;
        const currentTeam = WBGameState.getPlayer().team.filter(Boolean);
        if (inTeam.has(iid)) {
          WBGameState.setTeam(currentTeam.filter(id => id !== iid));
        } else if (currentTeam.length < cfg.game.maxTeamSize) {
          WBGameState.setTeam([...currentTeam, iid]);
        } else {
          _showToast(`Équipe pleine ! (max ${cfg.game.maxTeamSize})`);
        }
      });
    });
  }

  // ─── COMBAT ───────────────────────────────────────────────────────────────────

  /** Écran intermédiaire de la Traque : choix entre lancer un combat ou consulter/réclamer les récompenses */
  function renderTrophyHub() {
    const el = document.getElementById('screen-trophy-hub');
    if (!el) return;
    const state = WBGameState.get();
    const bestScore = state.player.trophy?.bestScore || 0;
    const tiers = state.config.combat?.trophy?.rewardTiers || [];
    const claimable = tiers.filter(t => bestScore >= t.score && !(state.player.trophy?.tiersReached || []).includes(t.id)).length;

    el.innerHTML = `
      <div class="screen-header"><h2>🎯 Traque</h2>${_helpBtn('trophy')}</div>
      <div class="trophy-hub-screen">
        <div class="trophy-hub-best">
          <div class="trophy-hub-best-label">Meilleur score</div>
          <div class="trophy-hub-best-value">${bestScore.toLocaleString('fr-FR')}</div>
        </div>
        <button class="trophy-hub-btn trophy-hub-btn-combat" id="btn-trophy-hub-combat">
          <span class="trophy-hub-btn-icon">⚔️</span>
          <span class="trophy-hub-btn-label">Combat</span>
          <span class="trophy-hub-btn-desc">Lancer une nouvelle Traque</span>
        </button>
        <button class="trophy-hub-btn trophy-hub-btn-rewards" id="btn-trophy-hub-rewards">
          <span class="trophy-hub-btn-icon">🎁</span>
          <span class="trophy-hub-btn-label">Récompenses</span>
          <span class="trophy-hub-btn-desc">${claimable > 0 ? `${claimable} récompense${claimable > 1 ? 's' : ''} à réclamer !` : 'Consulter les paliers'}</span>
          ${claimable > 0 ? `<span class="trophy-hub-btn-badge">${claimable}</span>` : ''}
        </button>
      </div>
    `;

    document.getElementById('btn-trophy-hub-combat')?.addEventListener('click', () => {
      showScreen('combat');
      setTimeout(() => _launchCombat({ mode: 'trophy' }), 100);
    });
    document.getElementById('btn-trophy-hub-rewards')?.addEventListener('click', () => {
      showScreen('trophy-rewards');
    });
  }

  /** Écran des récompenses de la Traque — un "totem" de paliers de score, à réclamer manuellement */
  function renderTrophyRewards() {
    const el = document.getElementById('screen-trophy-rewards');
    if (!el) return;
    const state = WBGameState.get();
    const bestScore = state.player.trophy?.bestScore || 0;
    const claimedIds = new Set(state.player.trophy?.tiersReached || []);
    const tiers = [...(state.config.combat?.trophy?.rewardTiers || [])].sort((a, b) => b.score - a.score); // du plus haut vers le plus bas = "vers le ciel"

    el.innerHTML = `
      <div class="screen-header"><h2>🎁 Récompenses de la Traque</h2>${_helpBtn('trophy')}</div>
      <div class="trophy-totem">
        <div class="trophy-totem-best">🏆 Meilleur score : <strong>${bestScore.toLocaleString('fr-FR')}</strong></div>
        <div class="trophy-totem-pole">
          ${tiers.length === 0 ? '<p class="empty-msg">Aucun palier configuré.</p>' : tiers.map(t => {
            const claimed   = claimedIds.has(t.id);
            const reachable = bestScore >= t.score;
            const status    = claimed ? 'claimed' : reachable ? 'claimable' : 'locked';
            return `
              <div class="trophy-totem-tier trophy-totem-tier-${status}" data-tier-id="${t.id}">
                <div class="trophy-totem-tier-score">${t.score.toLocaleString('fr-FR')}</div>
                <div class="trophy-totem-tier-reward">${_formatRewardLabel(t.reward, state)}</div>
                ${claimed
                  ? `<div class="trophy-totem-tier-status">✅ Réclamée</div>`
                  : reachable
                    ? `<button class="trophy-totem-claim-btn" data-tier-id="${t.id}">Réclamer</button>`
                    : `<div class="trophy-totem-tier-status">🔒 ${t.score.toLocaleString('fr-FR')} requis</div>`}
              </div>`;
          }).join('')}
          <div class="trophy-totem-base">🗿</div>
        </div>
      </div>
    `;

    el.querySelectorAll('.trophy-totem-claim-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tierId = btn.dataset.tierId;
        const res = WBGameState.claimTrophyRewardTier(tierId);
        if (res.success) {
          _showToast('🎁 Récompense réclamée !', 'success');
          _updateHUD();
          renderTrophyRewards();
        } else {
          _showToast('❌ Impossible de réclamer cette récompense.', 'error');
        }
      });
    });
  }

  function renderCombatLobby() {
    const el = document.getElementById('screen-combat');
    if (!el) return;
    const team  = WBGameState.getTeam();
    const ev    = WBGameState.getActiveEvent();

    // Repli si l'event vient de se terminer pendant qu'un mode event était sélectionné
    if (!ev && (_combatMode === 'capriceEtoile' || _combatMode === 'fullEvent')) {
      _combatMode = 'story';
    }

    el.innerHTML = `
      <div class="screen-header"><h2>⚔ Combat</h2>${_helpBtn('combat')}</div>
      ${ev ? `<div class="event-combat-banner">✨ Event en cours — ${WBGameState.get().tags?.find(t=>t.id===ev.tagId)?.name || ev.tagId}</div>` : ''}
      <div class="combat-lobby">
        <div id="combat-mode-content-top"></div>
        <div class="team-preview">
          <h3>Votre équipe</h3>
          ${_combatMode === 'fullRandom' ? `<p class="combat-mode-note">🎲 Une équipe sera tirée au sort dans votre collection pour cette Battue. Votre équipe actuelle sera restaurée juste après.</p>` : ''}
          ${_combatMode === 'capriceEtoile' ? `<p class="combat-mode-note">🌟 Battue Sauvage : équipe aléatoire contre des adversaires ${WBGameState.get().tags?.find(t=>t.id===ev?.tagId)?.name || 'Event'} uniquement.</p>` : ''}
          ${_combatMode === 'fullEvent' ? `<p class="combat-mode-note">✨ Combat ${WBGameState.get().tags?.find(t=>t.id===ev?.tagId)?.name || 'Event'} : alliées ET adversaires sont du tag ${WBGameState.get().tags?.find(t=>t.id===ev?.tagId)?.name || 'Event'} uniquement.</p>` : ''}
          <div class="lobby-team">
            ${team.length === 0
              ? '<p class="empty-msg">Composez votre casting dans l\'onglet Préparation.</p>'
              : team.map(inst => {
                  const def   = WBGameState.getCharDef(inst.charId);
                  const stats = _computeFullStats(inst, def).total;
                  return `<div class="lobby-member">
                    <div class="lobby-portrait">${def.portrait ? _portraitImgHtml(def) : def.name.charAt(0)}</div>
                    <div><strong>${def.name}</strong> Niv.${inst.level}</div>
                    <div style="font-size:0.75rem;color:#aaa">💗${stats.hp} ✨${stats.atk} 🌹${stats.def} 🕊️${stats.spd}</div>
                  </div>`;
                }).join('')}
          </div>
        </div>
        <div id="combat-mode-content"></div>
      </div>
      <div id="battle-area" style="display:none"></div>
    `;

    _renderCombatModeContent();
  }

  /** Affiche le contenu adapté au mode de combat sélectionné */
  function _renderCombatModeContent() {
    if (_combatMode === 'line') { renderCombatByLine(); return; }
    if (_combatMode === 'arena') { renderCombatArena(); return; }
    if (_combatMode === 'story') { renderCombatStory(); return; }

    const top     = document.getElementById('combat-mode-content-top');
    const content = document.getElementById('combat-mode-content');
    if (!top) return;

    if (_combatMode === 'fullRandom') {
      const player = WBGameState.getPlayer();
      top.innerHTML = player.collection.length > 0
        ? `<button class="btn-primary btn-launch-combat" id="btn-launch" style="width:100%;margin-bottom:8px">🎲 Lancer la Battue</button>`
        : '';
      if (content) content.innerHTML = '';
      document.getElementById('btn-launch')?.addEventListener('click', () => _launchCombat({ mode: 'fullRandom' }));
      return;
    }

    if (_combatMode === 'capriceEtoile') {
      const ev = WBGameState.getActiveEvent();
      top.innerHTML = ev
        ? `<button class="btn-primary btn-launch-combat btn-event-combat" id="btn-launch" style="width:100%;margin-bottom:8px">🌟 Lancer la Battue Sauvage</button>`
        : `<p class="empty-msg">Aucun Event actif pour le moment.</p>`;
      if (content) content.innerHTML = '';
      document.getElementById('btn-launch')?.addEventListener('click', () => _launchCombat({ mode: 'capriceEtoile' }));
      return;
    }

    if (_combatMode === 'fullEvent') {
      const ev = WBGameState.getActiveEvent();
      const state = WBGameState.get();
      const tag = state.tags?.find(t => t.id === ev?.tagId);
      const player = WBGameState.getPlayer();
      const tagChars = ev ? player.collection.filter(inst => {
        const def = WBGameState.getCharDef(inst.charId);
        return def?.tags?.includes(ev.tagId);
      }) : [];
      top.innerHTML = ev
        ? (tagChars.length > 0
          ? `<button class="btn-primary btn-launch-combat btn-event-combat" id="btn-launch" style="width:100%;margin-bottom:8px">✨ Lancer Combat ${tag?.name || 'Event'}</button>`
          : `<p class="empty-msg">Vous n'avez aucun personnage ${tag?.name || 'Event'} dans votre collection.</p>`)
        : `<p class="empty-msg">Aucun Event actif pour le moment.</p>`;
      if (content) content.innerHTML = '';
      document.getElementById('btn-launch')?.addEventListener('click', () => _launchCombat({ mode: 'fullEvent' }));
      return;
    }
  }

  /**
   * Affiche la sélection d'arène : le joueur choisit un type, et affronte 6 ennemis
   * partageant tous ce type (en principal ou secondaire).
   */
  function renderCombatArena() {
    const top     = document.getElementById('combat-mode-content-top');
    const content = document.getElementById('combat-mode-content');
    if (!content) return;
    const state   = WBGameState.get();
    const team    = WBGameState.getTeam();
    const catalogue = state.player.catalogue || {};

    // Bouton en haut
    if (top) {
      top.innerHTML = _selectedArenaType && team.length > 0
        ? `<button class="btn-primary btn-launch-combat" id="btn-launch-arena" style="width:100%;margin-bottom:8px">🗺️ Entrer sur le territoire</button>`
        : '';
      document.getElementById('btn-launch-arena')?.addEventListener('click', () => _launchCombat({ mode: 'arena', arenaType: _selectedArenaType }));
    }

    // Pour chaque type, calculer combien de lignées DISTINCTES le joueur a débloquées
    // (au moins 1 personnage de la lignée dans le catalogue, ayant ce type en type1 ou type2)
    const ARENA_REQUIRED_LINES = 6;

    const typeUnlockData = state.types.map(t => {
      // Trouver toutes les lignées qui ont au moins un membre avec ce type
      const linesWithType = new Set();
      state.characters.forEach(c => {
        if (c.type1 === t.id || c.type2 === t.id) {
          linesWithType.add(c.evolutionLine);
        }
      });
      // Parmi ces lignées, combien ont leur forme de base dans le catalogue du joueur ?
      let unlockedLines = 0;
      linesWithType.forEach(lineId => {
        const baseForm = state.characters
          .filter(c => c.evolutionLine === lineId)
          .sort((a, b) => a.evolutionStage - b.evolutionStage)[0];
        if (baseForm && catalogue[baseForm.id]) unlockedLines++;
      });
      return {
        type:          t,
        totalLines:    linesWithType.size,
        unlockedLines,
        isUnlocked:    unlockedLines >= ARENA_REQUIRED_LINES,
      };
    });

    const unlockedArenas = typeUnlockData.filter(d => d.isUnlocked).length;
    const totalArenas    = typeUnlockData.length;

    content.innerHTML = `
      <h3 class="combat-line-title">Choisissez une arène</h3>
      <p class="combat-line-subtitle">
        ${unlockedArenas}/${totalArenas} arène${unlockedArenas > 1 ? 's' : ''} débloquée${unlockedArenas > 1 ? 's' : ''}
        — Débloquez ${ARENA_REQUIRED_LINES} lignées d'un même type pour accéder à son arène.
      </p>
      <div class="evo-line-grid">
        ${typeUnlockData.map(({ type: t, totalLines, unlockedLines, isUnlocked }) => {
          if (isUnlocked) {
            return `
            <div class="evo-line-card arena-card ${_selectedArenaType === t.id ? 'selected' : ''}" data-arena-type="${t.id}" title="Territoire ${t.name}">
              <div class="arena-type-icon" style="background:${t.color}">${t.icon}</div>
              <div class="evo-line-name" style="color:${t.color}">Territoire ${t.name}</div>
              <div class="evo-line-meta">
                <span class="evo-line-count">6 ennemis ${t.name}</span>
              </div>
            </div>`;
          } else {
            // Verrouillée : afficher la progression
            const progress = Math.min(unlockedLines, ARENA_REQUIRED_LINES);
            const pct      = Math.round((progress / ARENA_REQUIRED_LINES) * 100);
            return `
            <div class="evo-line-card arena-card locked" title="Débloquez ${ARENA_REQUIRED_LINES - unlockedLines} lignée(s) ${t.name} de plus">
              <div class="arena-type-icon" style="background:#333;opacity:0.6">${t.icon}</div>
              <div class="evo-line-name" style="color:#666">Territoire ${t.name}</div>
              <div class="evo-line-meta">
                <span class="evo-line-count" style="color:#555">${progress}/${ARENA_REQUIRED_LINES} lignées</span>
              </div>
              <div class="arena-progress-bar">
                <div class="arena-progress-fill" style="width:${pct}%;background:${t.color}"></div>
              </div>
              <div class="lock-badge">🔒</div>
            </div>`;
          }
        }).join('')}
      </div>
      ${_selectedArenaType && team.length > 0 ? `` : ''}
    `;

    // Seules les arènes débloquées sont cliquables
    content.querySelectorAll('.arena-card:not(.locked)').forEach(card => {
      card.addEventListener('click', () => {
        _selectedArenaType = card.dataset.arenaType;
        renderCombatArena();
      });
    });
  }

  /**
   * Affiche la sélection de lignée évolutive pour un combat thématique :
   * le joueur choisit une lignée et affronte tous ses stades d'évolution
   */
  /**
   * ── MODE ODYSSÉE ──
   * Affiche la progression par Profondeur/Épreuve. Chaque épreuve est soit normale,
   * soit béta (x10 et x20 de chaque profondeur, en violet), soit alpha (x25, en rouge).
   * Une épreuve ne peut être rejouée une fois accomplie (en cas de défaite, la même
   * équipe ennemie est conservée pour les réessais).
   */
  function renderCombatStory() {
    const top     = document.getElementById('combat-mode-content-top');
    const content = document.getElementById('combat-mode-content');
    if (!content) return;

    const state    = WBGameState.get();
    const player   = WBGameState.getPlayer();
    const storyCfg = state.config.combat.story || {};
    const perWorld = storyCfg.subLevelsPerWorld || 25;
    const eliteSubs = storyCfg.eliteSubLevels   || [10, 20];
    const bossSub   = storyCfg.bossSubLevel      || 25;

    // Progression actuelle
    const progress = player.story || { world: 1, subLevel: 0 };
    const { world } = progress;
    const completedSub = progress.subLevel;    // dernier sous-niveau COMPLÉTÉ dans ce monde
    const nextSub = completedSub + 1;          // prochain à jouer (ou 26 si monde fini, géré par _endBattle)
    const worldComplete = completedSub >= perWorld;

    // Bonus monde visible au joueur
    const worldBoost = (world - 1) * (storyCfg.worldStatBoost ?? 0.10);

    // Bouton de lancement en haut
    const team = WBGameState.getTeam();
    if (top) {
      if (team.length > 0 && !worldComplete) {
        const sub = nextSub;
        const isElite = eliteSubs.includes(sub);
        const isBoss  = sub === bossSub;
        const typeLabel = isBoss ? '💀 Alpha' : isElite ? '⚔ Béta' : '▶';
        top.innerHTML = `
          <button class="btn-primary btn-launch-combat story-launch-btn ${isBoss ? 'story-boss-btn' : isElite ? 'story-elite-btn' : ''}"
                  id="btn-launch" style="width:100%;margin-bottom:8px">
            ${typeLabel} Lancer Profondeur -${world} — Cavité ${sub}
          </button>
        `;
        document.getElementById('btn-launch')?.addEventListener('click', () =>
          _launchCombat({ mode: 'story', storyWorld: world, storySubLevel: sub })
        );
      } else {
        top.innerHTML = worldComplete
          ? `<p class="combat-mode-note">🎉 Profondeur -${world} accomplie ! La prochaine s'ouvre devant toi…</p>`
          : '';
      }
    }

    const rewardElite = storyCfg.rewardEliteGold    ?? 100;
    const rewardBoss  = storyCfg.rewardBossDiamonds ?? 100;

    // Grille des 25 épreuves de la profondeur courante
    const cells = Array.from({ length: perWorld }, (_, i) => {
      const sub = i + 1;
      const done   = sub <= completedSub;
      const active = sub === nextSub && !worldComplete;
      const isElite = eliteSubs.includes(sub);
      const isBoss  = sub === bossSub;

      let cls  = 'story-sub-cell';
      let label = '';
      if (isBoss)  { cls += ' story-boss-cell';  label = '💀 BOSS'; }
      else if (isElite) { cls += ' story-elite-cell'; label = '⚔ ÉLITE'; }
      if (done)   cls += ' story-done';
      if (active) cls += ' story-active';
      if (!done && !active) cls += ' story-locked';

      const rewardBadge = isBoss
        ? `<div class="story-sub-reward story-sub-reward-boss">+${rewardBoss} 💧</div>`
        : isElite
          ? `<div class="story-sub-reward story-sub-reward-elite">+${rewardElite} 💵</div>`
          : '';

      return `
        <div class="${cls}" title="Profondeur -${world} — Cavité ${sub}${isElite ? ` (+${rewardElite} 💵)` : ''}${isBoss ? ` (+${rewardBoss} 💧)` : ''}">
          <div class="story-sub-number">${world}-${sub}</div>
          ${label ? `<div class="story-sub-badge">${label}</div>` : ''}
          ${rewardBadge}
          ${done ? '<div class="story-sub-done">✓</div>' : ''}
        </div>
      `;
    }).join('');

    content.innerHTML = `
      <div class="story-header">
        <div class="story-world-title">🌸 Profondeur -${world}</div>
        ${worldBoost > 0 ? `<div class="story-world-bonus">+${Math.round(worldBoost * 100)}% stats ennemies</div>` : ''}
        <div class="story-progress-bar-wrap">
          <div class="story-progress-bar" style="width:${Math.min(100, (completedSub / perWorld) * 100)}%"></div>
        </div>
        <div class="story-progress-label">${completedSub} / ${perWorld} Cavités</div>
      </div>
      <div class="story-sub-grid">${cells}</div>
    `;
  }

  function renderCombatByLine() {
    const top     = document.getElementById('combat-mode-content-top');
    const content = document.getElementById('combat-mode-content');
    if (!content) return;
    const state   = WBGameState.get();
    const team    = WBGameState.getTeam();
    const catalogue = state.player.catalogue || {};

    // Bouton en haut
    if (top) {
      top.innerHTML = _selectedLine && team.length > 0
        ? `<button class="btn-primary btn-launch-combat" id="btn-launch-line" style="width:100%;margin-bottom:8px">⚔ Affronter cette lignée</button>`
        : '';
      document.getElementById('btn-launch-line')?.addEventListener('click', () => _launchCombat({ mode: 'line', lineId: _selectedLine }));
    }

    // Regrouper par lignée, récupérer la forme de base (stade 0)
    const lines = {};
    state.characters.forEach(c => {
      if (!lines[c.evolutionLine]) lines[c.evolutionLine] = [];
      lines[c.evolutionLine].push(c);
    });

    // Construire les entrées : disponibles (admin ON + catalogue débloqué) et verrouillées (admin ON + pas encore vu)
    // Les lignées désactivées en admin (availableInLineCombat === false) sont complètement masquées.
    const lineEntries = Object.entries(lines)
      .map(([lineId, chars]) => {
        const sorted   = chars.slice().sort((a, b) => a.evolutionStage - b.evolutionStage);
        const baseForm = sorted[0];
        return { lineId, baseForm };
      })
      .filter(({ baseForm }) => baseForm.availableInLineCombat !== false)  // masquer si désactivé en admin
      .map(({ lineId, baseForm }) => ({
        lineId,
        baseForm,
        unlocked: !!catalogue[baseForm.id],   // débloqué = forme de base présente dans le catalogue
      }))
      .sort((a, b) => {
        // Débloquées en premier, puis par nom
        if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
        return a.baseForm.name.localeCompare(b.baseForm.name);
      });

    const unlockedCount = lineEntries.filter(e => e.unlocked).length;
    const totalCount    = lineEntries.length;

    content.innerHTML = `
      <h3 class="combat-line-title">Choisissez une lignée à affronter</h3>
      <p class="combat-line-subtitle">
        ${unlockedCount}/${totalCount} lignée${unlockedCount > 1 ? 's' : ''} débloquée${unlockedCount > 1 ? 's' : ''}
        — Débloquez une forme de base dans le Catalogue pour affronter sa lignée.
      </p>
      <div class="evo-line-grid">
        ${lineEntries.map(({ lineId, baseForm, unlocked }) => {
          const t1        = state.types.find(t => t.id === baseForm.type1);
          const rarityDef = WBGameDatabase.RARITIES[baseForm.rarity] || {};
          if (unlocked) {
            return `
            <div class="evo-line-card ${_selectedLine === lineId ? 'selected' : ''}" data-line="${lineId}" title="Affronter la lignée de ${baseForm.name}">
              <div class="evo-line-portrait">
                ${baseForm.portrait ? `<img src="${baseForm.portrait}" alt="${baseForm.name}">` : `<span>${baseForm.name.charAt(0)}</span>`}
              </div>
              <div class="evo-line-name" style="color:${rarityDef.color}">${baseForm.name}</div>
              <div class="evo-line-meta">
                ${t1 ? `<span class="type-badge" style="background:${t1.color}">${t1.icon} ${t1.name}</span>` : ''}
              </div>
            </div>`;
          } else {
            // Verrouillée : portrait flouté, cadenas, pas cliquable
            return `
            <div class="evo-line-card locked" title="Débloquée en obtenant ${baseForm.name} via le Gacha ou un combat">
              <div class="evo-line-portrait locked-portrait">
                ${baseForm.portrait
                  ? `<img src="${baseForm.portrait}" alt="???" style="filter:blur(6px) brightness(0.4)">`
                  : `<span style="opacity:0.2">${baseForm.name.charAt(0)}</span>`}
                <div class="lock-overlay">🔒</div>
              </div>
              <div class="evo-line-name" style="color:#666">???</div>
              <div class="evo-line-meta">
                <span class="evo-line-count" style="color:#555">Non débloquée</span>
              </div>
            </div>`;
          }
        }).join('')}
      </div>
      ${_selectedLine && team.length > 0 ? `` : ''}
    `;

    // Seules les cartes débloquées sont cliquables
    content.querySelectorAll('.evo-line-card:not(.locked)').forEach(card => {
      card.addEventListener('click', () => {
        _selectedLine = card.dataset.line;
        renderCombatByLine();
      });
    });
  }

  function _launchCombat(options) {
    const battleArea = document.getElementById('battle-area');
    const lobby = document.querySelector('.combat-lobby');
    if (!battleArea || !lobby) return;

    _battle = WBCombatEngine.start(_onBattleEvent, options);
    if (!_battle) {
      // L'erreur a déjà été émise via _onBattleEvent, mais on double sécurise
      const player = WBGameState.getPlayer();
      const cfg = WBGameState.getConfig();
      const energyCost = cfg.energy.costs?.[options.mode] ?? cfg.energy.combatCost;
      if (options.mode !== 'fullRandom' && player.team.length === 0) {
        _showToast("Composez d'abord votre équipe !", 'error');
      } else if (cfg.energy.enabled && player.energy.current < energyCost) {
        _showToast("Énergie insuffisante !", 'error');
      }
      return;
    }

    document.body.classList.add('battle-active');
    lobby.style.display = 'none';
    battleArea.style.display = 'block';

    // Pendant le combat : masquer les onglets de mode (Expédition/Élevage/Battue/Territoire/...)
    // et le menu de navigation du bas, pour ne pas pouvoir quitter le combat.
    const tabsEl = document.querySelector('.combat-mode-tabs');
    if (tabsEl) tabsEl.style.display = 'none';
    const eventBannerEl = document.querySelector('.event-combat-banner');
    if (eventBannerEl) eventBannerEl.style.display = 'none';
    const navEl = document.getElementById('main-nav');
    if (navEl) navEl.style.display = 'none';
    document.getElementById('plus-menu')?.classList.remove('open');

    WBAudioSystem.playCombat();
    _renderBattle();
  }

  /** Met à jour le score/tour affichés en direct pendant un run Trophée */
  function _updateTrophyScoreHud() {
    if (!_battle || _battle.mode !== 'trophy') return;
    const scoreEl = document.getElementById('trophy-hud-score-value');
    const roundEl = document.getElementById('trophy-hud-round-value');
    if (scoreEl) scoreEl.textContent = (_battle.trophyScore || 0).toLocaleString('fr-FR');
    if (roundEl) roundEl.textContent = _battle.turn;
  }

  function _renderBattle() {
    const area = document.getElementById('battle-area');
    if (!area || !_battle) return;

    const b = _battle;
    const trophyCfg = WBGameState.getConfig().combat.trophy || {};
    area.innerHTML = `
      ${b.mode === 'trophy' ? `
        <div class="trophy-hud" id="trophy-hud">
          <span class="trophy-hud-score">🎯 Score : <strong id="trophy-hud-score-value">${(b.trophyScore || 0).toLocaleString('fr-FR')}</strong></span>
          <span class="trophy-hud-rounds">Tour <strong id="trophy-hud-round-value">${b.turn}</strong> / ${trophyCfg.rounds || 15}</span>
        </div>` : ''}
      <div class="battle-scene">
        <div class="battle-side battle-enemy">
          <h3>Ennemis</h3>
          <div class="battle-fighters" id="enemy-fighters">
            ${b.enemyTeam.map((e, i) => _renderFighter(e, i)).join('')}
          </div>
        </div>
        <div class="battle-vs">⚔</div>
        <div class="battle-side battle-player">
          <h3>Votre équipe</h3>
          <div class="battle-fighters" id="player-fighters">
            ${b.playerTeam.map((p, i) => _renderFighter(p, i)).join('')}
          </div>
        </div>
      </div>
      <div class="turn-order-bar" id="turn-order-bar"></div>
      <div class="battle-controls" id="battle-controls">
        <div class="battle-actions" id="battle-actions"></div>
      </div>
      <div class="battle-log" id="battle-log"></div>
    `;

    // Clic sur une carte de combattant (alliée ou ennemie) → ouvre sa fiche
    // détaillée complète. Délégation sur le conteneur : reste valide même si
    // les cartes ne sont jamais reconstruites pendant le combat.
    area.onclick = (e) => {
      const card = e.target.closest('.fighter-card');
      if (card) _openCombatantDetail(card.id.replace('fighter-', ''));
    };

    _renderTurnOrderBar();
    _renderBattleControls();
  }

  /**
   * Affiche la frise de l'ordre d'action de la manche en cours (vitesse décroissante),
   * avec l'acteur actif mis en évidence — alliés et ennemis confondus.
   */
  function _renderTurnOrderBar() {
    const bar = document.getElementById('turn-order-bar');
    if (!bar || !_battle) return;

    const upcoming = _battle.turnOrder.slice(_battle.turnIndex, _battle.turnIndex + 8);
    if (upcoming.length === 0) { bar.innerHTML = ''; return; }

    bar.innerHTML = `
      <span class="turn-order-label">Ordre :</span>
      <div class="turn-order-chips">
        ${upcoming.map((entry, i) => {
          const team = entry.isEnemy ? _battle.enemyTeam : _battle.playerTeam;
          const c = team.find(x => x.instanceId === entry.instanceId);
          if (!c) return '';
          return `<div class="turn-chip ${i === 0 ? 'active' : ''} ${entry.isEnemy ? 'is-enemy' : 'is-ally'}" title="${c.name}">
            ${c.portrait ? `<img src="${c.portrait}" alt="${c.name}">` : c.name.charAt(0)}
          </div>`;
        }).join('')}
      </div>
    `;
  }

  function _renderFighter(combatant, index = 0) {
    const hpPct = Math.round((combatant.currentHp / combatant.maxHp) * 100);
    const hpColor = hpPct > 60 ? '#4ade80' : hpPct > 25 ? '#facc15' : '#f87171';
    const state = WBGameState.get();
    const t1 = state.types.find(t => t.id === combatant.type1);
    const t2 = combatant.type2 ? state.types.find(t => t.id === combatant.type2) : null;
    const maxAwk = state.config.awakening.maxLevel;
    const isAwkMax = (combatant.awakening || 0) >= maxAwk;
    return `
    <div class="fighter-card rarity-${combatant.rarity} ${combatant.alive ? '' : 'defeated'}" id="fighter-${combatant.instanceId}" style="--enter-delay:${index * 80}ms">
      <div class="fighter-portrait ${isAwkMax ? 'awakening-max' : ''}" style="--breathe-delay:${(index % 4) * 420}ms">
        ${_combatPortraitImgHtml(WBGameState.getCharDef(combatant.charId) || combatant)}
      </div>
      <div class="status-icons" id="status-icons-${combatant.instanceId}">${_renderStatusIcons(combatant)}</div>
      <div class="fighter-types">
        ${t1 ? `<span class="type-chip" style="background:${t1.color}" title="${t1.name}">${t1.icon}</span>` : ''}
        ${t2 ? `<span class="type-chip" style="background:${t2.color}" title="${t2.name}">${t2.icon}</span>` : ''}
      </div>
      <div class="fighter-info">
        <div class="fighter-name">${combatant.name} <small>Niv.${combatant.level}</small></div>
        <div class="hp-bar">
          <div class="hp-bar-fill" style="width:${hpPct}%;background:${hpColor}"></div>
        </div>
        <div class="hp-text">${combatant.alive ? `${combatant.currentHp} / ${combatant.maxHp}` : 'KO'}</div>
      </div>
    </div>`;
  }

  /**
   * Génère les icônes d'altérations persistantes pour un combattant.
   * Affiche une icône par altération active, chacune avec un tooltip.
   * Les buff temporaires (Atk Up) ont une couleur verte, les debuffs une couleur rouge/orange.
   */
  function _renderStatusIcons(combatant) {
    const icons = [];

    // Altérations d'état (statusEffects)
    const STATUS_META = {
      poison:    { icon: '☠', label: 'Poison',     color: '#a855f7', pulse: false },
      paralysis: { icon: '⚡', label: 'Paralysie',  color: '#facc15', pulse: true  },
      charm:     { icon: '💞', label: 'Charme',     color: '#f472b6', pulse: false },
    };
    (combatant.statusEffects || []).forEach(s => {
      const meta = STATUS_META[s.type];
      if (!meta) return;
      const turns = s.turnsLeft != null ? ` (${s.turnsLeft}t)` : '';
      icons.push(`<span class="status-icon ${meta.pulse ? 'status-pulse' : ''}"
        style="background:${meta.color}" title="${meta.label}${turns}">${meta.icon}</span>`);
    });

    // Buff ATK temporaire (Ardente)
    if ((combatant.tempAtkBuffPercent || 0) > 0) {
      icons.push(`<span class="status-icon status-buff" title="Puissance Up +${combatant.tempAtkBuffPercent}%">✨↑</span>`);
    }

    return icons.join('');
  }

  function _renderBattleControls() {
    const actionsEl = document.getElementById('battle-actions');
    if (!actionsEl || !_battle) return;

    _highlightActiveFighter();

    if (_battle.phase === 'end') return;

    const state  = WBGameState.get();
    const typeOf = (id) => state.types.find(t => t.id === id);

    if (_battle.phase === 'enemy') {
      const enemy = _battle.enemyTeam.find(c => c.instanceId === _battle.currentActor);
      actionsEl.innerHTML = `<p class="turn-waiting">👹 ${enemy ? enemy.name : "L'ennemi"} agit...</p>`;
      return;
    }

    // phase === 'player' : c'est au tour du personnage allié _battle.currentActor
    const actor = _battle.playerTeam.find(c => c.instanceId === _battle.currentActor && c.alive);
    const enemies = _battle.enemyTeam.filter(c => c.alive);

    if (!actor) {
      actionsEl.innerHTML = '';
      return;
    }

    const t1 = typeOf(actor.type1);

    actionsEl.innerHTML = `
      <p class="turn-actor">${t1 ? t1.icon : ''} C'est le tour de <strong>${actor.name}</strong> !</p>
      <div class="target-select">
        <label>Cible :</label>
        <div class="fighter-btns">
          ${enemies.map(e => {
            let multBadge = '';
            // Utiliser getBestTypeEffectiveness — identique à l'engine
            const mult = WBGameDatabase.getBestTypeEffectiveness(actor.type1, actor.type2, e.type1, e.type2, state.typeMatrix);
            if (mult !== 1) {
              const cls = mult >= 2 ? 'mult-super' : mult === 0 ? 'mult-immune' : mult <= 0.5 ? 'mult-low' : 'mult-mid';
              multBadge = `<span class="target-mult ${cls}">×${_formatMult(mult)}</span>`;
            }
            return `<button class="btn-target" data-iid="${e.instanceId}">${e.name} (${e.currentHp}💗)${multBadge}</button>`;
          }).join('')}
        </div>
      </div>
    `;

    actionsEl.querySelectorAll('.btn-target').forEach(btn => {
      btn.addEventListener('click', () => {
        if (_combatAnimBusy) return; // bloquer si animation en cours
        actionsEl.querySelectorAll('.btn-target').forEach(b => b.disabled = true);
        WBCombatEngine.playerAttack(actor.instanceId, btn.dataset.iid);
      });
    });
  }

  /** Met en évidence la carte du combattant dont c'est actuellement le tour */
  function _highlightActiveFighter() {
    if (!_battle) return;
    document.querySelectorAll('.fighter-card.active-turn').forEach(el => el.classList.remove('active-turn'));
    if (_battle.phase === 'player' || _battle.phase === 'enemy') {
      const card = document.getElementById(`fighter-${_battle.currentActor}`);
      card?.classList.add('active-turn');
    }
  }

  function _onBattleEvent(event, data) {
    _battle = WBCombatEngine.getBattle();
    const log = document.getElementById('battle-log');

    if (['playerAttack', 'enemyAttack'].includes(event)) {
      _renderTurnOrderBar();
      _highlightActiveFighter();
      if (log && _battle?.log?.length) {
        log.innerHTML = [..._battle.log].reverse().slice(0, 8).map(l => `<div class="log-line">${l}</div>`).join('');
      }
      // Capture SYNCHRONE du PV de l'attaquant ET de la cible maintenant (avant
      // mise en file) : si une Contre-Attaque touche l'attaquant juste après
      // (résolue immédiatement côté moteur), ou si le coup est esquivé (pas de
      // hpAfter fourni dans ce cas), on ne veut pas que le rafraîchissement de
      // la carte, plus tard dans l'animation, affiche par erreur un PV déjà
      // périmé par une action ultérieure.
      const attackerHpSnapshot = data.attacker.currentHp;
      const targetHpSnapshot   = data.target.currentHp;
      // Passer l'animation par la queue pour qu'elle attende la précédente
      _queueCombatAnim(() => _playAttackAnimation(data.attacker, data.target, data.result, attackerHpSnapshot, targetHpSnapshot));
    }

    if (event === 'playerTurn') {
      _renderTurnOrderBar();
      _renderBattleControls();
    }

    if (event === 'victory') {
      _resetCombatAnimQueue();
      if (_tutorialCombatEndCb) {
        const cb = _tutorialCombatEndCb;
        _tutorialCombatEndCb = null;
        _combatInProgress = false;
        cb('victory');
      } else {
        // Mode histoire : marquer le stage complété
        if (_storyPendingStage) {
          const { ci, stage, onDone } = _storyPendingStage;
          _storyPendingStage = null;
          WBGameState.completeStoryStage(ci, stage);
          onDone?.();
          // Afficher dialogue post si stage narratif avec text2
          const ch  = WBGameState.get().config.storyMode?.chapters?.[ci];
          const dlg = ch?.dialogues?.[stage];
          if (dlg?.text2) {
            _playLevelUpAnimations(data.rewards?.levelUps);
            _showBattleResult('victory', data);
            // Après retour au lobby → dialogue post
            _storyPostDialogue = { ci, stage, dlg };
          } else {
            _playLevelUpAnimations(data.rewards?.levelUps);
            _showBattleResult('victory', data);
          }
        } else {
          _playLevelUpAnimations(data.rewards?.levelUps);
          _showBattleResult('victory', data);
        }
      }
    }
    if (event === 'defeat') {
      _resetCombatAnimQueue();
      if (_tutorialCombatEndCb) {
        const cb = _tutorialCombatEndCb;
        _tutorialCombatEndCb = null;
        _combatInProgress = false;
        cb('defeat');
      } else {
        _showBattleResult('defeat', data);
      }
    }

    if (event === 'trophyEnd') {
      _resetCombatAnimQueue();
      _showTrophyResult(data);
    }

    if (event === 'trophyEnemyReplaced') {
      _queueCombatAnim(() => {
        const card = document.getElementById(`fighter-${data.oldInstanceId}`);
        if (card) {
          const idx = _battle.enemyTeam.findIndex(e => e.instanceId === data.newCombatant.instanceId);
          card.outerHTML = _renderFighter(data.newCombatant, idx);
        }
        _combatAnimDone();
      });
    }

    if (event === 'error') {
      _showToast(data.message, 'error');
    }

    if (event === 'passiveTriggered') {
      _queueCombatAnim(() => _onPassiveTriggered(data));
    }
    if (event === 'statusTriggered') {
      _queueCombatAnim(() => _onStatusTriggered(data));
    }
  }

  /**
   * Réagit au déclenchement d'un passif en combat.
   * Sons : réutilise les bruitages existants (pas de son dédié par passif).
   * Chiffres flottants colorés pour tout changement de PV (dégâts ou soins).
   */
  function _onPassiveTriggered(data) {
    const state = WBGameState.get();
    const passive = state.passives.find(p => p.id === data.passiveId);
    const effectType = passive?.effectType;
    const sourceCard = document.getElementById(`fighter-${data.combatantId}`);

    // ── Capture SYNCHRONE de tout ce dont l'affichage différé aura besoin ──────
    // Important : on lit l'état "en direct" ICI, tout de suite (avant qu'aucun
    // autre tour n'ait pu s'exécuter), jamais depuis l'intérieur d'un setTimeout.
    // Comme le moteur peut déjà avoir résolu les tours suivants pendant qu'on
    // attend pour l'affichage, relire l'état "en direct" plus tard montrerait
    // un PV/statut déjà périmé (celui d'un tour ultérieur). On fige donc ici
    // exactement ce qu'il faut montrer, et on se contente de l'injecter tel
    // quel dans le DOM au bon moment (cf. onFxStart / onImpact ci-dessous).
    //
    // Nouvel enchaînement (identique pour tous les passifs à PV) :
    //   1) la bannière (nom du passif) apparaît seule
    //   2) ~1s avant qu'elle reparte : onFxStart() joue l'animation du passif
    //   3) au moment exact où ce FX se termine : onImpact() fait apparaître les
    //      chiffres de dégâts/soin ET met à jour la barre de vie, ensemble.
    let onFxStart = null;
    let onImpact  = null;
    let onRetreat = null;

    if (effectType === 'end_turn_aoe_damage') {
      const targetIds = data.extra?.targetIds || [];
      const damageMap = data.extra?.damageMap || {};
      const hpSnapshot = {};
      targetIds.forEach(id => { const c = _findCombatantById(id); if (c) hpSnapshot[id] = c.currentHp; });

      onFxStart = () => {
        targetIds.forEach(id => _spawnPassiveFx(document.getElementById(`fighter-${id}`), 'wave'));
        WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.hitNormal);
      };
      onImpact = () => {
        targetIds.forEach(id => {
          const targetCard = document.getElementById(`fighter-${id}`);
          const dmg = damageMap[id];
          if (dmg != null) { _spawnImpactGlow(targetCard, 'dmg'); _spawnFloatText(targetCard, `-${dmg}`, 'float-passive-dmg', 0, true); }
          const c = _findCombatantById(id);
          if (!c || hpSnapshot[id] === undefined) return;
          const saved = c.currentHp;
          c.currentHp = hpSnapshot[id];
          _updateFighterCard(c);
          c.currentHp = saved; // restaurer pour les calculs suivants du moteur
        });
        _renderTurnOrderBar();
        if (_battle?.mode === 'trophy') _updateTrophyScoreHud();
      };

    } else if (effectType === 'end_turn_heal_lowest_ally') {
      const healedId = data.extra?.healedId;
      const hpAfter  = data.extra?.hpAfter;
      const amount   = data.extra?.amount;

      onFxStart = () => {
        _spawnPassiveFx(document.getElementById(`fighter-${healedId}`), 'heal');
        WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.levelUp);
      };
      onImpact = () => {
        const healedCard = document.getElementById(`fighter-${healedId}`);
        if (amount != null) { _spawnImpactGlow(healedCard, 'heal'); _spawnFloatText(healedCard, `+${amount}`, 'float-passive-heal', 0, true); }
        const healed = _findCombatantById(healedId);
        if (healed && hpAfter !== undefined) {
          const saved = healed.currentHp;
          healed.currentHp = hpAfter;
          _updateFighterCard(healed);
          healed.currentHp = saved;
        } else if (healed) {
          _updateFighterCard(healed);
        }
        _renderTurnOrderBar();
      };

    } else if (effectType === 'buff_ally_atk_once') {
      const buffedId = data.extra?.buffedId;
      const buffedIconsHtml = (() => {
        const c = _findCombatantById(buffedId);
        return c ? _renderStatusIcons(c) : null;
      })();
      onFxStart = () => {
        _spawnPassiveFx(document.getElementById(`fighter-${buffedId}`), 'buff');
        WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.gachaPull);
      };
      onImpact = () => {
        if (buffedIconsHtml === null) return;
        const ic = document.getElementById(`status-icons-${buffedId}`);
        if (ic) ic.innerHTML = buffedIconsHtml;
      };

    } else if (effectType === 'pre_attack_cleanse_self') {
      const srcId = data.combatantId;
      const srcIconsHtml = (() => {
        const c = _findCombatantById(srcId);
        return c ? _renderStatusIcons(c) : null;
      })();
      onFxStart = () => {
        _spawnPassiveFx(sourceCard, 'cleanse');
        WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.hitResist);
      };
      onImpact = () => {
        if (srcIconsHtml === null) return;
        const ic = document.getElementById(`status-icons-${srcId}`);
        if (ic) ic.innerHTML = srcIconsHtml;
      };

    } else if (effectType === 'on_damaged_counter') {
      // Contre-Attaque : riposte rapide — mini-bannière courte au-dessus du portrait
      // plutôt que la grande bannière centrale. Même principe que les autres : le
      // flash (FX) se joue d'abord, PUIS chiffre de dégâts + PV ensemble à la fin.
      const targetId = data.extra?.targetId;
      const dmg = data.extra?.damage;
      WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.hitWeak);

      _spawnPassiveFx(sourceCard, 'counter');
      const log = document.getElementById('battle-log');
      if (log && _battle?.log?.length) {
        log.innerHTML = [..._battle.log].reverse().slice(0, 8).map(l => `<div class="log-line">${l}</div>`).join('');
      }
      // Mini-bannière rapide positionnée sur le riposteur
      const srcPortrait2 = sourceCard?.querySelector('.fighter-portrait');
      if (srcPortrait2) {
        const r = srcPortrait2.getBoundingClientRect();
        const miniB = document.createElement('div');
        miniB.style.cssText = `
          position:fixed; left:${r.left + r.width/2}px; top:${r.top - 36}px;
          transform:translateX(-50%) scale(.85);
          z-index:9998; pointer-events:none;
          background:linear-gradient(90deg,rgba(244,63,94,.2),rgba(244,63,94,.4),rgba(244,63,94,.2));
          border:1px solid rgba(244,63,94,.8); border-radius:16px;
          padding:5px 14px; font-family:var(--font-display); font-size:.82rem;
          font-weight:800; color:#fff; white-space:nowrap;
          text-shadow:0 0 12px rgba(244,63,94,1);
          opacity:0; transition:opacity 150ms ease;
        `;
        miniB.textContent = '⚡ Contre-Attaque !';
        document.body.appendChild(miniB);
        requestAnimationFrame(() => requestAnimationFrame(() => { miniB.style.opacity = '1'; }));
        setTimeout(() => { miniB.style.opacity = '0'; setTimeout(() => miniB.remove(), 200); }, 700);
      }
      // Snapshot du PV cible (déjà appliqué par le moteur)
      const hpAfterCounter = (() => { const c = _findCombatantById(targetId); return c ? c.currentHp : undefined; })();
      // Le flash + mini-bannière durent ~900ms : chiffre de dégâts ET PV
      // apparaissent ENSEMBLE juste après, pas avant.
      setTimeout(() => {
        const targetCard = document.getElementById(`fighter-${targetId}`);
        if (dmg != null && targetCard) _spawnFloatText(targetCard, `-${dmg}`, 'float-passive-dmg', 0, true);
        const c = _findCombatantById(targetId);
        if (c && hpAfterCounter !== undefined) {
          const saved = c.currentHp;
          c.currentHp = hpAfterCounter;
          _updateFighterCard(c);
          c.currentHp = saved;
        } else if (c) {
          _updateFighterCard(c);
        }
        _renderTurnOrderBar();
        _combatAnimDone();
      }, 900);
      return; // ce cas gère sa propre file, pas de bannière centrale

    } else if (effectType === 'random_passive_steal') {
      onFxStart = () => {
        _spawnPassiveFx(sourceCard, 'steal');
        WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.evolution);
      };
      // La bannière Mystère affiche le passif Mystère puis swape vers le passif copié —
      // aucun PV/statut à afficher pour ce déclenchement précis (le passif copié
      // s'affichera correctement de lui-même à son propre déclenchement futur).

    } else if (effectType === 'stat_boost_evasion') {
      onFxStart = () => {
        _spawnPassiveFx(sourceCard, 'adorable');
        WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.hitResist);
      };

    } else if (effectType === 'on_damaged_reduce_dmg') {
      onFxStart = () => {
        _spawnPassiveFx(sourceCard, 'adorable');
        WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.hitResist);
      };

    } else if (effectType === 'stat_boost_crit_damage') {
      onFxStart = () => {
        _spawnPassiveFx(sourceCard, 'scenique');
        WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.hitWeak);
      };

    } else if (['on_hit_paralyze', 'on_hit_poison', 'on_hit_charm'].includes(effectType)) {
      const statusVariant = effectType === 'on_hit_paralyze' ? 'paralysis'
                          : effectType === 'on_hit_poison'   ? 'poison'
                          :                                    'charm';
      const targetId = data.extra?.targetId;
      const targetIconsHtml = (() => {
        const c = _findCombatantById(targetId);
        return c ? _renderStatusIcons(c) : null;
      })();
      onFxStart = () => {
        _spawnPassiveFx(document.getElementById(`fighter-${targetId}`), statusVariant);
        WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.hitWeak);
      };
      onImpact = () => {
        if (targetIconsHtml === null) return;
        const ic = document.getElementById(`status-icons-${targetId}`);
        if (ic) ic.innerHTML = targetIconsHtml;
      };
    }

    // La grande bannière centrale dure ~2.46s : elle apparaît seule, puis
    // onFxStart() joue le FX ~1s avant qu'elle reparte, puis onImpact() (chiffres
    // + PV, ensemble) juste à la fin de ce FX. onRetreat (icônes de statut restant
    // à appliquer, s'il y en a) suit la disparition complète de la bannière.
    _spawnPassiveBanner(sourceCard, data.passiveName, data.extra?.copiedPassiveName || null, { onFxStart, onImpact, onRetreat });
  }
  /** Réagit à un effet de statut qui tique tout seul (poison) ou bloque un tour (paralysie/charme) */
  function _onStatusTriggered(data) {
    const card = document.getElementById(`fighter-${data.combatantId}`);
    if (!card) { _combatAnimDone(); return; }

    const combatant = _findCombatantById(data.combatantId);

    if (data.statusType === 'poison') {
      // Tick de poison : petite animation sur la victime, SANS portrait au centre
      const portrait = card.querySelector('.fighter-portrait');
      // Chiffre flottant
      if (data.amount != null) _spawnFloatText(card, `-${data.amount}`, 'float-passive-poison', 0, true);
      if (_battle?.mode === 'trophy') _updateTrophyScoreHud();
      WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.hitNormal);
      // Petite animation poison sur la carte (teinte violette pulsante)
      if (portrait) {
        portrait.classList.add('poison-tick-flash');
        setTimeout(() => portrait.classList.remove('poison-tick-flash'), 600);
      }
      // Chiffre flottant dans le log
      const log = document.getElementById('battle-log');
      if (log && _battle?.log?.length) {
        log.innerHTML = [..._battle.log].reverse().slice(0, 8).map(l => `<div class="log-line">${l}</div>`).join('');
      }
      // HP mis à jour avec snapshot hpAfter quand le chiffre est visible (~150ms)
      setTimeout(() => {
        if (combatant) {
          if (data.hpAfter !== undefined) {
            const saved = combatant.currentHp;
            combatant.currentHp = data.hpAfter;
            _updateFighterCard(combatant);
            combatant.currentHp = saved;
          } else {
            _updateFighterCard(combatant);
          }
        }
        _renderTurnOrderBar();
      }, 150);
      // Libérer la queue après la petite animation (800ms total, bien plus court qu'une bannière)
      setTimeout(_combatAnimDone, 624);

    } else if (data.statusType === 'paralysis') {
      // Icônes figées maintenant (le statut est déjà consommé côté moteur)
      const iconsHtml = combatant ? _renderStatusIcons(combatant) : null;
      _spawnPassiveBanner(card, 'Paralysé(e) !', null, {
        onFxStart: () => _spawnPassiveFx(card, 'paralysis'),
        onRetreat: () => {
          if (iconsHtml === null) return;
          const ic = document.getElementById(`status-icons-${data.combatantId}`);
          if (ic) ic.innerHTML = iconsHtml;
        },
      });

    } else if (data.statusType === 'charm') {
      const iconsHtml = combatant ? _renderStatusIcons(combatant) : null;
      _spawnPassiveBanner(card, 'Charmé(e) !', null, {
        onFxStart: () => _spawnPassiveFx(card, 'charm'),
        onRetreat: () => {
          if (iconsHtml === null) return;
          const ic = document.getElementById(`status-icons-${data.combatantId}`);
          if (ic) ic.innerHTML = iconsHtml;
        },
      });

    } else {
      if (combatant) _updateFighterCard(combatant);
      _combatAnimDone();
    }
  }
  /** Cherche un combattant (joueur ou ennemi) par son instanceId dans le combat en cours */
  function _findCombatantById(instanceId) {
    if (!_battle || !instanceId) return null;
    return [..._battle.playerTeam, ..._battle.enemyTeam].find(c => c.instanceId === instanceId) || null;
  }

  /** Fait apparaître une bannière flottante avec le nom du passif au-dessus du portrait */
  /**
   * Affiche le déclenchement d'un passif : un petit repère sur le portrait
   * concerné (qui a activé le passif) ET une grande bannière centrale, bien
   * plus visible, mise en file pour ne jamais se superposer à une autre.
   */
  /**
   * @param {HTMLElement} card - carte du combattant source du passif
   * @param {string} text - nom du passif affiché dans la bannière
   * @param {string} [secondaryText] - nom du passif copié (Mystère), affiché en swap
   * @param {object} [opts]
   * @param {Function} [opts.onRetreat] - callback exécuté 1s APRÈS que la bannière ait
   *        totalement disparu, juste avant de libérer la file d'animation. C'est ici
   *        (et seulement ici) que les changements de PV/icônes de statut liés à ce
   *        passif doivent être appliqués, pour ne jamais les montrer en même temps que
   *        le nom du passif à l'écran.
   */
  /**
   * Affiche la grande bannière centrale d'un passif, avec le nouvel enchaînement
   * demandé :
   *   1) La bannière (nom du passif) apparaît SEULE.
   *   2) ~1s avant qu'elle ne commence à disparaître : opts.onFxStart() — c'est
   *      là que l'animation visuelle propre au passif (vague, soin, etc.) doit
   *      se jouer (durée ~1000ms, cf. _spawnPassiveFx).
   *   3) Au moment exact où ce FX se termine (juste avant que la bannière parte) :
   *      opts.onImpact() — c'est là, et SEULEMENT là, qu'il faut faire apparaître
   *      les chiffres de dégâts/soin ET baisser/monter la barre de vie, les deux
   *      en même temps.
   * opts.onRetreat reste disponible pour les cas sans FX (icônes de statut...).
   */
  function _spawnPassiveBanner(card, text, secondaryText, opts = {}) {
    // Log mis à jour immédiatement
    const log = document.getElementById('battle-log');
    if (log && _battle?.log?.length) {
      log.innerHTML = [..._battle.log].reverse().slice(0, 8).map(l => `<div class="log-line">${l}</div>`).join('');
    }

    const srcPortrait = card?.querySelector('.fighter-portrait');
    if (!srcPortrait) {
      _queuePassiveBigBanner(text);
      // Même sans portrait à animer, on respecte le même enchaînement temporel
      setTimeout(() => {
        opts.onFxStart?.();
        setTimeout(() => {
          opts.onImpact?.();
          if (opts.onRetreat) { opts.onRetreat(); }
          _combatAnimDone();
        }, 1000);
      }, 500);
      return;
    }

    const srcRect = srcPortrait.getBoundingClientRect();
    const SCALE   = 2.8;
    const scaledW = srcRect.width  * SCALE;
    const scaledH = srcRect.height * SCALE;
    const centerX = window.innerWidth  / 2 - scaledW / 2;
    const centerY = window.innerHeight / 2 - scaledH / 2 - 40;
    const bannerTop = `${centerY + scaledH + 14}px`;

    const clone = srcPortrait.cloneNode(true);
    clone.classList.remove('lunge-up','lunge-down','fighter-breathe','hit-flash',
                           'shake-hit','shake-big','level-up-flash');
    clone.style.cssText = `
      position:fixed; left:${srcRect.left}px; top:${srcRect.top}px;
      width:${srcRect.width}px; height:${srcRect.height}px;
      z-index:9999; pointer-events:none; border-radius:50%;
      box-shadow:0 0 16px rgba(150,100,255,.4); transition:none;
    `;
    document.body.appendChild(clone);

    // Bannière principale (Mystère)
    const banner = document.createElement('div');
    banner.style.cssText = `
      position:fixed; left:50%; transform:translateX(-50%);
      top:${bannerTop}; z-index:10000; pointer-events:none;
      background:linear-gradient(90deg,rgba(150,100,255,.1),rgba(150,100,255,.3),rgba(150,100,255,.1));
      border:1px solid rgba(150,100,255,.6); border-radius:24px;
      padding:8px 24px; font-family:var(--font-display); font-size:1rem;
      font-weight:800; color:#fff; letter-spacing:.08em; white-space:nowrap;
      text-shadow:0 0 18px rgba(150,100,255,1); opacity:0; transition:opacity 280ms ease;
    `;
    banner.textContent = `✨ ${text}`;
    document.body.appendChild(banner);

    // Bannière secondaire (passif copié) — même position, style rose/or
    let banner2 = null;
    if (secondaryText) {
      banner2 = document.createElement('div');
      banner2.style.cssText = `
        position:fixed; left:50%; transform:translateX(-50%);
        top:${bannerTop}; z-index:10001; pointer-events:none;
        background:linear-gradient(90deg,rgba(244,63,94,.12),rgba(244,180,50,.25),rgba(244,63,94,.12));
        border:1px solid rgba(244,180,50,.8); border-radius:24px;
        padding:8px 24px; font-family:var(--font-display); font-size:1rem;
        font-weight:800; color:#fff; letter-spacing:.08em; white-space:nowrap;
        text-shadow:0 0 18px rgba(244,180,50,1); opacity:0; transition:opacity 280ms ease;
      `;
      banner2.textContent = `✦ Copie : ${secondaryText}`;
      document.body.appendChild(banner2);
    }

    srcPortrait.style.opacity = '0';

    // Phase 1 — portrait vers le centre ×2.8 (800ms)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      clone.style.transition = [
        'left 624ms cubic-bezier(.22,.68,0,1.25)',
        'top 624ms cubic-bezier(.22,.68,0,1.25)',
        'width 624ms cubic-bezier(.22,.68,0,1.25)',
        'height 624ms cubic-bezier(.22,.68,0,1.25)',
        'box-shadow 624ms ease',
      ].join(',');
      clone.style.left      = `${centerX}px`;
      clone.style.top       = `${centerY}px`;
      clone.style.width     = `${scaledW}px`;
      clone.style.height    = `${scaledH}px`;
      clone.style.boxShadow = '0 0 70px rgba(150,100,255,1), 0 0 130px rgba(240,60,90,.45)';
    }));

    // Phase 2 — bannière Mystère apparaît (900ms)
    setTimeout(() => { banner.style.opacity = '1'; }, 702);

    // Phase 2b — si passif copié : swap des bannières (1600ms)
    if (banner2) {
      setTimeout(() => {
        banner.style.opacity  = '0';  // Mystère disparaît
        banner2.style.opacity = '1';  // passif copié apparaît
      }, 1248);
    }

    // Phase 2c — ~1s avant que la bannière ne commence à repartir : lancement
    // du FX visuel propre au passif (dure ~1000ms, cf. _spawnPassiveFx), pour
    // qu'il se termine PILE au moment où la bannière part (phase 3, 1950ms).
    if (opts.onFxStart) setTimeout(() => opts.onFxStart(), 950);

    // Phase 3 — retour (600ms) à 2500ms
    setTimeout(() => {
      // Le FX vient de se terminer : c'est ICI, et seulement ici, qu'on fait
      // apparaître les chiffres de dégâts/soin ET qu'on met à jour la barre
      // de vie — les deux strictement en même temps.
      opts.onImpact?.();
      banner.style.opacity  = '0';
      if (banner2) banner2.style.opacity = '0';
      clone.style.transition = [
        'left 468ms cubic-bezier(.55,0,1,.45)',
        'top 468ms cubic-bezier(.55,0,1,.45)',
        'width 468ms ease',
        'height 468ms ease',
        'box-shadow 312ms ease',
      ].join(',');
      clone.style.left      = `${srcRect.left}px`;
      clone.style.top       = `${srcRect.top}px`;
      clone.style.width     = `${srcRect.width}px`;
      clone.style.height    = `${srcRect.height}px`;
      clone.style.boxShadow = 'none';
    }, 1950);

    // Phase 4 — nettoyage (~2.5s total)
    setTimeout(() => {
      clone.remove();
      banner.remove();
      banner2?.remove();
      srcPortrait.style.opacity = '';
      if (opts.onRetreat) {
        // La bannière a totalement disparu : on attend encore 1s avant d'appliquer
        // le changement de statut restant (icônes...), puis on libère la file.
        setTimeout(() => { opts.onRetreat(); _combatAnimDone(); }, 1000);
      } else {
        _combatAnimDone();
      }
    }, 2457);
  }

  let _passiveBigBannerQueue = [];
  let _passiveBigBannerBusy  = false;

  function _queuePassiveBigBanner(text) {
    _passiveBigBannerQueue.push(text);
    _runPassiveBigBannerQueue();
  }

  function _runPassiveBigBannerQueue() {
    if (_passiveBigBannerBusy || _passiveBigBannerQueue.length === 0) return;
    const scene = document.querySelector('.battle-scene');
    if (!scene) { _passiveBigBannerQueue = []; return; }

    _passiveBigBannerBusy = true;
    const text = _passiveBigBannerQueue.shift();

    const big = document.createElement('div');
    big.className = 'passive-banner-big';
    big.innerHTML = `<span class="passive-banner-big-icon">✨</span>${text}`;
    scene.appendChild(big);

    setTimeout(() => {
      big.remove();
      _passiveBigBannerBusy = false;
      _runPassiveBigBannerQueue();
    }, 1500);
  }

  /** Fait apparaître une petite animation visuelle adaptée à l'effet sur le portrait ciblé */
  function _spawnPassiveFx(card, variant) {
    const portrait = card?.querySelector('.fighter-portrait');
    if (!portrait) return;
    const fx = document.createElement('div');
    fx.className = `passive-fx passive-fx-${variant}`;
    portrait.appendChild(fx);
    setTimeout(() => fx.remove(), 1000);
  }

  /**
   * Joue l'animation complète d'une attaque : élan de l'attaquant vers la cible,
   * puis impact (flash, tremblement, nombres flottants) une fois le coup "porté".
   */
  function _playAttackAnimation(attacker, target, result, attackerHpSnapshot, targetHpSnapshot) {
    // Applique un PV figé (snapshot) à un combattant le temps de rafraîchir sa
    // carte, puis restaure sa valeur "live" pour les calculs suivants du moteur.
    const applySnapshotAndUpdate = (combatant, hpSnapshot) => {
      if (hpSnapshot !== undefined) {
        const saved = combatant.currentHp;
        combatant.currentHp = hpSnapshot;
        _updateFighterCard(combatant);
        combatant.currentHp = saved;
      } else {
        _updateFighterCard(combatant);
      }
    };
    // Le PV cible à afficher : hpAfter si le coup a touché, sinon le snapshot
    // pris avant l'attaque (cas d'une esquive, où hpAfter n'est pas fourni).
    const targetHpToShow = result.hpAfter !== undefined ? result.hpAfter : targetHpSnapshot;

    const attackerCard = document.getElementById(`fighter-${attacker.instanceId}`);
    const targetCard   = document.getElementById(`fighter-${target.instanceId}`);

    if (!attackerCard || !targetCard) {
      applySnapshotAndUpdate(target, targetHpToShow);
      _combatAnimDone(); return;
    }

    const srcPortrait = attackerCard.querySelector('.fighter-portrait');
    const tgtPortrait = targetCard.querySelector('.fighter-portrait');

    if (!srcPortrait) {
      _resolveImpact(targetCard, target, result);
      applySnapshotAndUpdate(target, targetHpToShow);
      _combatAnimDone(); return;
    }

    // Position de l'attaquant AVANT animation (sert au test de fiabilité ci-dessous)
    const srcRect = srcPortrait.getBoundingClientRect();

    if (srcRect.width === 0) {
      _resolveImpact(targetCard, target, result);
      applySnapshotAndUpdate(target, targetHpToShow);
      applySnapshotAndUpdate(attacker, attackerHpSnapshot);
      setTimeout(_combatAnimDone, 100); return;
    }

    // Stopper l'animation breathe pendant notre animation
    srcPortrait.style.animation = 'none';
    srcPortrait.style.transformOrigin = 'center center';
    srcPortrait.style.zIndex = '10';
    // Élever la CARTE entière pour que le portrait passe au-dessus des cartes voisines
    attackerCard.style.zIndex = '20';
    attackerCard.style.position = 'relative';

    // Phase 1 — zoom ×2 sur place (600ms)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      srcPortrait.style.transition = 'transform 468ms cubic-bezier(.22,.68,0,1.3), box-shadow 468ms ease';
      srcPortrait.style.transform  = 'scale(2)';
      srcPortrait.style.boxShadow  = '0 0 50px rgba(255,140,200,.9), 0 0 100px rgba(180,90,255,.5)';
    }));

    // Phase 2 — charge vers la cible (500ms)
    setTimeout(() => {
      // Recalcul de la position de la cible à l'instant T (et pas au tout début
      // de l'animation, ~500ms plus tôt) : si la mise en page a légèrement
      // bougé entre-temps (autre élément d'UI qui se met à jour, etc.), le
      // portrait vole vers la position réelle et actuelle de sa cible.
      const freshSrcRect = srcPortrait.getBoundingClientRect();
      const freshTgtRect = (tgtPortrait || targetCard).getBoundingClientRect();
      const dx = (freshTgtRect.left + freshTgtRect.width  / 2) - (freshSrcRect.left + freshSrcRect.width  / 2);
      const dy = (freshTgtRect.top  + freshTgtRect.height / 2) - (freshSrcRect.top  + freshSrcRect.height / 2);
      srcPortrait.style.transition = 'transform 390ms cubic-bezier(.6,0,1,.4), box-shadow 234ms ease';
      srcPortrait.style.transform  = `translate(${dx}px, ${dy}px) scale(0.5)`;
      srcPortrait.style.boxShadow  = '0 0 6px rgba(255,140,200,.2)';
    }, 507);

    // Phase 3 — impact (effets visuels + chiffre flottant) : c'est le moment
    // exact où le portrait "tape" la cible.
    setTimeout(() => {
      _resolveImpact(targetCard, target, result);
    }, 913);

    // Phase 4 — retour à la place et taille initiales (500ms), pendant que le
    // chiffre de dégâts/l'impact restent visibles sur la cible
    setTimeout(() => {
      srcPortrait.style.transition = 'transform 390ms cubic-bezier(.22,.68,0,1.2), box-shadow 312ms ease';
      srcPortrait.style.transform  = 'translate(0,0) scale(1)';
      srcPortrait.style.boxShadow  = '';
    }, 1030);

    // Phase 4b — nettoyage du portrait attaquant (déjà revenu à sa place)
    setTimeout(() => {
      srcPortrait.style.transition  = '';
      srcPortrait.style.transform   = '';
      srcPortrait.style.boxShadow   = '';
      srcPortrait.style.zIndex      = '';
      srcPortrait.style.animation   = '';
      srcPortrait.style.transformOrigin = '';
      attackerCard.style.zIndex = '';  // remettre la carte à son z-index normal
      applySnapshotAndUpdate(attacker, attackerHpSnapshot);
    }, 1466);

    // Phase 5 — la barre de vie de la cible ne baisse/monte que 0,15s après
    // l'impact ("le portrait a tapé"), pour rester très proche du coup tout en
    // évitant qu'elle ne change exactement au même instant que l'impact.
    setTimeout(() => {
      applySnapshotAndUpdate(target, targetHpToShow);
      _renderTurnOrderBar();
      _combatAnimDone();
    }, 1063);
  }

  /** Formate un multiplicateur de dégâts pour l'affichage (×2, ×0.5, ×2.25...) */
  function _formatMult(m) {
    if (m % 1 === 0) return String(m);
    return m.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function _resolveImpact(targetCard, target, result) {
    const targetPortrait = targetCard.querySelector('.fighter-portrait');

    if (result.evaded) {
      _spawnFloatText(targetCard, '💨 Esquive !', 'float-evade');
      return;
    }

    WBAudioSystem.playHitSfx(result.multiplier);

    targetPortrait?.classList.add('hit-flash', result.critical ? 'shake-big' : 'shake-hit');
    setTimeout(() => targetPortrait?.classList.remove('hit-flash', 'shake-big', 'shake-hit'), 480);

    _spawnFloatText(targetCard, `-${result.damage}`, result.critical ? 'float-dmg float-crit-dmg' : 'float-dmg', 0, true);
    if (_battle?.mode === 'trophy') _updateTrophyScoreHud();

    if (result.critical) {
      _spawnFloatText(targetCard, 'CRITIQUE !', 'float-crit-label', 1, true);
    }

    if (result.multiplier >= 2.0) {
      _spawnFloatText(targetCard, `×${_formatMult(result.multiplier)} Super efficace !`, 'float-mult float-mult-super', result.critical ? 2 : 1, true);
    } else if (result.multiplier > 0 && result.multiplier <= 0.5) {
      _spawnFloatText(targetCard, `×${_formatMult(result.multiplier)} Peu efficace...`, 'float-mult float-mult-low', result.critical ? 2 : 1, true);
    } else if (result.multiplier === 0) {
      _spawnFloatText(targetCard, 'Aucun effet !', 'float-mult float-mult-immune', result.critical ? 2 : 1, true);
    }
  }

  /** Affiche un texte flottant temporaire au-dessus d'une carte de combattant */
  /** Formate la condition d'évolution d'une créature pour affichage au joueur */
  function _formatEvoConditionText(def) {
    const cond = def.evolutionCondition;
    if (!cond) return 'Évolution';
    if (cond.type === 'item') {
      const item = WBGameState.get().items.find(i => i.id === cond.itemId);
      return item ? `Évolue avec ${item.icon || '🎒'} ${item.name}` : 'Évolue avec un objet spécial';
    }
    return `Évolue au niveau <strong>${cond.value ?? '?'}</strong>`;
  }

  function _spawnFloatText(card, text, cls, stack = 0, big = false) {
    const el = document.createElement('div');
    el.className = `float-text ${cls}`;
    el.style.setProperty('--stack', stack);
    el.textContent = text;
    card.appendChild(el);
    setTimeout(() => el.remove(), big ? 1920 : 1200); // 1920 = 1200 × 1.6 (durée +60%)
  }

  /** Petit brillant coloré synchronisé pile avec l'affichage d'un chiffre de dégâts/soin */
  function _spawnImpactGlow(card, variant) {
    const portrait = card?.querySelector('.fighter-portrait');
    if (!portrait) return;
    const glow = document.createElement('div');
    glow.className = `impact-glow impact-glow-${variant}`;
    portrait.appendChild(glow);
    setTimeout(() => glow.remove(), 1760);
  }

  /**
   * Joue une animation de montée de niveau sur les cartes de combattants encore
   * affichées sur l'écran de combat (flash doré + texte flottant), à partir des
   * infos de level-up renvoyées par le moteur dans les récompenses de victoire.
   * @param {Object<string,{levelUps:number[], evolved:object|null}>} levelUpInfo
   */
  function _playLevelUpAnimations(levelUpInfo) {
    // L'affichage des level ups est dans _showBattleResult
    // Cette fonction gère uniquement les évolutions
    if (!levelUpInfo) return;
    const evolutionQueue = [];
    Object.values(levelUpInfo).forEach(info => {
      if (info.evolved) evolutionQueue.push(info.evolved);
    });
    if (evolutionQueue.length > 0) {
      setTimeout(() => _showEvolutionShowcase(evolutionQueue), 400);
    }
  }

  /**
   * Affiche un écran de révélation plein écran pour chaque évolution survenue,
   * enchaînées une par une (portrait agrandi, animation "punchy" du mot ÉVOLUTION).
   * Avance automatiquement après quelques secondes, ou au clic/tap.
   * @param {Array<object>} queue - Définitions des personnages après évolution
   */
  /**
   * Met en file une animation plein écran pour chaque évolution survenue,
   * enchaînées une par une (jamais simultanées, même si plusieurs créatures
   * évoluent lors du même combat) via la file d'animations commune.
   * @param {Array<object>} queue - Définitions des personnages après évolution
   */
  function _showEvolutionShowcase(queue) {
    if (!queue || queue.length === 0) return;
    const total = queue.length;

    queue.forEach((nextDef, i) => {
      _enqueueAnimation(() => {
        const state = WBGameState.get();
        const prevDef = state.characters.find(c => c.evolvesTo === nextDef.id) || nextDef;
        const stepInfo = total > 1 ? { index: i + 1, total } : null;

        return WBEvolutionAnimator.play(prevDef, nextDef, stepInfo).then(() => {
          _updateHUD();
          if (_currentScreen === 'collection') renderCollection();
          if (_currentScreen === 'team') renderTeam();
          if (_currentScreen === 'catalogue') renderCatalogue();
        });
      });
    });
  }

  /**
   * Affiche un écran de révélation plein écran lors d'une montée de niveau du
   * JOUEUR (distinct du niveau des créatures) : nom du joueur, mention "LVL UP",
   * gain d'énergie maximale, et confirmation du plein regain d'énergie.
   * Se ferme automatiquement après quelques secondes, ou au clic/tap.
   * @param {{levelUps:number[], newLevel:number, newMaxEnergy:number, energyGained:number}} data
   * @param {Function} [onDone] - Appelé une fois l'overlay refermé (clic ou délai)
   */
  function _showPlayerLevelUpShowcase(data, onDone) {
    if (!data || !data.levelUps || data.levelUps.length === 0) { onDone?.(); return; }

    let overlay = document.getElementById('player-levelup-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'player-levelup-overlay';
      overlay.className = 'player-levelup-overlay';
      document.body.appendChild(overlay);
    }

    const player = WBGameState.getPlayer();
    const plCfg = WBGameState.getConfig().playerLevel;
    const energyGained = data.energyGained ?? (data.levelUps.length * (plCfg?.energyPerLevel || 0));

    // Forcer le redémarrage de l'animation même si l'overlay existait déjà
    overlay.classList.remove('visible');
    overlay.innerHTML = `
      <div class="lvlup-burst"></div>
      <div class="lvlup-badge-wrap">
        <div class="lvlup-badge-level">${data.newLevel}</div>
      </div>
      <div class="lvlup-title">⭐ LVL UP ! ⭐</div>
      <div class="lvlup-name">${player.name}</div>
      <div class="lvlup-energy-line">⚡ Énergie maximum +${energyGained}</div>
      <div class="lvlup-energy-line lvlup-energy-regen">🔋 Énergie totalement restaurée : ${data.newMaxEnergy}/${data.newMaxEnergy}</div>
      <div class="lvlup-hint">Touchez pour continuer</div>
    `;

    requestAnimationFrame(() => overlay.classList.add('visible'));
    WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.levelUp);

    const close = () => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 300);
      overlay.onclick = null;
      onDone?.();
    };
    clearTimeout(overlay._lvlupCloseTimer);
    overlay._lvlupCloseTimer = setTimeout(close, 3500);
    overlay.onclick = () => { clearTimeout(overlay._lvlupCloseTimer); close(); };
  }

  function _updateFighterCard(combatant) {
    const card = document.getElementById(`fighter-${combatant.instanceId}`);
    if (!card) return;
    const hpPct = Math.round((combatant.currentHp / combatant.maxHp) * 100);
    const hpColor = hpPct > 60 ? '#4ade80' : hpPct > 25 ? '#facc15' : '#f87171';
    const fill = card.querySelector('.hp-bar-fill');
    const txt  = card.querySelector('.hp-text');
    if (fill) { fill.style.width = hpPct + '%'; fill.style.background = hpColor; }
    if (txt)  txt.textContent = combatant.alive ? `${combatant.currentHp} / ${combatant.maxHp}` : 'KO';
    if (!combatant.alive) {
      card.classList.add('defeated');
      card.style.animation = 'shake 0.4s ease';
    }
    // Rafraîchir les icônes d'altérations (statuts actifs + buff ATK)
    const iconsEl = document.getElementById(`status-icons-${combatant.instanceId}`);
    if (iconsEl) iconsEl.innerHTML = _renderStatusIcons(combatant);
  }

  /** Écran de fin dédié au mode Trophée : score final, record battu, paliers débloqués */
  function _showTrophyResult(data) {
    WBAudioSystem.playResultSfx('victory');
    document.getElementById('trophy-result-overlay')?.remove();

    const finalScore = data.rewards?.trophyScore || 0;
    const isNewBest  = data.rewards?.isNewBest || false;
    const state      = WBGameState.get();
    const bestScore  = state.player.trophy?.bestScore || 0;
    const claimable  = (state.config.combat?.trophy?.rewardTiers || [])
      .filter(t => bestScore >= t.score && !(state.player.trophy?.tiersReached || []).includes(t.id)).length;

    const rewardsHint = claimable > 0 ? `
      <div class="bro-levelup-section">
        <div class="bro-levelup-title">🎁 ${claimable} récompense${claimable > 1 ? 's' : ''} disponible${claimable > 1 ? 's' : ''} !</div>
        <p style="font-size:.8rem;color:var(--text-dim);text-align:center;margin:4px 0 0">À réclamer manuellement sur l'écran Récompenses.</p>
      </div>` : '';

    const shell = document.querySelector('.app-shell') || document.body;
    const overlay = document.createElement('div');
    overlay.id = 'trophy-result-overlay';
    overlay.style.cssText = `
      position:absolute; inset:0; z-index:8000;
      background:#09040f;
      display:flex; flex-direction:column; align-items:center; justify-content:flex-start;
      overflow-y:auto; padding:32px 20px 40px;
      opacity:0; transition:opacity 500ms ease;
    `;
    overlay.innerHTML = `
      <div class="bro-victory-top">
        <div class="bro-glow-ring"></div>
        <div class="bro-title">🎯 SCORE FINAL</div>
        <div class="bro-subtitle" style="font-size:1.6rem;font-weight:800;color:var(--accent);margin-top:8px">${finalScore.toLocaleString('fr-FR')}</div>
        ${isNewBest ? `<div class="bro-subtitle" style="margin-top:4px">✨ Nouveau record personnel !</div>` : `<div class="bro-subtitle" style="margin-top:4px">Meilleur score : ${bestScore.toLocaleString('fr-FR')}</div>`}
      </div>
      ${rewardsHint}
      <button class="btn-primary bro-back-btn" id="btn-trophy-back">Retour</button>
    `;
    shell.appendChild(overlay);
    requestAnimationFrame(() => requestAnimationFrame(() => { overlay.style.opacity = '1'; }));

    document.getElementById('btn-trophy-back')?.addEventListener('click', () => {
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.remove();
        WBCombatEngine.reset();
        _battle = null;
        document.body.classList.remove('battle-active');
        WBAudioSystem.playGlobal();
        showScreen('trophy-hub');
      }, 500);
    });
  }

  function _showBattleResult(result, data) {
    const isVictory = result === 'victory';
    const battle    = WBCombatEngine.getBattle();

    WBAudioSystem.playResultSfx(result);
    document.getElementById('battle-result-overlay')?.remove();

    const capturable = isVictory ? (battle?.capturable?.filter(c => !c.captured) || []) : [];
    const captureHtml = capturable.length ? `
      <div class="bro-capture">
        <h4 class="bro-capture-title">🐾 Tentatives d'apprivoisement</h4>
        <div class="bro-capture-btns">
          ${capturable.map(c => `
            <button class="btn-capture" data-iid="${c.instanceId}" data-char-id="${c.charId}">
              Apprivoiser ${c.name}${c.mergedCount > 1 ? ` ×${c.mergedCount}` : ''} (${Math.round(c.captureRate*100)}%)
            </button>`).join('')}
        </div>
        <div id="capture-reveal"></div>
        <div id="capture-log"></div>
      </div>` : '';

    // L'overlay s'insère dans .app-shell pour prendre exactement la taille de l'écran de jeu
    const shell = document.querySelector('.app-shell') || document.body;

    const overlay = document.createElement('div');
    overlay.id = 'battle-result-overlay';
    overlay.style.cssText = `
      position:absolute; inset:0; z-index:8000;
      background:#09040f;
      display:flex; flex-direction:column; align-items:center; justify-content:flex-start;
      overflow-y:auto; padding:32px 20px 40px;
      opacity:0; transition:opacity 500ms ease;
    `;

    if (isVictory) {
      // Construire le HTML des level ups
      const levelUps = data.rewards?.levelUps || {};
      const luEntries = Object.entries(levelUps);
      const state = WBGameState.get();

      const levelUpHtml = luEntries.length > 0 ? `
        <div class="bro-levelup-section">
          <div class="bro-levelup-title">⬆️ Montée${luEntries.length > 1 ? 's' : ''} de niveau</div>
          ${luEntries.map(([instanceId, info]) => {
            const inst   = state.player.collection.find(c => c.instanceId === instanceId);
            const def    = inst ? WBGameState.getCharDef(inst.charId) : null;
            const oldLvl = info.levelUps[0] - 1;
            const newLvl = info.levelUps[info.levelUps.length - 1];
            const rd     = WBGameDatabase.RARITIES[def?.rarity || 'common'] || {};
            const crop   = def?.portraitCrop || WBGameDatabase.defaultPortraitCrop?.() || {};
            // Gains de stats
            const so = info.statsOld || {};
            const sn = info.statsNew || {};
            const diff = (k) => { const d = (sn[k]||0)-(so[k]||0); return d > 0 ? `<span class="bro-stat-chip">+${Math.round(d)} ${k==='hp'?'❤️':k==='atk'?'⚔️':k==='def'?'🛡️':'💨'}</span>` : ''; };
            return `<div class="bro-levelup-row">
              <div class="bro-levelup-portrait">
                ${def?.portrait
                  ? `<img src="${def.portrait}" alt="${def.name}" style="object-position:${crop.cx||50}% ${crop.cy||30}%">`
                  : '<span>🎭</span>'}
              </div>
              <div class="bro-levelup-info">
                <div class="bro-levelup-name">${def?.name || 'Inconnue'}</div>
                <div class="bro-levelup-lvl">
                  <span class="bro-lvl-old">Niv.${oldLvl}</span>
                  <span class="bro-lvl-arr">→</span>
                  <span class="bro-lvl-new">Niv.${newLvl}</span>
                  ${info.evolved ? `<span class="bro-evolved-badge">✨ ÉVOLUTION</span>` : ''}
                </div>
                <div class="bro-stat-chips">${diff('hp')}${diff('atk')}${diff('def')}${diff('spd')}</div>
              </div>
            </div>`;
          }).join('')}
        </div>` : '';

      overlay.innerHTML = `
        <div class="bro-victory-top">
          <div class="bro-particles" id="victory-particles"></div>
          <div class="bro-glow-ring"></div>
          <div class="bro-title">✨ VICTOIRE ✨</div>
          <div class="bro-survivors" id="victory-survivors"></div>
          <div class="bro-subtitle">Combat remporté avec brio</div>
        </div>
        ${battle?.mode === 'story' && battle.storyWorld != null ? `
          <div class="bro-story-label">
            ✨ Profondeur -${battle.storyWorld} — Cavité ${battle.storySubLevel} accomplie !
          </div>` : ''}
        ${data.rewards ? `
          <div class="bro-rewards">
            <span>+${data.rewards.xpEarned} <small>XP</small></span>
            <span>+${data.rewards.gold} 💵</span>
            <span>+${data.rewards.diamonds} 💧</span>
            ${data.rewards.energyPotionsDropped > 0 ? `<span>+${data.rewards.energyPotionsDropped} 🧪</span>` : ''}
          </div>
          ${data.rewards.eliteBonusGold > 0 ? `
            <div class="bro-bonus-badge bro-bonus-elite">⚔️ Bonus Béta +${data.rewards.eliteBonusGold} 💵</div>` : ''}
          ${data.rewards.bossBonusDiamonds > 0 ? `
            <div class="bro-bonus-badge bro-bonus-boss">👑 Bonus Alpha +${data.rewards.bossBonusDiamonds} 💧</div>` : ''}
        ` : ''}
        ${levelUpHtml}
        ${captureHtml}
        <button class="btn-primary bro-back-btn" id="btn-back-lobby">Retour au lobby</button>
      `;
    } else {
      overlay.innerHTML = `
        <div class="bro-defeat-top">
          <div class="bro-defeat-icon">💀</div>
          <div class="bro-defeat-title">Défaite...</div>
          <div class="bro-defeat-sub">Ils étaient trop forts cette fois</div>
        </div>
        ${battle?.mode === 'story' && battle.storyWorld != null ? `
          <div class="bro-story-label" style="color:#f87171">
            💢 Profondeur -${battle.storyWorld} — Cavité ${battle.storySubLevel} — Réessaie !
          </div>` : ''}
        <button class="btn-primary bro-back-btn" id="btn-back-lobby">Retour au lobby</button>
      `;
    }

    shell.appendChild(overlay);
    requestAnimationFrame(() => requestAnimationFrame(() => { overlay.style.opacity = '1'; }));

    // Animations de victoire
    if (isVictory && battle) {
      const survivors  = battle.playerTeam.filter(c => c.alive);
      const survivorsEl = document.getElementById('victory-survivors');
      const particlesEl = document.getElementById('victory-particles');

      survivors.forEach((c, i) => {
        const srcPortrait = document.getElementById(`fighter-${c.instanceId}`)?.querySelector('.fighter-portrait');
        const wrap = document.createElement('div');
        wrap.className = 'bro-survivor-wrap';
        wrap.style.animationDelay = `${200 + i * 150}ms`;

        // Reproduire le cercle de combat à 300% : même taille que fighter-portrait (74px)
        // affiché via scale(3) pour le zoom ×3
        const circle = document.createElement('div');
        circle.className = 'bro-survivor-circle';
        // Récupérer le style de bordure (couleur de rareté) du portrait original
        if (srcPortrait) {
          const borderColor = window.getComputedStyle(srcPortrait).borderColor;
          circle.style.borderColor = borderColor;
          circle.style.boxShadow   = `0 0 0 3px rgba(0,0,0,.4), 0 0 20px ${borderColor}`;
        }

        // Contenu : image avec son crop exact
        if (srcPortrait) {
          const img = srcPortrait.querySelector('img');
          if (img) {
            const ic = img.cloneNode(true);
            // Reprendre exactement le style de l'image original (position du crop)
            ic.style.animation = 'none';
            circle.appendChild(ic);
          } else {
            // Fallback : texte placeholder
            circle.textContent = srcPortrait.textContent;
          }
        }

        wrap.appendChild(circle);
        survivorsEl?.appendChild(wrap);
      });

      const PARTS = ['💎','✨','💕','🌸','⭐','💫','💖','🌺','👑','🔮','🫦','💄'];
      for (let i = 0; i < 22; i++) {
        const p = document.createElement('div');
        p.textContent = PARTS[i % PARTS.length];
        p.className   = 'bro-particle';
        p.style.left  = `${2 + Math.random() * 96}%`;
        p.style.animationDuration = `${1.2 + Math.random() * 1.1}s`;
        p.style.animationDelay    = `${Math.random() * 1.2}s`;
        p.style.fontSize = `${1 + Math.random() * 1.3}rem`;
        particlesEl?.appendChild(p);
      }
    }

    document.getElementById('btn-back-lobby')?.addEventListener('click', () => {
      // Capturer mode et chapitre AVANT le reset de _battle
      const battleMode    = _battle?.mode;
      const battleChapter = _battle?.storyChapter ?? _storyCurrentChapter;
      const battleStage   = _battle?.storyStage;

      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.remove();
        WBCombatEngine.reset();
        _battle = null;
        document.body.classList.remove('battle-active');
        WBAudioSystem.playGlobal();

        if (battleMode === 'storyMode' && battleChapter === 1 && battleStage === 5) {
          // Fin du Chapitre 2 / Stage 5 : Thomas introduit le Signal directement sur son écran
          showScreen('gacha');
          renderGacha();
          _showStoryDialogue({
            speaker: 'Thomas',
            portrait: WBGameState.get().config.tutorial?.narratorPortrait || '',
            text: "Dépense tes Essences Sauvages ici pour attirer des animaux. Tu peux aussi utiliser tes Dollars pour demander des équipements afin d'améliorer tes animaux.",
          });
        } else if (battleMode === 'storyMode') {
          // Mode Histoire → retour au chapitre en cours
          showScreen('story-chapter');
          renderStoryChapter(battleChapter);
        } else if (battleMode === 'tutorial') {
          showScreen('hub');
        } else {
          // Tous les autres modes → écran de sélection des combats
          _showCombatSelect();
        }
      }, 500);
    });

    overlay.querySelectorAll('.btn-capture').forEach(btn => {
      btn.addEventListener('click', () => {
        const res = WBCombatEngine.attemptCapture(btn.dataset.iid);
        const revealEl = document.getElementById('capture-reveal');
        const logEl    = document.getElementById('capture-log');
        btn.disabled = true;
        if (res?.success) {
          btn.style.background = '#4ade80';
          btn.textContent = '✓ Apprivoisé !';
          const awakeningMax = _checkAwakeningMaxAndGrantPill(res.addResult);
          _updateHUD();
          _playCaptureReveal(revealEl, btn.dataset.charId, res.addResult, awakeningMax);
        } else {
          btn.style.background = '#f87171';
          btn.textContent = '✗ Raté';
          if (logEl) logEl.innerHTML += `<div class="log-line">L'animal s'échappe...</div>`;
        }
      });
    });
  }

  /**
   * Joue l'animation de révélation (retournement de carte) d'un personnage capturé,
   * en réutilisant exactement le même système que pour une obtention par Gacha :
   * "NOUVEAU !" s'il vient de rejoindre la collection, "Awakening +1" s'il était déjà
   * possédé, ou "AWAKENING MAX" avec Pillule de Puissance s'il atteint le palier max.
   * @param {HTMLElement} container - où injecter la carte
   * @param {string} charId - ID de la définition du personnage capturé
   * @param {{isNew:boolean, awakening:boolean, instance:object}} addResult
   * @param {boolean} awakeningMax
   */
  function _playCaptureReveal(container, charId, addResult, awakeningMax) {
    if (!container || !addResult) return;
    const state = WBGameState.get();
    const char  = WBGameState.getCharDef(charId);
    if (!char) return;

    // Remplace toute révélation précédente plutôt que de l'empiler dessous
    container.innerHTML = '';

    const wrapId = `capture-reveal-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    const holder = document.createElement('div');
    holder.className = 'capture-reveal-holder';
    holder.innerHTML = `
      <div class="gacha-card-wrap" id="${wrapId}">
        <div class="gacha-card-inner">
          <div class="gacha-card-back">
            <div class="gacha-card-back-glow"></div>
            <div class="gacha-card-back-icon">✦</div>
          </div>
          <div class="gacha-card-front"></div>
        </div>
      </div>
    `;
    container.appendChild(holder);

    const result = { char, isNew: addResult.isNew, awakening: addResult.awakening, awakeningMax };
    setTimeout(() => _flipCard(null, result, state, wrapId), 250);
  }

  // ─── GACHA ────────────────────────────────────────────────────────────────────

  function _toggleBannerInfo(btn) {
    if (typeof event !== 'undefined') event.stopPropagation();
    document.querySelectorAll('.banner-info-panel.open').forEach(p => {
      p.classList.remove('open'); p.style.cssText = '';
    });
    const panelId = btn.dataset.panelId;
    const panel   = document.getElementById(panelId);
    if (!panel) return;
    if (panel.classList.contains('open')) {
      panel.classList.remove('open'); panel.style.cssText = ''; return;
    }
    const rect     = btn.getBoundingClientRect();
    const shell    = document.querySelector('.app-shell');
    const shellRect = shell ? shell.getBoundingClientRect() : { left: 0, right: window.innerWidth };
    const panelW   = 224;
    let left = rect.left;
    if (left + panelW > shellRect.right - 8) left = shellRect.right - panelW - 8;
    if (left < shellRect.left + 8)           left = shellRect.left + 8;
    panel.classList.add('open');
    panel.style.cssText = `display:block;position:fixed;left:${left}px;top:${rect.bottom + 6}px;width:${panelW}px;z-index:9000;`;
    setTimeout(() => {
      const close = (e) => {
        if (!panel.contains(e.target) && e.target !== btn) {
          panel.classList.remove('open'); panel.style.cssText = '';
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 50);
  }

  function renderGacha() {
    const el = document.getElementById('screen-gacha');
    if (!el) return;
    const state = WBGameState.get();

    el.innerHTML = `
      <div class="screen-header"><h2>💧 Rencontres</h2>${_helpBtn('gacha')}</div>
      <div class="gacha-tabs">
        <button class="gacha-tab ${_gachaTab === 'chars' ? 'active' : ''}" data-tab="chars">💧 Personnages</button>
        <button class="gacha-tab ${_gachaTab === 'equip' ? 'active' : ''}" data-tab="equip">⚔️ Équipements</button>
      </div>
      <div id="gacha-tab-content"></div>
      <div id="gacha-results"></div>
    `;

    el.querySelectorAll('.gacha-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _gachaTab = btn.dataset.tab;
        document.querySelectorAll('.gacha-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === _gachaTab));
        _renderGachaTabContent();
        document.getElementById('gacha-results').innerHTML = '';
      });
    });

    _renderGachaTabContent();
  }

  function _renderGachaTabContent() {
    const el = document.getElementById('gacha-tab-content');
    if (!el) return;
    const state = WBGameState.get();

    if (_gachaTab === 'chars') {
      const cfg     = state.config.gacha;
      const ev      = WBGameState.getActiveEvent();
      const tag     = ev ? (state.tags?.find(t => t.id === ev.tagId)) : null;
      // On cherche une bannière event explicite, sinon on la génère depuis l'event
      const banners = state.banners.filter(b => b.active && b.id !== 'banner_event');

      // Helper : bulle d'info d'une bannière (persos disponibles + taux)
      const bannerInfoBubble = (bannerId, dropRates, poolTagId, poolTypeId, poolMode) => {
        const RARITY_ORDER = ['mythic','legendary','epic','rare','uncommon','common'];
        let pool = state.characters.filter(c => c.evolutionStage === 0);
        if (poolMode === 'tag'  && poolTagId)  pool = pool.filter(c => c.tags?.includes(poolTagId));
        if (poolMode === 'type' && poolTypeId) pool = pool.filter(c => c.type1 === poolTypeId || c.type2 === poolTypeId);

        const counts = {};
        pool.forEach(c => { counts[c.rarity] = (counts[c.rarity]||0)+1; });

        const rows = RARITY_ORDER.filter(r => counts[r] || (dropRates?.[r] > 0)).map(r => {
          const rd   = WBGameDatabase.RARITIES[r] || {};
          const rate = dropRates?.[r] ?? 0;
          const nb   = counts[r] ?? 0;
          return `<div class="banner-info-row">
            <span class="banner-info-rarity" style="color:${rd.color||'#aaa'}">${rd.name||r}</span>
            <span class="banner-info-count">${nb} perso${nb>1?'s':''}</span>
            <span class="banner-info-rate">${rate > 0 ? rate + '%' : '—'}</span>
          </div>`;
        }).join('');

        const uid = 'bip_' + bannerId.replace(/[^a-z0-9]/gi,'_');
        return `
          <button class="banner-info-btn" data-panel-id="${uid}" onclick="WBGameUI._toggleBannerInfo(this)" aria-label="Informations bannière">ℹ️</button>
          <div class="banner-info-panel" id="${uid}">
            <div class="banner-info-title">Personnages disponibles</div>
            <div class="banner-info-header-row">
              <span>Rareté</span><span>Nb</span><span>Taux</span>
            </div>
            ${rows}
            <div class="banner-info-total">${pool.length} personnage${pool.length>1?'s':''} au total</div>
          </div>`;
      };

      // Bannière event — sans taux affichés directement (dans la bulle uniquement)
      const eventBannerHtml = ev ? `
        <div class="banner-card banner-card-event" style="position:relative">
          ${bannerInfoBubble('banner_event', ev.bannerRates, ev.tagId, null, 'tag')}
          <div class="banner-event-badge">✨ EVENT — ${tag?.icon || ''}${tag?.name || 'Event'}</div>
          <div class="banner-header">
            <h3>Rencontre ${tag?.name || 'Event'}</h3>
            <p>Invocations exclusives — personnages ${tag?.name || 'Event'} uniquement</p>
          </div>
          <div class="banner-actions">
            <button class="btn-gacha btn-single btn-gacha-event" data-banner="banner_event">
              ✦ Rencontrer ×1<br><small>${cfg.singlePullCost} 💧</small>
            </button>
            <button class="btn-gacha btn-ten btn-gacha-event" data-banner="banner_event">
              ✦✦ Rencontrer ×10<br><small>${cfg.tenPullCost} 💧</small>
            </button>
          </div>
        </div>` : '';

      el.innerHTML = `
        <div class="gacha-currency">
          <span class="hud-icon">💧</span>
          <span>${state.player.currency.crystals.toLocaleString()} Essence Sauvage</span>
        </div>
        <div class="banner-list">
          ${eventBannerHtml}
          ${banners.map(b => `
            <div class="banner-card" style="position:relative">
              ${bannerInfoBubble(b.id, cfg.dropRates || {}, b.poolTagId, b.poolTypeId, b.pool)}
              <div class="banner-header"><h3>${b.name}</h3><p>${b.description}</p></div>
              <div class="banner-actions">
                <button class="btn-gacha btn-single" data-banner="${b.id}">
                  ✦ Rencontrer ×1<br><small>${cfg.singlePullCost} 💧</small>
                </button>
                <button class="btn-gacha btn-ten" data-banner="${b.id}">
                  ✦✦ Rencontrer ×10<br><small>${cfg.tenPullCost} 💧</small>
                </button>
              </div>
            </div>`).join('')}
        </div>`;
      el.querySelectorAll('.btn-single').forEach(btn => btn.addEventListener('click', () => _doGachaPull(btn.dataset.banner, 1)));
      el.querySelectorAll('.btn-ten').forEach(btn => btn.addEventListener('click', () => _doGachaPull(btn.dataset.banner, 10)));

    } else {
      // Gacha équipements
      const equipBanners = (state.equipBanners || []).filter(b => b.active);
      el.innerHTML = `
        <div class="gacha-currency">
          <span class="hud-icon">💵</span>
          <span>${(state.player.currency.gold || 0).toLocaleString()} $</span>
        </div>
        <div class="banner-list">
          ${equipBanners.map(b => `
            <div class="banner-card equip-banner-card">
              <div class="banner-header"><h3>${b.name}</h3><p>${b.description}</p></div>
              <div class="banner-actions">
                <button class="btn-gacha btn-single btn-equip-pull" data-banner="${b.id}" data-count="1">
                  ⚙️ Obtenir ×1<br><small>${b.singlePullCost} 💵</small>
                </button>
                <button class="btn-gacha btn-ten btn-equip-pull" data-banner="${b.id}" data-count="10">
                  ⚙️⚙️ Obtenir ×10<br><small>${b.tenPullCost} 💵</small>
                </button>
              </div>
            </div>`).join('')}
          ${equipBanners.length === 0 ? '<p class="empty-msg">Aucun défilé d\'équipements actif.</p>' : ''}
        </div>`;
      el.querySelectorAll('.btn-equip-pull').forEach(btn => {
        btn.addEventListener('click', () => _doEquipGachaPull(btn.dataset.banner, Number(btn.dataset.count)));
      });
    }
  }

  function _doGachaPull(bannerId, count) {
    // Désactiver les boutons pendant l'animation
    document.querySelectorAll('.btn-gacha').forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });

    const results = count === 1
      ? [WBGachaSystem.pullSingle(bannerId)]
      : WBGachaSystem.pullTen(bannerId);

    if (results[0]?.error) {
      _showToast(results[0].error, 'error');
      document.querySelectorAll('.btn-gacha').forEach(b => { b.disabled = false; b.style.opacity = ''; });
      return;
    }

    // ── Détection Awakening Max + attribution Pillule ──────────────────────────
    results.forEach(r => { r.awakeningMax = _checkAwakeningMaxAndGrantPill(r); });

    _updateHUD();
    _showGachaAnimation(results, () => {
      document.querySelectorAll('.btn-gacha').forEach(b => { b.disabled = false; b.style.opacity = ''; });
    });
  }

  /**
   * Détecte si un résultat d'obtention (gacha ou capture) fait atteindre l'awakening
   * maximum à un personnage déjà possédé, et lui octroie une Pillule de Puissance
   * le cas échéant. Renvoie true si l'awakening max vient d'être atteint.
   * @param {{awakening?:boolean, instance?:object}} addResult
   * @returns {boolean}
   */
  function _checkAwakeningMaxAndGrantPill(addResult) {
    const maxAwk = WBGameState.getConfig().awakening.maxLevel;
    const isMax = !!(addResult?.awakening && addResult.instance && (addResult.instance.awakening || 0) >= maxAwk);
    if (isMax) {
      const p = WBGameState.getPlayer();
      const inv = { ...(p.inventory || {}) };
      inv['item_power_pill'] = (inv['item_power_pill'] || 0) + 1;
      WBGameState.updatePlayer({ inventory: inv });
    }
    return isMax;
  }

  /**
   * Affiche l'animation de tirage gacha.
   * Chaque carte apparaît face cachée puis se retourne pour révéler le personnage.
   * @param {Array} results - Résultats du tirage
   * @param {Function} onDone - Callback une fois l'animation terminée
   */
  function _showGachaAnimation(results, onDone) {
    const el = document.getElementById('gacha-results');
    if (!el) { onDone?.(); return; }

    const state = WBGameState.get();

    // Construire la grille de cartes dos initial
    el.innerHTML = `<div class="gacha-result-grid" id="gacha-anim-grid">
      ${results.map((_, i) => `
        <div class="gacha-card-wrap" id="gacha-card-${i}">
          <div class="gacha-card-inner">
            <div class="gacha-card-back">
              <div class="gacha-card-back-glow"></div>
              <div class="gacha-card-back-icon">✦</div>
            </div>
            <div class="gacha-card-front"></div>
          </div>
        </div>
      `).join('')}
    </div>
    <button class="btn-primary gacha-skip-btn" id="gacha-skip-btn" style="margin-top:16px;">⏩ Passer l'animation</button>`;

    el.scrollIntoView({ behavior: 'smooth' });

    let cancelled = false;
    const skipBtn = document.getElementById('gacha-skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        cancelled = true;
        _revealAll(results, state, el, onDone);
      });
    }

    // Révéler les cartes une à une avec délai
    results.forEach((r, i) => {
      const delay = cancelled ? 0 : (results.length === 1 ? 400 : i * 220 + 300);
      setTimeout(() => {
        if (cancelled) return;
        _flipCard(i, r, state);
        // Après le dernier, retirer le bouton skip
        if (i === results.length - 1) {
          setTimeout(() => {
            const s = document.getElementById('gacha-skip-btn');
            if (s) s.style.display = 'none';
            onDone?.();
          }, 600);
        }
      }, delay);
    });
  }

  /** Retourne une carte individuelle et affiche son contenu */
  function _flipCard(index, result, state, elementId = `gacha-card-${index}`) {
    const wrap = document.getElementById(elementId);
    if (!wrap) return;

    const rarityDef = WBGameDatabase.RARITIES[result.char.rarity] || {};
    const t1 = state.types.find(t => t.id === result.char.type1);

    // ── Construire le statut (nouveau / awakening / max) ────────────────────
    let statusHtml;
    if (result.awakeningMax) {
      statusHtml = `<div class="gacha-status status-awk-max">★ RENFORCEMENT MAX ★<br><small>💊 Élixir de Prestige !</small></div>`;
    } else if (result.awakening) {
      statusHtml = `<div class="gacha-status">✨ Renforcement +1</div>`;
    } else if (result.isNew) {
      statusHtml = `<div class="gacha-status status-new">✦ NOUVEAU !</div>`;
    } else {
      statusHtml = `<div class="gacha-status"></div>`;
    }

    // Remplir le front avant le flip
    const front = wrap.querySelector('.gacha-card-front');
    if (front) {
      front.innerHTML = `
        <div class="gacha-portrait">
          ${result.char.portrait
            ? `<img src="${result.char.portrait}" alt="${result.char.name}">`
            : `<div class="portrait-ph">${result.char.name.charAt(0)}</div>`}
        </div>
        <div class="gacha-info">
          <div class="gacha-name">${result.char.name}</div>
          <div class="gacha-rarity" style="color:${rarityDef.color}">${rarityDef.name}</div>
          ${t1 ? `<div class="gacha-type"><span class="type-badge" style="background:${t1.color}">${t1.icon}</span></div>` : ''}
          ${statusHtml}
        </div>
      `;
    }

    // Classes spéciales pour les états
    wrap.classList.add(`rarity-${result.char.rarity}`);
    wrap.style.setProperty('--rarity-color', rarityDef.color || '#888');
    if (result.isNew)        wrap.classList.add('is-new');
    if (result.awakeningMax) wrap.classList.add('is-awk-max');

    // Déclencher le flip CSS
    wrap.classList.add('flipped');
    WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.gachaPull);

    // ── Animations post-flip ─────────────────────────────────────────────────
    const highRarity = ['epic','legendary','mythic'].includes(result.char.rarity);
    if (highRarity) {
      setTimeout(() => wrap.classList.add('gacha-card-shine'), 500);
    }

    // Burst "Nouveau !" flottant
    if (result.isNew && !result.awakeningMax) {
      setTimeout(() => {
        const badge = document.createElement('div');
        badge.className = 'new-char-burst';
        badge.textContent = '✦ NOUVEAU !';
        wrap.appendChild(badge);
        setTimeout(() => badge.remove(), 1400);
      }, 580);
    }
  }

  /** Révèle immédiatement toutes les cartes (skip) */
  function _revealAll(results, state, el, onDone) {
    const skipBtn = document.getElementById('gacha-skip-btn');
    if (skipBtn) skipBtn.style.display = 'none';

    results.forEach((r, i) => {
      setTimeout(() => _flipCard(i, r, state), i * 40);
    });

    setTimeout(() => onDone?.(), results.length * 40 + 300);
  }

  // ─── ÉQUIPEMENT ──────────────────────────────────────────────────────────────

  /**
   * Écran principal de gestion des équipements.
   * Deux panneaux : sélection du perso + gestion des slots, et utilisation des items.
   */
  function renderEquip() {
    const el = document.getElementById('screen-equip');
    if (!el) return;

    // Le squelette complet n'est reconstruit qu'à la toute première ouverture de
    // l'écran ; ensuite, chaque interaction passe par les fonctions de
    // rafraîchissement partiel (_refreshEquipCharPicker, _refreshEquipSlots,
    // _refreshEquipSlotPanel, _refreshEquipInvGrid) pour éviter de tout
    // reconstruire (et perdre la position de scroll) à chaque clic.
    if (el.dataset.built === '1') {
      _refreshEquipCharPicker();
      _refreshEquipSlots();
      _refreshEquipSlotPanel();
      _refreshEquipInvGrid();
      _showAutoEquipResult();
      return;
    }
    el.dataset.built = '1';

    el.innerHTML = `
      <div class="screen-header"><h2>⚔️ Équipements</h2>${_helpBtn('equip')}</div>

      <div class="equip-top-zone">
        <div id="auto-equip-result"></div>

        <!-- ── Sélection du personnage ── -->
        <div class="equip-section" style="margin-bottom:10px">
          <div class="equip-section-title" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <span>Choisir un personnage</span>
            ${_renderSortSelect('equip-sort', _equipSort)}
          </div>
          <div class="equip-unequipped-filters" id="equip-unequipped-filters">
            ${EQUIP_SLOT_ORDER.map(slotKey => `
              <label class="equip-unequipped-filter-chip">
                <input type="checkbox" class="chk-unequipped-slot" data-slot-key="${slotKey}" ${_equipUnequippedFilter[slotKey] ? 'checked' : ''}>
                Sans ${EQUIP_SLOT_LABELS[slotKey]}
              </label>
            `).join('')}
          </div>
          <div class="equip-char-picker" id="equip-char-picker"></div>
        </div>

        <!-- ── Slots d'équipement ── -->
        <div id="equip-slots-section"></div>

        <!-- ── Panneau inline de sélection (remplace le modal) ── -->
        <div id="equip-slot-panel-container"></div>
      </div>

      <!-- ── Inventaire équipements (zone basse, scrollable) ── -->
      <div class="equip-section" id="equip-inv-section">
        <div class="equip-section-title">Équipements en stock <span class="badge" id="equip-inv-count">${WBGameState.getPlayer().equipInventory?.length || 0}</span></div>
        ${_renderEquipInventorySection()}
      </div>
    `;

    document.getElementById('equip-sort')?.addEventListener('change', e => {
      _equipSort = e.target.value;
      _refreshEquipCharPicker();
    });

    document.querySelectorAll('.chk-unequipped-slot').forEach(chk => {
      chk.addEventListener('change', e => {
        _equipUnequippedFilter[e.target.dataset.slotKey] = e.target.checked;
        _refreshEquipCharPicker();
      });
    });

    _refreshEquipCharPicker();
    _refreshEquipSlots();
    _bindEquipInventorySection();
  }

  /**
   * Génère la structure de la section "Équipements en stock" : 3 onglets
   * (Armes / Armures / Accessoires), chacun avec son propre tri et ses filtres.
   */
  function _renderEquipInventorySection() {
    return `
      <div class="equip-inv-tabs">
        ${EQUIP_SLOT_ORDER.map(slotKey => `
          <button class="equip-inv-tab-btn ${_equipInvTab === slotKey ? 'active' : ''}" data-slot-tab="${slotKey}">
            ${EQUIP_SLOT_LABELS[slotKey]}
          </button>
        `).join('')}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
        <button id="btn-auto-equip" style="background:linear-gradient(135deg,var(--accent2),var(--accent2-deep));border:none;border-radius:999px;color:#fff;font-size:.74rem;font-weight:700;padding:7px 14px;cursor:pointer;white-space:nowrap">⚡ Équipement auto</button>
        <button id="btn-unequip-all" style="background:var(--danger);border:none;border-radius:999px;color:#fff;font-size:.74rem;font-weight:700;padding:7px 14px;cursor:pointer;white-space:nowrap">🗑️ Déséquiper tout</button>
      </div>
      <div class="screen-controls">
        ${_renderEquipSortSelect('equip-inv-sort', _equipInvSort[_equipInvTab])}
      </div>
      ${_renderEquipFilterBar('equip-inv', _equipInvFilters[_equipInvTab])}
      <div class="equip-inv-grid" id="equip-inv-grid"></div>
    `;
  }

  /** Lie les onglets, le tri et les filtres de la section inventaire d'équipement */
  function _bindEquipInventorySection() {
    document.querySelectorAll('.equip-inv-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _equipInvTab = btn.dataset.slotTab;
        const container = document.getElementById('equip-inv-section');
        if (container) {
          const badge = `<span class="badge" id="equip-inv-count">${WBGameState.getPlayer().equipInventory?.length || 0}</span>`;
          container.innerHTML = `<div class="equip-section-title">Équipements en stock ${badge}</div>${_renderEquipInventorySection()}`;
          _bindEquipInventorySection();
        }
      });
    });

    // Bouton déséquiper tout
    document.getElementById('btn-unequip-all')?.addEventListener('click', () => {
      _clearAutoEquipResult();
      _unequipAll();
      _equipSlotOpen = null;
      _refreshEquipCharPicker();
      _refreshEquipSlots();
      _refreshEquipSlotPanel();
      _refreshEquipInvGrid();
    });

    // Bouton équipement automatique
    document.getElementById('btn-auto-equip')?.addEventListener('click', () => {
      _equipSlotOpen = null;
      _autoEquip();
      _refreshEquipCharPicker();
      _refreshEquipSlots();
      _refreshEquipSlotPanel();
      _refreshEquipInvGrid();
    });

    document.getElementById('equip-inv-sort')?.addEventListener('change', e => {
      _equipInvSort[_equipInvTab] = e.target.value;
      _refreshEquipInvGrid();
    });
    _bindEquipFilterBar('equip-inv', _equipInvFilters[_equipInvTab], _refreshEquipInvGrid);

    _refreshEquipInvGrid();
  }

  /** Déséquipe tous les équipements de tous les personnages */
  function _unequipAll() {
    const state = WBGameState.get();
    state.player.collection.forEach(inst => {
      for (let slot = 0; slot < 3; slot++) {
        if (inst.equipment?.[slot]) {
          WBGameState.equipItem(inst.instanceId, slot, null);
        }
      }
    });
    _showToast('Tous les équipements ont été retirés.', 'info');
  }

  /**
   * Équipement automatique : déséquipe tout, puis équipe les meilleures pièces
   * aux meilleurs personnages (classés par niveau puis rareté).
   * Stratégie : trier les persos du meilleur au moins bon, trier les items
   * par "score total de bonus" décroissant, assigner slot par slot.
   * Le résultat (qui a reçu quoi) est mémorisé dans _autoEquipResult pour
   * affichage inline juste au-dessus des slots.
   */
  function _autoEquip() {
    // 1. Déséquiper tout
    _unequipAll();

    const state = WBGameState.get();
    const inv   = state.player.equipInventory || [];

    // 2. Classer les personnages (meilleurs en premier) : priorité à la rareté,
    // puis au score Attrait (départage à rareté égale)
    const RARITY_W = { mythic: 6, legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1 };
    const chars = [...state.player.collection].sort((a, b) => {
      const da = WBGameState.getCharDef(a.charId);
      const db = WBGameState.getCharDef(b.charId);
      const ra = RARITY_W[da?.rarity] || 0;
      const rb = RARITY_W[db?.rarity] || 0;
      if (rb !== ra) return rb - ra;
      return WBGameState.getCharacterAuraScore(b) - WBGameState.getCharacterAuraScore(a);
    });

    // 3. Classer les items de chaque type par score total de bonus (décroissant)
    const weaponPool    = inv.filter(ei => { const d = state.equipment.find(e => e.id === ei.equipId); return d && WBGameDatabase.resolveEquipSlot(d) === 'weapon'; })
                             .sort((a, b) => { const da = state.equipment.find(e => e.id === a.equipId); const db = state.equipment.find(e => e.id === b.equipId); return _itemScore(db, b) - _itemScore(da, a); });
    const armorPool     = inv.filter(ei => { const d = state.equipment.find(e => e.id === ei.equipId); return d && WBGameDatabase.resolveEquipSlot(d) === 'armor'; })
                             .sort((a, b) => { const da = state.equipment.find(e => e.id === a.equipId); const db = state.equipment.find(e => e.id === b.equipId); return _itemScore(db, b) - _itemScore(da, a); });
    const accessoryPool = inv.filter(ei => { const d = state.equipment.find(e => e.id === ei.equipId); return d && WBGameDatabase.resolveEquipSlot(d) === 'accessory'; })
                             .sort((a, b) => { const da = state.equipment.find(e => e.id === a.equipId); const db = state.equipment.find(e => e.id === b.equipId); return _itemScore(db, b) - _itemScore(da, a); });

    const pools = [weaponPool, armorPool, accessoryPool];
    const poolIdx = [0, 0, 0];
    const results = [];

    // 4. Assigner : chaque perso reçoit le meilleur item disponible pour chaque slot
    chars.forEach(inst => {
      const def = WBGameState.getCharDef(inst.charId);
      const received = [];
      for (let slot = 0; slot < 3; slot++) {
        const pool = pools[slot];
        if (poolIdx[slot] < pool.length) {
          const entry = pool[poolIdx[slot]];
          WBGameState.equipItem(inst.instanceId, slot, entry.instanceId);
          const eqDef = state.equipment.find(e => e.id === entry.equipId);
          if (eqDef) received.push({ slotLabel: EQUIP_SLOT_LABELS[EQUIP_SLOT_ORDER[slot]], itemName: eqDef.name, itemRarity: eqDef.rarity });
          poolIdx[slot]++;
        }
      }
      if (received.length > 0) {
        results.push({ charName: def?.name || '?', charRarity: def?.rarity || 'common', items: received });
      }
    });

    _autoEquipResult = results;
    _showAutoEquipResult();
  }

  /** Calcule le score total (somme des bonus) d'une définition d'équipement */
  function _itemScore(def, invInst) {
    const b = invInst ? _scaledEquipBonuses(def, invInst) : (def?.bonuses || {});
    return Object.values(b).reduce((s, v) => s + (v || 0), 0);
  }

  /** Affiche (ou efface) le résumé inline du dernier équipement automatique */
  function _showAutoEquipResult() {
    const container = document.getElementById('auto-equip-result');
    if (!container) return;
    clearTimeout(_autoEquipResultTimer);

    if (!_autoEquipResult || _autoEquipResult.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="auto-equip-summary">
        <div class="auto-equip-summary-title">⚡ Équipement automatique appliqué</div>
        ${_autoEquipResult.map(r => `
          <div class="auto-equip-summary-line">
            <strong>${r.charName}</strong> :
            ${r.items.map(it => `<span class="auto-equip-item rarity-${it.itemRarity}">${it.slotLabel.replace(/^\S+\s/, '')} ${it.itemName}</span>`).join(', ')}
          </div>
        `).join('')}
      </div>
    `;

    _autoEquipResultTimer = setTimeout(() => {
      _autoEquipResult = null;
      _showAutoEquipResult();
    }, 4000);
  }

  /** Efface immédiatement le résumé d'équipement auto (ex: avant une autre interaction) */
  function _clearAutoEquipResult() {
    if (!_autoEquipResult) return;
    _autoEquipResult = null;
    clearTimeout(_autoEquipResultTimer);
    _showAutoEquipResult();
  }

  /** Construit les 3 pastilles de slot (couleur de rareté si équipé, gris sinon) pour une instance */
  function _buildSlotDots(inst) {
    const state = WBGameState.get();
    return EQUIP_SLOT_ORDER.map((slotKey, slot) => {
      const invId    = inst.equipment?.[slot] || null;
      const invEntry = invId ? state.player.equipInventory.find(ei => ei.instanceId === invId) : null;
      const eqDef    = invEntry ? state.equipment.find(e => e.id === invEntry.equipId) : null;
      return `<span class="slot-dot ${eqDef ? 'rarity-' + eqDef.rarity : 'empty'}" title="${EQUIP_SLOT_LABELS[slotKey]}${eqDef ? ' : ' + eqDef.name : ' : vide'}"></span>`;
    }).join('');
  }

  /** Sélectionne un personnage dans l'écran Équiper : ferme le panneau de slot ouvert et rafraîchit les zones concernées */
  function _selectEquipChar(instanceId) {
    if (_equipCharId === instanceId) return;
    _clearAutoEquipResult();
    _equipCharId     = instanceId;
    _equipSlotOpen   = null;
    _equipSlotSearch = '';
    _refreshEquipCharPicker();
    _refreshEquipSlots();
    _refreshEquipSlotPanel();
    _refreshEquipInvGrid();
  }

  /** Rafraîchit uniquement le picker de personnages (pour le filtre "sans équipement" et la sélection) */
  function _refreshEquipCharPicker() {
    const state  = WBGameState.get();
    const player = state.player;
    const picker = document.getElementById('equip-char-picker');
    if (!picker) return;

    let instances = player.collection;
    const activeSlots = EQUIP_SLOT_ORDER.filter(slotKey => _equipUnequippedFilter[slotKey]);
    if (activeSlots.length > 0) {
      // Un personnage est retenu s'il lui manque l'équipement d'AU MOINS UNE des
      // catégories cochées (ex: cocher "Sans arme" ET "Sans accessoire" affiche
      // tout personnage sans arme OU sans accessoire, pas nécessairement les deux).
      instances = instances.filter(inst =>
        activeSlots.some(slotKey => {
          const slot = EQUIP_SLOT_ORDER.indexOf(slotKey);
          return !inst.equipment || !inst.equipment[slot];
        })
      );
    }

    if (instances.length === 0) {
      const msg = activeSlots.length > 0
        ? `Tous les personnages ont déjà ${activeSlots.length > 1 ? 'ces équipements' : `un${activeSlots[0] === 'armor' ? 'e' : ''} ${EQUIP_SLOT_LABELS[activeSlots[0]].replace(/^\S+\s/, '').toLowerCase()}`}.`
        : 'Aucun personnage dans la collection.';
      picker.innerHTML = `<p class="empty-msg" style="margin:0;padding:.5rem">${msg}</p>`;
      return;
    }

    picker.innerHTML = _sortDecoratedChars(_decorateInstances(instances, state), _equipSort, state).map(({ inst, def }) => {
      const rarityDef = WBGameDatabase.RARITIES[def.rarity] || {};
      return `<div class="equip-char-mini ${_equipCharId === inst.instanceId ? 'selected' : ''}"
                data-iid="${inst.instanceId}"
                style="border-top:3px solid ${rarityDef.color || '#888'}">
        ${def.portrait
          ? `<img src="${def.portrait}" alt="${def.name}" style="width:48px;height:48px;border-radius:6px;object-fit:cover;display:block;margin:0 auto 4px">`
          : `<div class="portrait-ph" style="width:48px;height:48px;border-radius:6px;margin:0 auto 4px;font-size:1.2rem">${def.name.charAt(0)}</div>`}
        <div class="equip-char-mini-name">${def.name}</div>
        <div class="equip-char-mini-level">Niv.${inst.level}</div>
        <div class="equip-char-slot-dots">${_buildSlotDots(inst)}</div>
      </div>`;
    }).join('');

    picker.querySelectorAll('.equip-char-mini').forEach(card => {
      card.addEventListener('click', () => _selectEquipChar(card.dataset.iid));
    });
  }

  /** Trie une liste décorée d'exemplaires d'équipement ({invInst, def}) */
  function _sortEquipInv(decorated, sortKey) {
    const rarityIndex = (r) => { const idx = RARITY_ORDER.indexOf(r); return idx === -1 ? 0 : idx; };
    const sorted = [...decorated];
    switch (sortKey) {
      case 'rarity': sorted.sort((a, b) => rarityIndex(b.def.rarity) - rarityIndex(a.def.rarity) || a.def.name.localeCompare(b.def.name)); break;
      case 'hp':     sorted.sort((a, b) => (b.def.bonuses.hp  || 0) - (a.def.bonuses.hp  || 0)); break;
      case 'atk':    sorted.sort((a, b) => (b.def.bonuses.atk || 0) - (a.def.bonuses.atk || 0)); break;
      case 'def':    sorted.sort((a, b) => (b.def.bonuses.def || 0) - (a.def.bonuses.def || 0)); break;
      case 'spd':    sorted.sort((a, b) => (b.def.bonuses.spd || 0) - (a.def.bonuses.spd || 0)); break;
      case 'name':
      default:       sorted.sort((a, b) => a.def.name.localeCompare(b.def.name)); break;
    }
    return sorted;
  }

  /** Filtre une liste décorée d'exemplaires d'équipement selon la recherche, la rareté et un seuil de stat */
  function _applyEquipFilters(decorated, filters) {
    if (!filters) return decorated;
    return decorated.filter(({ def }) => {
      if (filters.search && !def.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
      if (filters.rarity && def.rarity !== filters.rarity) return false;
      if (filters.statKey && filters.statMin !== '' && filters.statMin != null) {
        const val = def.bonuses[filters.statKey] || 0;
        if (val < Number(filters.statMin)) return false;
      }
      return true;
    });
  }

  /** Menu déroulant de tri pour l'inventaire d'équipement */
  function _renderEquipSortSelect(id, current) {
    return `
      <select class="sort-select" id="${id}">
        <option value="name"   ${current === 'name'   ? 'selected' : ''}>Trier : Nom (A-Z)</option>
        <option value="rarity" ${current === 'rarity' ? 'selected' : ''}>Trier : Rareté</option>
        <option value="hp"     ${current === 'hp'     ? 'selected' : ''}>Trier : PV</option>
        <option value="atk"    ${current === 'atk'    ? 'selected' : ''}>Trier : ATK</option>
        <option value="def"    ${current === 'def'    ? 'selected' : ''}>Trier : DEF</option>
        <option value="spd"    ${current === 'spd'    ? 'selected' : ''}>Trier : Agilité</option>
      </select>
    `;
  }

  /** Barre de filtres pour l'inventaire d'équipement (recherche, rareté, seuil de stat) */
  function _renderEquipFilterBar(prefix, filters) {
    return `
      <div class="filter-bar">
        <input type="text" class="search-input" id="${prefix}-search" placeholder="Rechercher un nom..." value="${filters.search || ''}">
        <select class="sort-select" id="${prefix}-filter-rarity">
          <option value="">Toutes raretés</option>
          ${RARITY_ORDER.map(r => `<option value="${r}" ${filters.rarity === r ? 'selected' : ''}>${RARITY_LABELS_FR[r]}</option>`).join('')}
        </select>
        <div class="stat-filter-group">
          <select class="sort-select" id="${prefix}-filter-statkey">
            <option value="hp"  ${filters.statKey === 'hp'  ? 'selected' : ''}>PV ≥</option>
            <option value="atk" ${filters.statKey === 'atk' ? 'selected' : ''}>ATK ≥</option>
            <option value="def" ${filters.statKey === 'def' ? 'selected' : ''}>DEF ≥</option>
            <option value="spd" ${filters.statKey === 'spd' ? 'selected' : ''}>Vitesse ≥</option>
          </select>
          <input type="number" class="search-input stat-filter-input" id="${prefix}-filter-statmin" placeholder="min." value="${filters.statMin || ''}">
        </div>
      </div>
    `;
  }

  function _bindEquipFilterBar(prefix, filters, onChange) {
    document.getElementById(`${prefix}-search`)?.addEventListener('input', e => { filters.search = e.target.value; onChange(); });
    document.getElementById(`${prefix}-filter-rarity`)?.addEventListener('change', e => { filters.rarity = e.target.value; onChange(); });
    document.getElementById(`${prefix}-filter-statkey`)?.addEventListener('change', e => { filters.statKey = e.target.value; onChange(); });
    document.getElementById(`${prefix}-filter-statmin`)?.addEventListener('input', e => { filters.statMin = e.target.value; onChange(); });
  }

  /** Rafraîchit la grille de l'onglet d'équipement actif (filtré par slot, trié, filtré) */
  /**
   * Regroupe une liste d'exemplaires d'équipement par equipId pour gagner de la
   * place dans l'inventaire : les exemplaires NON équipés et identiques sont
   * fusionnés en une seule "pile" avec un compteur. Les exemplaires déjà équipés
   * restent affichés individuellement (chacun a un porteur distinct à montrer).
   * @param {Array<{invInst, def}>} items
   * @returns {Array<{invInst, def, instances:Array, count:number, stacked:boolean}>}
   */
  function _groupEquipStacks(items) {
    // On groupe par equipId ET par niveau (deux exemplaires du même objet mais
    // de niveau différent ont des stats différentes : ne jamais les confondre
    // dans une même pile), qu'ils soient équipés ou non.
    const groups = {};
    items.forEach(({ invInst, def }) => {
      const key = `${def.id}__${invInst.level ?? 'mythic'}`;
      if (!groups[key]) groups[key] = { def, instances: [] };
      groups[key].instances.push(invInst);
    });
    return Object.values(groups).map(group => {
      // Préférer un exemplaire NON équipé comme représentant du groupe (plus utile
      // par défaut pour l'action "cliquer pour équiper" depuis une pile) ; à défaut,
      // le premier exemplaire trouvé.
      const representative = group.instances.find(i => !i.equippedBy) || group.instances[0];
      return {
        invInst:   representative,
        def:       group.def,
        instances: group.instances,
        count:     group.instances.length,
        stacked:   group.instances.length > 1,
      };
    });
  }

  /**
   * Rafraîchit la grille de l'onglet d'équipement actif (filtré par slot, trié,
   * filtré). Quand un slot compatible est ouvert pour le personnage sélectionné,
   * les items meilleurs que celui actuellement équipé sont mis en valeur
   * (classe is-upgrade) et la grille devient directement cliquable pour équiper.
   */
  function _refreshEquipInvGrid() {
    const state = WBGameState.get();
    const grid = document.getElementById('equip-inv-grid');
    if (!grid) return;

    const inv = state.player.equipInventory || [];
    const decoratedAll = inv.map(invInst => {
      const def = state.equipment.find(e => e.id === invInst.equipId);
      if (!def) return null;
      return { invInst, def };
    }).filter(Boolean).filter(({ def }) => WBGameDatabase.resolveEquipSlot(def) === _equipInvTab);

    const grouped  = _groupEquipStacks(decoratedAll);
    const filtered = _applyEquipFilters(grouped, _equipInvFilters[_equipInvTab]);
    const sorted   = _sortEquipInv(filtered, _equipInvSort[_equipInvTab]);

    if (sorted.length === 0) {
      grid.innerHTML = `<p class="empty-msg" style="margin:0;padding:.8rem">${decoratedAll.length === 0 ? `Aucun ${EQUIP_SLOT_LABELS[_equipInvTab].replace(/^\S+\s/, '').toLowerCase()} en stock.<br>Utilisez le Défilé d'Équipements !` : 'Aucun équipement ne correspond aux filtres.'}</p>`;
      return;
    }

    // Le slot ouvert (le cas échéant) correspond-il à l'onglet inventaire actif ?
    // Si oui, la grille devient cliquable pour équiper directement, avec mise en
    // évidence des améliorations par rapport à l'équipement actuel.
    const inst = _equipCharId ? WBGameState.getPlayerChar(_equipCharId) : null;
    const slotMatchesOpenSlot = !!(inst && _equipSlotOpen !== null && EQUIP_SLOT_ORDER[_equipSlotOpen] === _equipInvTab);
    let currentDef = null;
    let currentEntry = null;
    if (slotMatchesOpenSlot) {
      const currentInvId = inst.equipment?.[_equipSlotOpen] || null;
      currentEntry = currentInvId ? state.player.equipInventory.find(ei => ei.instanceId === currentInvId) : null;
      currentDef = currentEntry ? state.equipment.find(e => e.id === currentEntry.equipId) : null;
    }

    grid.innerHTML = sorted.map(({ invInst, def, count, stacked }) => {
      const holder = !stacked ? _describeEquippedBy(invInst.equippedBy) : null;
      const usedElsewhere = !stacked && invInst.equippedBy && invInst.equippedBy !== _equipCharId;
      const isUpgrade = slotMatchesOpenSlot && !usedElsewhere && (!currentDef || _itemScore(def, invInst) > _itemScore(currentDef, currentEntry));
      const clickable = slotMatchesOpenSlot && !usedElsewhere;
      return `
        <div class="equip-inv-card rarity-${def.rarity} ${isUpgrade ? 'is-upgrade' : ''}"
             data-inst-id="${invInst.instanceId}" data-equip-id="${def.id}"
             ${clickable ? 'style="cursor:pointer"' : ''}>
          ${count > 1 ? `<div class="equip-inv-stack-badge">×${count}</div>` : ''}
          ${invInst.level != null ? `<div class="equip-inv-level">Niv. ${invInst.level}</div>` : ''}
          <div class="equip-inv-name">${def.name}</div>
          <div class="equip-inv-bonuses">${_formatEquipBonuses(_scaledEquipBonuses(def, invInst))}</div>
          ${isUpgrade ? '<div class="equip-upgrade-hint">⬆ Amélioration</div>' : ''}
          ${holder ? `
            <div class="equip-inv-holder" title="Équipé par ${holder.name}">
              <span class="equip-inv-holder-portrait">${holder.portrait ? `<img src="${holder.portrait}" alt="${holder.name}">` : holder.name.charAt(0)}</span>
              <span class="equip-inv-holder-name">${holder.name}</span>
            </div>` : ''}
        </div>`;
    }).join('');

    if (slotMatchesOpenSlot) {
      grid.querySelectorAll('.equip-inv-card').forEach(card => {
        const entry = inv.find(ei => ei.instanceId === card.dataset.instId);
        if (entry?.equippedBy && entry.equippedBy !== _equipCharId) return; // utilisé ailleurs : non cliquable
        card.addEventListener('click', () => _equipFromGrid(card.dataset.instId));
      });
    }
  }

  /** Équipe un exemplaire directement depuis la grille d'inventaire (slot ouvert correspondant) */
  function _equipFromGrid(invInstanceId) {
    if (!_equipCharId || _equipSlotOpen === null) return;
    const result = WBGameState.equipItem(_equipCharId, _equipSlotOpen, invInstanceId);
    if (result?.success) {
      _showToast('Équipement posé !', 'success');
    } else {
      _showToast("Cet équipement est déjà porté par un autre personnage.", 'error');
    }
    _clearAutoEquipResult();
    _equipSlotOpen = null;
    _refreshEquipCharPicker();
    _refreshEquipSlots();
    _refreshEquipSlotPanel();
    _refreshEquipInvGrid();
  }

  /** Construit le HTML des 3 slots d'équipement pour un personnage */
  function _buildEquipSlots(instanceId, state) {
    const inst = WBGameState.getPlayerChar(instanceId);
    if (!inst) return '';
    const def = WBGameState.getCharDef(inst.charId);

    const slotsHtml = EQUIP_SLOT_ORDER.map((slotKey, slot) => {
      const invId    = inst.equipment?.[slot] || null;
      const invEntry = invId ? state.player.equipInventory.find(ei => ei.instanceId === invId) : null;
      const eqDef    = invEntry ? state.equipment.find(e => e.id === invEntry.equipId) : null;
      const rarityDef = eqDef ? (WBGameDatabase.RARITIES[eqDef.rarity] || {}) : {};
      return `
        <div class="equip-slot-card ${eqDef ? 'filled' : ''} ${_equipSlotOpen === slot ? 'active' : ''}" data-slot="${slot}" style="${eqDef ? `border-top:3px solid ${rarityDef.color || '#888'}` : ''}">
          <span class="equip-slot-label">${EQUIP_SLOT_LABELS[slotKey]}</span>
          ${eqDef ? `
            <span class="equip-slot-name">${eqDef.name}</span>
            <span class="equip-slot-bonuses">${_formatEquipBonuses(eqDef.bonuses)}</span>
            <button class="equip-remove-btn" data-slot="${slot}" data-iid="${instanceId}">Retirer</button>
          ` : `<span style="color:var(--text-faint);font-size:.75rem">Vide — Cliquer pour équiper</span>`}
        </div>`;
    }).join('');

    const rarityDef = WBGameDatabase.RARITIES[def.rarity] || {};
    return `
      <div class="equip-section">
        <div class="equip-section-title" style="display:flex;align-items:center;gap:8px">
          <span style="color:${rarityDef.color}">${def.name}</span>
          <span style="color:var(--text-faint);font-size:.7rem">Niv.${inst.level}</span>
        </div>
        <div class="equip-slots-row" id="equip-slots-row">
          ${slotsHtml}
        </div>
      </div>`;
  }

  /** Rafraîchit la zone des 3 slots d'équipement du personnage sélectionné, et lie leurs interactions */
  function _refreshEquipSlots() {
    const container = document.getElementById('equip-slots-section');
    if (!container) return;
    const state = WBGameState.get();

    container.innerHTML = _equipCharId
      ? _buildEquipSlots(_equipCharId, state)
      : '<p class="empty-msg" style="margin:0;padding:1rem">Sélectionne un personnage ci-dessus.</p>';

    container.querySelectorAll('.equip-slot-card').forEach(card => {
      card.addEventListener('click', () => {
        const slot = parseInt(card.dataset.slot);
        if (isNaN(slot) || !_equipCharId) return;
        _clearAutoEquipResult();
        _equipSlotOpen   = (_equipSlotOpen === slot) ? null : slot;
        _equipSlotSearch = '';
        _refreshEquipSlots();
        _refreshEquipSlotPanel();
        _refreshEquipInvGrid();
      });
    });

    container.querySelectorAll('.equip-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const slot = parseInt(btn.dataset.slot);
        WBGameState.equipItem(btn.dataset.iid, slot, null);
        _clearAutoEquipResult();
        _refreshEquipSlots();
        _refreshEquipCharPicker();
        _refreshEquipSlotPanel();
        _refreshEquipInvGrid();
      });
    });
  }

  /**
   * Construit la ligne de comparaison "ATK +20 → +45 (▲25)" entre l'équipement
   * actuellement porté dans le slot et un candidat. Vide si rien n'est équipé
   * actuellement (rien à comparer).
   */
  function _buildEquipCompareHtml(currentDef, candidateDef) {
    if (!currentDef) return '';
    const keys = ['hp', 'atk', 'def', 'spd'];
    const lines = keys.map(k => {
      const cur  = currentDef.bonuses?.[k] || 0;
      const next = candidateDef.bonuses?.[k] || 0;
      if (cur === 0 && next === 0) return '';
      const diff = next - cur;
      const cls  = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
      const diffText = diff !== 0 ? ` (${diff > 0 ? '▲' : '▼'}${Math.abs(diff)})` : '';
      return `<span class="${cls}">${k.toUpperCase()} ${cur >= 0 ? '+' : ''}${cur} → ${next >= 0 ? '+' : ''}${next}${diffText}</span>`;
    }).filter(Boolean);
    return lines.length ? `<div class="equip-compare">${lines.join('<br>')}</div>` : '';
  }

  /**
   * Rafraîchit le panneau inline de sélection d'équipement (remplace l'ancien
   * modal). Affiché sous les slots quand _equipSlotOpen n'est pas null.
   */
  function _refreshEquipSlotPanel() {
    const container = document.getElementById('equip-slot-panel-container');
    if (!container) return;

    if (_equipSlotOpen === null || !_equipCharId) {
      container.innerHTML = '';
      return;
    }

    const state = WBGameState.get();
    const inst  = WBGameState.getPlayerChar(_equipCharId);
    if (!inst) { container.innerHTML = ''; return; }

    const slot    = _equipSlotOpen;
    const slotKey = EQUIP_SLOT_ORDER[slot];
    const currentInvId = inst.equipment?.[slot] || null;
    const currentEntry = currentInvId ? state.player.equipInventory.find(ei => ei.instanceId === currentInvId) : null;
    const currentDef   = currentEntry ? state.equipment.find(e => e.id === currentEntry.equipId) : null;

    const inv = (state.player.equipInventory || []).filter(ei => {
      const ed = state.equipment.find(e => e.id === ei.equipId);
      return ed && WBGameDatabase.resolveEquipSlot(ed) === slotKey;
    });
    const decorated = inv.map(ei => {
      const ed = state.equipment.find(e => e.id === ei.equipId);
      return ed ? { invInst: ei, def: ed } : null;
    }).filter(Boolean);
    const grouped = _groupEquipStacks(decorated);

    // Recherche, et on omet entièrement les exemplaires utilisés par un AUTRE
    // personnage (sans valeur ajoutée dans ce flux, contrairement à l'ancien modal).
    const q = _equipSlotSearch.trim().toLowerCase();
    const available = grouped.filter(({ invInst, def, stacked }) => {
      if (q && !def.name.toLowerCase().includes(q)) return false;
      const isCurrent = !stacked && invInst.instanceId === currentInvId;
      const usedElsewhere = !stacked && invInst.equippedBy && invInst.equippedBy !== _equipCharId && !isCurrent;
      return !usedElsewhere;
    });

    const itemsHtml = available.map(({ invInst, def, count, stacked }) => {
      const isCurrent = !stacked && invInst.instanceId === currentInvId;
      return `
        <div class="equip-inv-card rarity-${def.rarity} ${isCurrent ? 'current-equip' : ''}"
             data-inst-id="${invInst.instanceId}"
             style="${isCurrent ? 'opacity:.5;pointer-events:none' : 'cursor:pointer'}">
          ${count > 1 ? `<div class="equip-inv-stack-badge">×${count}</div>` : ''}
          ${invInst.level != null ? `<div class="equip-inv-level">Niv. ${invInst.level}</div>` : ''}
          <div class="equip-inv-name">${def.name}</div>
          <div class="equip-inv-bonuses">${_formatEquipBonuses(_scaledEquipBonuses(def, invInst))}</div>
          ${isCurrent ? '<div style="font-size:.62rem;color:var(--accent);margin-top:4px">Actuellement équipé</div>' : _buildEquipCompareHtml(currentDef, def)}
        </div>`;
    }).join('');

    container.innerHTML = `
      <div class="equip-slot-panel" id="equip-slot-panel">
        <div class="equip-slot-panel-header">
          <strong>Choisir : ${EQUIP_SLOT_LABELS[slotKey]}</strong>
          <button class="modal-close" id="equip-slot-panel-close">✕</button>
        </div>
        <input type="text" class="search-input" id="equip-slot-search" placeholder="Rechercher un nom..." value="${_equipSlotSearch}" style="width:100%;margin-bottom:10px;box-sizing:border-box;">
        <div class="equip-inv-grid">
          <div class="equip-inv-card equip-empty-card" id="equip-slot-empty-card" ${!currentInvId ? 'style="opacity:.5;pointer-events:none"' : 'style="cursor:pointer"'}>
            <div class="equip-inv-name">— Vide —</div>
            <div class="equip-inv-bonuses">Retirer l'équipement de ce slot</div>
          </div>
          ${itemsHtml || '<p class="empty-msg" style="margin:0;padding:.8rem">Aucun équipement disponible.</p>'}
        </div>
      </div>
    `;

    document.getElementById('equip-slot-panel-close')?.addEventListener('click', () => {
      _equipSlotOpen = null;
      _refreshEquipSlots();
      _refreshEquipSlotPanel();
      _refreshEquipInvGrid();
    });

    document.getElementById('equip-slot-search')?.addEventListener('input', e => {
      _equipSlotSearch = e.target.value;
      _refreshEquipSlotPanel();
    });

    document.getElementById('equip-slot-empty-card')?.addEventListener('click', () => {
      WBGameState.equipItem(_equipCharId, slot, null);
      _clearAutoEquipResult();
      _equipSlotOpen = null;
      _refreshEquipSlots();
      _refreshEquipCharPicker();
      _refreshEquipSlotPanel();
      _refreshEquipInvGrid();
    });

    container.querySelectorAll('.equip-inv-card[data-inst-id]:not(.equip-empty-card)').forEach(card => {
      card.addEventListener('click', () => {
        const result = WBGameState.equipItem(_equipCharId, slot, card.dataset.instId);
        if (result?.success) {
          _showToast('Équipement posé !', 'success');
        } else {
          _showToast("Cet équipement est déjà porté par un autre personnage.", 'error');
        }
        _clearAutoEquipResult();
        _equipSlotOpen = null;
        _refreshEquipSlots();
        _refreshEquipCharPicker();
        _refreshEquipSlotPanel();
        _refreshEquipInvGrid();
      });
    });
  }

  // ─── GACHA ÉQUIPEMENTS ────────────────────────────────────────────────────────

  /** Effectue un tirage de gacha d'équipement */
  function _doEquipGachaPull(bannerId, count) {
    const state  = WBGameState.get();
    const banner = (state.equipBanners || []).find(b => b.id === bannerId);
    if (!banner) return;

    const cost   = count === 1 ? banner.singlePullCost : banner.tenPullCost;
    const player = WBGameState.getPlayer();
    if ((player.currency.gold || 0) < cost) {
      _showToast('Dollars insuffisants !', 'error');
      return;
    }

    document.querySelectorAll('.btn-equip-pull').forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });

    WBGameState.modifyResources({ gold: -cost });

    const results = [];
    for (let i = 0; i < count; i++) {
      results.push(_rollEquipPull(banner, state));
    }

    _updateHUD();
    WBGameState.trackQuestProgress('summon_equipment', count);
    _showEquipResults(results, () => {
      document.querySelectorAll('.btn-equip-pull').forEach(b => { b.disabled = false; b.style.opacity = ''; });
    });
  }

  /** Tire un équipement aléatoire selon les taux de la bannière */
  function _rollEquipPull(banner, state) {
    const rarity = _rollEquipRarity(banner);
    const pool   = state.equipment.filter(e => e.rarity === rarity);
    const def    = pool.length > 0
      ? pool[Math.floor(Math.random() * pool.length)]
      : state.equipment[Math.floor(Math.random() * state.equipment.length)];

    if (!def) return null;

    const instance = {
      instanceId: `einst_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      equipId:    def.id,
      level:      WBGameDatabase.rollEquipLevel(def.rarity),
      obtainedAt: Date.now(),
      equippedBy: null,
    };

    const p = WBGameState.getPlayer();
    const updatedInv = [...(p.equipInventory || []), instance];
    WBGameState.updatePlayer({ equipInventory: updatedInv });

    return { equip: def, instance };
  }

  /** Tire une rareté selon les dropRates de la bannière */
  function _rollEquipRarity(banner) {
    const rates = banner.dropRates || {};
    const roll  = Math.random() * 100;
    let cum     = 0;
    const order = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
    for (const r of order) {
      cum += (rates[r] || 0);
      if (roll < cum) return r;
    }
    return 'common';
  }

  /** Affiche les résultats du gacha équipement sous forme de cartes */
  function _showEquipResults(results, onDone) {
    const el = document.getElementById('gacha-results');
    if (!el) { onDone?.(); return; }

    el.innerHTML = `
      <div class="equip-result-grid">
        ${results.filter(Boolean).map((r, i) => {
          const delay     = i * 80;
          return `
            <div class="equip-result-card rarity-${r.equip.rarity}" style="animation-delay:${delay}ms">
              <div class="equip-result-icon">⚙️</div>
              <div class="equip-result-name">${r.equip.name}</div>
              <div class="equip-result-bonuses">${_formatEquipBonuses(r.equip.bonuses)}</div>
            </div>`;
        }).join('')}
      </div>`;

    el.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => onDone?.(), results.length * 80 + 400);
  }

  // ─── INVENTAIRE ─────────────────────────────────────────────────────────────

  let _inventoryTargetItemId = null; // objet en attente de cible (effet level_up)

  /** Affiche l'écran Inventaire : regroupe tous les objets possédés avec un bouton Utiliser */
  function renderInventory() {
    const el = document.getElementById('screen-inventory');
    if (!el) return;
    const state  = WBGameState.get();
    const player = state.player;
    const effectTypes = WBGameDatabase.ITEM_EFFECT_TYPES;

    const rows = state.items.map(it => {
      const qty = player.inventory?.[it.id] || 0;
      const eff = it.effect && effectTypes[it.effect.type];
      const effDesc = eff ? `${eff.label} ×${it.effect.amount}` : 'Sans effet';
      const energyFull = it.effect?.type === 'energy_regen' && player.energy.current >= player.energy.max;
      const disabled = qty < 1 || !eff || energyFull;
      return `
        <div class="item-section ${qty < 1 ? 'item-section-empty' : ''}">
          <div class="item-info">
            <span class="item-icon">${it.icon || '📦'}</span>
            <div>
              <div class="item-name">${it.name}</div>
              <div class="item-desc">${it.description || effDesc}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="item-count">×${qty}</span>
            <button class="btn-item-use" data-item-id="${it.id}" ${disabled ? 'disabled' : ''}>Utiliser</button>
          </div>
        </div>
        ${energyFull ? '<p style="font-size:.72rem;color:var(--text-faint);margin:4px 0 0;text-align:center">Énergie déjà au maximum</p>' : ''}
      `;
    }).join('');

    el.innerHTML = `
      <div class="screen-header"><h2>🎒 Inventaire</h2>${_helpBtn('inventory')}</div>
      ${rows || '<p class="empty-msg">Aucun objet pour le moment.</p>'}
    `;

    el.querySelectorAll('.btn-item-use').forEach(btn => {
      btn.addEventListener('click', () => _handleUseItem(btn.dataset.itemId));
    });
  }

  /** Déclenche l'utilisation d'un objet : applique l'effet directement, ou ouvre le sélecteur de créature si besoin */
  function _handleUseItem(itemId) {
    const state = WBGameState.get();
    const itemDef = state.items.find(i => i.id === itemId);
    if (!itemDef?.effect) return;
    const effDef = WBGameDatabase.ITEM_EFFECT_TYPES[itemDef.effect.type];

    if (effDef?.requiresTarget) {
      _openItemTargetModal(itemId);
    } else {
      _applyItemEffect(itemId, null);
    }
  }

  /** Ouvre une fenêtre de sélection de créature pour un objet ciblé (ex: Up de Lvl) */
  function _openItemTargetModal(itemId) {
    const state = WBGameState.get();
    const itemDef = state.items.find(i => i.id === itemId);
    const modal = document.getElementById('modal');
    if (!itemDef || !modal) return;

    const cards = state.player.collection.map(inst => {
      const def = WBGameState.getCharDef(inst.charId);
      if (!def) return '';
      const rarityDef = WBGameDatabase.RARITIES[def.rarity] || {};
      return `
        <div class="equip-char-mini" data-iid="${inst.instanceId}" style="border-top:3px solid ${rarityDef.color || '#888'}">
          ${def.portrait
            ? `<img src="${def.portrait}" alt="${def.name}" style="width:48px;height:48px;border-radius:6px;object-fit:cover;display:block;margin:0 auto 4px">`
            : `<div class="portrait-ph" style="width:48px;height:48px;border-radius:6px;margin:0 auto 4px;font-size:1.2rem">${def.name.charAt(0)}</div>`}
          <div class="equip-char-mini-name">${def.name}</div>
          <div class="equip-char-mini-level">Niv.${inst.level}</div>
        </div>`;
    }).join('');

    modal.style.display = 'block';
    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-box">
          <button class="modal-close" id="modal-close">✕</button>
          <h3 style="font-family:var(--font-display);margin:0 0 4px">${itemDef.icon || '📦'} ${itemDef.name}</h3>
          <p style="font-size:.8rem;color:var(--text-dim);margin:0 0 14px">Choisis la créature à cibler.</p>
          <div class="equip-char-picker">
            ${cards || '<p class="empty-msg" style="margin:0;padding:.5rem">Aucune créature dans la collection.</p>'}
          </div>
        </div>
      </div>
    `;

    modal.querySelectorAll('.equip-char-mini').forEach(card => {
      card.addEventListener('click', () => {
        _closeModal();
        _applyItemEffect(itemId, card.dataset.iid);
      });
    });
    document.getElementById('modal-close')?.addEventListener('click', _closeModal);
    document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') _closeModal();
    });
  }

  /** Applique réellement l'effet d'un objet (après confirmation/sélection de cible le cas échéant) */
  function _applyItemEffect(itemId, targetInstanceId) {
    const state = WBGameState.get();
    const itemDef = state.items.find(i => i.id === itemId);
    const result = WBGameState.useItem(itemId, targetInstanceId);

    if (!result.success) {
      const messages = {
        no_stock: "Tu n'as plus cet objet.",
        target_required: 'Sélectionne une créature.',
        energy_full: 'Énergie déjà au maximum.',
        no_effect: 'Cet objet ne fait rien pour le moment.',
      };
      _showToast(messages[result.reason] || 'Action impossible.', 'error');
      return;
    }

    if (itemDef.effect.type === 'level_up') {
      const inst = WBGameState.getPlayerChar(targetInstanceId);
      const def  = inst ? WBGameState.getCharDef(inst.charId) : null;
      WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.levelUp);
      if (result.evolved) {
        setTimeout(() => _showEvolutionShowcase([result.evolved]), 350);
      }
      _showToast(`${def?.name || 'La créature'} est passée au niveau ${result.finalLevel} ! ${itemDef.icon || ''}`, 'success');
    } else if (itemDef.effect.type === 'energy_regen') {
      _showToast(`+${result.energyGained} ⚡ Énergie ! ${itemDef.icon || ''}`, 'success');
    }

    if (_currentScreen === 'inventory') renderInventory();
    if (_currentScreen === 'equip') renderEquip();
  }

  // ─── BOUTIQUE ───────────────────────────────────────────────────────────────────

  let _shopTab = 'character'; // 'character' | 'equipment' | 'item'

  /** Affiche l'écran Boutique : articles à vendre, groupés par type, payables en or ou diamants */
  function renderShop() {
    const el = document.getElementById('screen-shop');
    if (!el) return;
    const state    = WBGameState.get();
    const player   = state.player;
    const ev       = WBGameState.getActiveEvent();
    const discount = ev?.shopDiscount ?? 0;
    const tag      = ev ? (state.tags?.find(t => t.id === ev.tagId)) : null;

    const resolveRef = (l) => {
      if (l.kind === 'character') return state.characters.find(c => c.id === l.refId);
      if (l.kind === 'equipment') return state.equipment.find(e => e.id === l.refId);
      if (l.kind === 'item')      return state.items.find(i => i.id === l.refId);
      return null;
    };

    const makeCard = (l, overridePrice) => {
      const ref = resolveRef(l);
      if (!ref) return '';
      const priceToUse   = overridePrice ?? l.price;
      const currencyIcon = l.currency === 'crystals' ? '💧' : '💵';
      const balance      = player.currency[l.currency === 'crystals' ? 'crystals' : 'gold'] || 0;
      const canAfford    = balance >= priceToUse;
      const rarityDef    = l.kind !== 'item' ? (WBGameDatabase.RARITIES[ref.rarity] || {}) : {};
      const icon         = l.kind === 'item'      ? (ref.icon || '📦')
                          : l.kind === 'equipment' ? (EQUIP_SLOT_ICON[ref.slot] || '⚙️')
                          : null;
      const isDiscounted = overridePrice != null;

      return `
        <div class="shop-card" data-listing-id="${l.id}" data-price-override="${isDiscounted ? priceToUse : ''}">
          <div class="shop-card-portrait" style="${rarityDef.color ? `border-color:${rarityDef.color}` : ''}">
            ${icon ? `<span style="font-size:1.8rem">${icon}</span>`
              : ref.portrait ? `<img src="${ref.portrait}" alt="${ref.name}">`
              : `<div class="portrait-ph">${ref.name.charAt(0)}</div>`}
          </div>
          <div class="shop-card-name">${ref.name}</div>
          ${(rarityDef.name && l.kind !== 'equipment') ? `<div class="shop-card-rarity" style="color:${rarityDef.color}">${rarityDef.name}</div>` : ''}
          ${isDiscounted ? `<div class="shop-price-old">${l.price.toLocaleString()} ${currencyIcon}</div>` : ''}
          <button class="btn-shop-buy" data-listing-id="${l.id}" data-price-override="${isDiscounted ? priceToUse : ''}" ${canAfford ? '' : 'disabled'}>
            ${priceToUse.toLocaleString()} ${currencyIcon}${isDiscounted ? ' <span class="shop-discount-badge">-'+discount+'%</span>' : ''}
          </button>
        </div>`;
    };

    const allListings = state.shopListings.filter(l => l.enabled !== false);

    // Ligne 1 — Objets permanents : Pilule de Prestige + Potion du Désir (par tag item)
    const permanentItems = allListings.filter(l =>
      l.kind === 'item' && (l.permanent === true || l.tags?.includes('permanent'))
    );

    // Ligne 2 — Personnages du tag event avec réduction
    const eventChars = ev ? allListings.filter(l => {
      if (l.kind !== 'character') return false;
      const ref = resolveRef(l);
      return ref?.tags?.includes(ev.tagId) && ref.evolutionStage === 0;
    }) : [];
    const line2Ids = new Set(eventChars.map(l => l.id));
    const perm2Ids = new Set(permanentItems.map(l => l.id));

    // Ligne 3 — 9 objets aléatoires rotatifs (hors ligne 1 et 2)
    const rotatingListings = WBGameState.getRotatingShopListings().filter(l =>
      !line2Ids.has(l.id) && !perm2Ids.has(l.id)
    );

    const line1Html = permanentItems.length
      ? permanentItems.map(l => makeCard(l)).join('')
      : '<p class="empty-msg" style="font-size:.8rem">Aucun objet permanent disponible.</p>';

    const line2Html = ev
      ? (eventChars.length
        ? eventChars.map(l => {
            const discountedPrice = Math.max(1, Math.round(l.price * (1 - discount / 100)));
            return makeCard(l, discountedPrice);
          }).join('')
        : `<p class="empty-msg" style="font-size:.8rem">Aucun personnage ${tag?.name || 'Event'} disponible.</p>`)
      : '';

    const line3Html = rotatingListings.length
      ? rotatingListings.map(l => makeCard(l)).join('')
      : '<p class="empty-msg" style="font-size:.8rem">Boutique en cours de réapprovisionnement...</p>';

    el.innerHTML = `
      <div class="screen-header"><h2>🛍️ Shopping</h2>${_helpBtn('shop')}</div>
      ${ev ? `<div class="event-shop-banner">
        ✨ Event ${tag?.name || ''} — Réduction de ${discount}% sur les créatures du tag !
      </div>` : ''}

      <div class="shop-section-label shop-label-permanent">💊 Disponible en permanence</div>
      <div class="shop-grid shop-grid-permanent">${line1Html}</div>

      ${ev ? `
      <div class="shop-section-label shop-label-event">✨ Créatures Event ${tag?.name || ''} — Offre limitée</div>
      <div class="shop-grid shop-grid-event">${line2Html}</div>` : ''}

      <div class="shop-section-label shop-label-rotating">🔄 Sélection du moment</div>
      <div class="shop-grid">${line3Html}</div>
    `;

    el.querySelectorAll('.btn-shop-buy').forEach(btn => {
      btn.addEventListener('click', () => {
        const override = btn.dataset.priceOverride ? parseInt(btn.dataset.priceOverride) : null;
        _purchaseListing(btn.dataset.listingId, override);
      });
    });
  }

  function _purchaseListing(listingId, priceOverride) {
    const state = WBGameState.get();
    const listing = state.shopListings.find(l => l.id === listingId);
    if (!listing) return;
    // Appliquer le prix surchargé (réduction event) si fourni
    const effectiveListing = priceOverride != null ? { ...listing, price: priceOverride } : listing;
    const result = WBGameState.purchaseShopListing(listingId, priceOverride);

    if (!result.success) {
      const messages = {
        unavailable: 'Cet article n\'est plus disponible.',
        insufficient_funds: 'Fonds insuffisants.',
      };
      _showToast(messages[result.reason] || 'Achat impossible.', 'error');
      return;
    }

    let label = '';
    if (result.kind === 'character') label = result.result?.isNew ? 'Nouvelle créature obtenue !' : 'Renforcement +1 !';
    else if (result.kind === 'equipment') label = 'Équipement obtenu !';
    else if (result.kind === 'item') label = 'Objet obtenu !';
    _showToast(`✅ ${label}`, 'success');

    renderShop();
  }

  // ─── QUÊTES QUOTIDIENNES & RÉCOMPENSE DE CONNEXION ─────────────────────────────

  /** Date du jour au format YYYY-MM-DD (heure locale), pour comparer aux dates stockées côté joueur */
  function _todayStringUI() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Formate une récompense générique en texte lisible (ou compact, pour les petites puces) */
  function _formatRewardLabel(reward, state, compact = false) {
    if (!reward) return '?';
    if (Array.isArray(reward)) {
      return reward.map(r => _formatRewardLabel(r, state, compact)).join(compact ? ' ' : ' + ');
    }
    if (reward.type === 'gold') return `${reward.amount} 💵`;
    if (reward.type === 'crystals') return `${reward.amount} 💧`;
    if (reward.type === 'item') {
      const def = state.items.find(i => i.id === reward.refId);
      return compact ? `${def?.icon || '🎒'}×${reward.amount}` : `${def?.name || 'Objet'} ×${reward.amount}`;
    }
    if (reward.type === 'equipment') {
      const def = state.equipment.find(e => e.id === reward.refId);
      return compact ? `⚔️×${reward.amount}` : `${def?.name || 'Équipement'} ×${reward.amount}`;
    }
    if (reward.type === 'character') {
      const def = state.characters.find(c => c.id === reward.refId);
      return compact ? `🧝×${reward.amount}` : `${def?.name || 'Créature'} ×${reward.amount}`;
    }
    return '?';
  }

  /** Affiche l'écran Quêtes : récompenses de connexion (cycles actifs) + 3 quêtes du jour */
  // ─── CLASSEMENTS ──────────────────────────────────────────────────────────────

  let _leaderboardTab = 'aura_total'; // 'aura_total' | 'tournee_progress' | 'gallery_entries'

  const LEADERBOARD_TABS = [
    { col: 'aura_total',       label: '⭐ Attrait', unit: '⭐' },
    { col: 'tournee_progress', label: '🌍 Expédition', unit: '🌍 Niv.' },
    { col: 'gallery_entries',  label: '📚 Encyclopédie', unit: '📚' },
    { col: 'trophy_best_score', label: '🎯 Traque', unit: '🎯' },
  ];

  function renderLeaderboard() {
    const el = document.getElementById('screen-leaderboard');
    if (!el) return;
    el.innerHTML = `
      <div class="screen-header"><h2>🏆 Classements</h2></div>
      <div class="lb-tabs">
        ${LEADERBOARD_TABS.map(t => `
          <button class="lb-tab ${_leaderboardTab === t.col ? 'active' : ''}" data-col="${t.col}">${t.label}</button>
        `).join('')}
      </div>
      <div id="leaderboard-list"><p class="empty-msg">⏳ Chargement du classement...</p></div>
    `;
    el.querySelectorAll('.lb-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _leaderboardTab = btn.dataset.col;
        renderLeaderboard();
      });
    });
    _loadLeaderboardList(_leaderboardTab);
  }

  async function _loadLeaderboardList(column) {
    const rows = await WBBackend.loadLeaderboard(column, 100);
    const listEl = document.getElementById('leaderboard-list');
    if (!listEl) return; // le joueur a changé d'écran pendant le chargement

    if (rows.length === 0) {
      listEl.innerHTML = `<p class="empty-msg">Personne au classement pour l'instant.</p>`;
      return;
    }

    const myUserId  = WBBackend.getCurrentUserId?.();
    const tabConfig = LEADERBOARD_TABS.find(t => t.col === column);

    listEl.innerHTML = `<div class="lb-list">` + rows.map((r, i) => {
      const rank  = i + 1;
      const isMe  = r.user_id === myUserId;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
      const value = r[column] ?? 0;
      return `
        <div class="lb-row ${isMe ? 'is-me' : ''}">
          <span class="lb-rank">${medal}</span>
          <span class="lb-name">${r.display_name || 'Joueur'}${isMe ? ' (toi)' : ''}</span>
          <span class="lb-value">${Number(value).toLocaleString('fr-FR')} ${tabConfig?.unit || ''}</span>
        </div>`;
    }).join('') + `</div>`;
  }


  function renderQuests() {
    const el = document.getElementById('screen-quests');
    if (!el) return;
    const state  = WBGameState.get();
    const player = state.player;
    const dq     = player.dailyQuestState || { activeQuestIds: [], progress: {}, claimed: {} };
    const ev     = WBGameState.getActiveEvent();
    const tag    = ev ? (state.tags?.find(t => t.id === ev.tagId)) : null;
    const today  = _todayStringUI();

    // ── Bloc Missions Event ──────────────────────────────────────────
    let eventBlockHtml = '';
    if (ev) {
      const quests = ev.questConfig?.quests || [];
      const questCards = quests.map((q, i) => {
        const progress = ev.questProgress?.[i] || 0;
        const claimed  = !!ev.questClaimed?.[i];
        const complete = progress >= q.target;
        const pct      = Math.min(100, Math.round((progress / q.target) * 100));
        const typeLabel = {
          event_defeat:       `⚔️ Éliminer ${q.target} rivales ${tag?.name || 'Event'}`,
          event_capture:      `🐾 Apprivoiser ${q.target} créatures ${tag?.name || 'Event'}`,
          event_win_caprice:  `🌟 Réussir ${q.target} Battue Sauvage`,
          event_win_tag:      `✨ Réussir ${q.target} combats ${tag?.name || 'Event'}`,
          event_win_with_tag: `🏅 Finir ${q.target} combats avec un perso ${tag?.name || 'Event'} vivant`,
          event_summon:       `💧 Rencontrer ${q.target} personnages sur la bannière ${tag?.name || 'Event'}`,
        }[q.type] || q.type;

        return `
          <div class="quest-card event-quest-card ${claimed ? 'quest-claimed' : complete ? 'quest-complete' : ''}">
            <div class="quest-card-name">${typeLabel}</div>
            <div class="quest-progress-bar-wrap">
              <div class="quest-progress-bar-fill" style="width:${pct}%"></div>
            </div>
            <div class="quest-progress-label">${progress} / ${q.target}</div>
            <div class="quest-reward-label">🎁 ${_formatRewardLabel(q.reward, state)}</div>
            <button class="btn-quest-claim btn-event-claim" data-event-quest-index="${i}" ${(!complete || claimed) ? 'disabled' : ''}>
              ${claimed ? '✓ Réclamée' : complete ? 'Réclamer' : 'En cours...'}
            </button>
          </div>`;
      }).join('');

      // Cycles de connexion EVENT (rituels sur 10 jours)
      const evCycles = ev.loginCycles || [];
      const evCyclesHtml = evCycles.filter(c => c.enabled !== false).map(c => {
        const prog = player.dailyLogin?.progress?.[c.id] || { currentDay: 1, lastClaimDate: null };
        const claimedToday = prog.lastClaimDate === today;
        const length = c.length || (c.rewards || []).length || 10;
        const daysHtml = Array.from({ length }, (_, i2) => {
          const day   = i2 + 1;
          const entry = (c.rewards || []).find(r => r.day === day);
          const isDone    = day < prog.currentDay || (day === prog.currentDay && claimedToday);
          const isCurrent = day === prog.currentDay && !claimedToday;
          const isLocked  = !isDone && !isCurrent;
          return `
            <div class="login-day-chip ${isCurrent?'current':''} ${isDone?'done':''} ${isLocked?'locked':''}">
              <div class="login-day-num">J${day}</div>
              <div class="login-day-reward">${entry ? _formatRewardLabel([entry.reward, entry.reward2].filter(Boolean), state, true) : '—'}</div>
              ${isDone ? '<div class="login-day-check">✓</div>' : ''}
              ${isLocked ? '<div class="login-day-lock">🔒</div>' : ''}
            </div>`;
        }).join('');
        return `
          <div class="login-cycle-card event-login-cycle">
            <div class="login-cycle-title">🗓️ ${c.name}</div>
            <div class="login-cycle-days">${daysHtml}</div>
            ${!claimedToday ? `
              <div class="daily-claim-zone" id="daily-claim-zone-${c.id}">
                <button class="btn-claim-daily-inline" data-cycle-id="${c.id}">🎁 Réclamer la récompense du jour</button>
              </div>` : ''}
          </div>`;
      }).join('');

      const countdown = Math.max(0, ev.endDate - Date.now());
      const d = Math.floor(countdown / 86400000);
      const h = Math.floor((countdown % 86400000) / 3600000);

      eventBlockHtml = `
        <div class="event-quests-block">
          <div class="event-quests-header">
            <div class="event-quests-title">✨ Missions Event — ${tag?.icon || ''}${tag?.name || 'Event'}</div>
            <div class="event-quests-countdown">⏳ ${d}j ${String(h).padStart(2,'0')}h restants</div>
          </div>
          ${evCyclesHtml ? `<div style="margin-bottom:12px">${evCyclesHtml}</div>` : ''}
          <div class="quest-cards-list">${questCards || '<p class="empty-msg">Aucune mission event configurée.</p>'}</div>
        </div>`;
    }

    // ── Quêtes quotidiennes ──────────────────────────────────────────
    const questCards = (dq.activeQuestIds || []).map(qid => {
      const questDef = state.dailyQuests.find(q => q.id === qid);
      if (!questDef) return '';
      const progress = dq.progress?.[qid] || 0;
      const claimed  = !!dq.claimed?.[qid];
      const complete = progress >= questDef.target;
      const pct = Math.min(100, Math.round((progress / questDef.target) * 100));
      return `
        <div class="quest-card ${claimed ? 'quest-claimed' : complete ? 'quest-complete' : ''}">
          <div class="quest-card-name">${questDef.name}</div>
          <div class="quest-progress-bar-wrap">
            <div class="quest-progress-bar-fill" style="width:${pct}%"></div>
          </div>
          <div class="quest-progress-label">${progress} / ${questDef.target}</div>
          <div class="quest-reward-label">🎁 ${_formatRewardLabel(questDef.reward, state)}</div>
          <button class="btn-quest-claim" data-quest-id="${qid}" ${(!complete || claimed) ? 'disabled' : ''}>
            ${claimed ? '✓ Réclamée' : complete ? 'Réclamer' : 'En cours...'}
          </button>
        </div>`;
    }).join('');

    // ── Rituels de connexion classiques ─────────────────────────────────────
    const activeCycles = (state.dailyLoginCycles || []).filter(c => c.enabled !== false);
    const cyclesHtml = activeCycles.length ? `
      <div class="equip-section-title" style="margin-top:12px">🎁 Rituels quotidiens</div>
      <div class="login-cycles-list">
        ${activeCycles.map(c => {
          const prog = player.dailyLogin?.progress?.[c.id] || { currentDay: 1, lastClaimDate: null };
          const claimedToday = prog.lastClaimDate === today;
          const length = c.length || (c.rewards || []).length || 1;
          const daysHtml = Array.from({ length }, (_, i) => {
            const day   = i + 1;
            const entry = (c.rewards || []).find(r => r.day === day);
            const isDone    = day < prog.currentDay || (day === prog.currentDay && claimedToday);
            const isCurrent = day === prog.currentDay && !claimedToday;
            const isLocked  = !isDone && !isCurrent;
            return `<div class="login-day-chip ${isCurrent?'current':''} ${isDone?'done':''} ${isLocked?'locked':''}">
              <div class="login-day-num">J${day}</div>
              <div class="login-day-reward">${entry ? _formatRewardLabel([entry.reward, entry.reward2].filter(Boolean), state, true) : '—'}</div>
              ${isDone ? '<div class="login-day-check">✓</div>' : ''}
              ${isLocked ? '<div class="login-day-lock">🔒</div>' : ''}
            </div>`;
          }).join('');
          return `<div class="login-cycle-card">
            <div class="login-cycle-title">${c.name}</div>
            <div class="login-cycle-days">${daysHtml}</div>
            ${!claimedToday ? `
              <div class="daily-claim-zone" id="daily-claim-zone-${c.id}">
                <button class="btn-claim-daily-inline" data-cycle-id="${c.id}">🎁 Réclamer la récompense du jour</button>
              </div>` : `<div style="text-align:center;font-size:.78rem;color:#4ade80;padding:6px 0">✓ Réclamé aujourd'hui</div>`}
          </div>`;
        }).join('')}
      </div>` : '';

    el.innerHTML = `
      <div class="screen-header"><h2>🧭 Missions</h2>${_helpBtn('quests')}</div>
      ${eventBlockHtml}
      ${cyclesHtml}
      <div class="equip-section-title" style="margin-top:${ev||activeCycles.length?'16px':'0'}">📅 Rendez-vous du jour</div>
      <div class="quest-cards-list">${questCards || '<p class="empty-msg">Aucun rendez-vous aujourd\'hui.</p>'}</div>
    `;

    el.querySelectorAll('.btn-quest-claim:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => _claimQuest(btn.dataset.questId));
    });
    el.querySelectorAll('.btn-event-claim:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => _claimEventQuest(parseInt(btn.dataset.eventQuestIndex)));
    });
    el.querySelectorAll('.btn-claim-daily-inline').forEach(btn => {
      btn.addEventListener('click', () => _claimDailyLoginInline(btn.dataset.cycleId));
    });
  }

  function _claimEventQuest(index) {
    const result = WBGameState.claimEventQuest(index);
    if (result.success) {
      WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.levelUp);
      _showToast('🎁 Récompense Event réclamée !', 'success');
      _updateHUD();
    } else {
      _showToast('Impossible de réclamer cette mission.', 'error');
    }
    renderQuests();
  }

  /** Réclame un cycle de connexion directement depuis l'écran Quêtes (animation Validé puis rafraîchissement) */
  function _claimDailyLoginInline(cycleId) {
    const result = WBGameState.claimDailyLoginReward(cycleId);
    const zone = document.getElementById(`daily-claim-zone-${cycleId}`);
    if (!result.success) {
      _showToast('Cette récompense a déjà été réclamée.', 'error');
      if (zone) zone.innerHTML = '';
      return;
    }
    WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.levelUp);
    const state = WBGameState.get();
    if (zone) {
      zone.innerHTML = `
        <div class="daily-claim-validated" id="daily-claim-validated-${cycleId}">
          <div class="validated-checkmark">✓</div>
          <div class="validated-text">Validé !</div>
          <div class="validated-reward-label">${_formatRewardLabel(result.reward, state)}</div>
        </div>
      `;
      requestAnimationFrame(() => document.getElementById(`daily-claim-validated-${cycleId}`)?.classList.add('visible'));
    }
    // L'animation doit se jouer entièrement avant de rafraîchir l'écran (recalcule les jours faits/verrouillés)
    setTimeout(() => renderQuests(), 1600);
  }

  /** Réclame la récompense d'une quête quotidienne complétée */
  function _claimQuest(questId) {
    const result = WBGameState.claimDailyQuest(questId);
    if (result.success) {
      WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.levelUp);
      _showToast('Récompense réclamée ! 🎁', 'success');
    } else {
      _showToast('Impossible de réclamer ce rendez-vous.', 'error');
    }
    renderQuests();
  }

  /**
   * Affiche le popup de réclamation d'un cycle de connexion quotidienne : vue
   * de TOUS les jours du cycle (faits / jour du jour / verrouillés), bouton
   * "🎁 Récompense" pour le jour courant. La récompense n'est accordée QUE
   * lorsque le joueur clique sur ce bouton. Une animation "✓ Validé" se joue
   * alors entièrement avant que le popup ne se ferme et que onDone() ne soit
   * appelé (ce qui laisse la file d'animations enchaîner le cycle suivant, le
   * cas échéant, ou revenir simplement à l'écran principal).
   * @param {{cycleId, cycleName, currentDay, cycle}} info
   * @param {Function} onDone - appelé une fois le popup fermé (réclamé ou non)
   */
  function _showDailyLoginClaimPopup(info, onDone) {
    const modal = document.getElementById('modal');
    if (!modal) { onDone?.(); return; }
    const state = WBGameState.get();
    const { cycleId, cycleName, currentDay, cycle } = info;
    const length = cycle.length || (cycle.rewards || []).length || 1;

    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      _closeModal();
      onDone?.();
    };

    const buildDaysHtml = () => Array.from({ length }, (_, i) => {
      const day = i + 1;
      const entry = (cycle.rewards || []).find(r => r.day === day);
      const status = day < currentDay ? 'done' : day === currentDay ? 'current' : 'locked';
      return `
        <div class="login-day-chip ${status}">
          <div class="login-day-num">J${day}</div>
          <div class="login-day-reward">${entry ? _formatRewardLabel([entry.reward, entry.reward2].filter(Boolean), state, true) : '—'}</div>
          ${status === 'done' ? '<div class="login-day-check">✓</div>' : ''}
          ${status === 'locked' ? '<div class="login-day-lock">🔒</div>' : ''}
        </div>
      `;
    }).join('');

    modal.style.display = 'block';
    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-box daily-login-popup">
          <button class="modal-close" id="modal-close">✕</button>
          <h3 style="font-family:var(--font-display);margin:0 0 4px;text-align:center">🎁 ${cycleName}</h3>
          <p style="font-size:.8rem;color:var(--text-dim);margin:0 0 14px;text-align:center">Jour ${currentDay} sur ${length}</p>
          <div class="login-cycle-days login-cycle-days-popup">${buildDaysHtml()}</div>
          <div class="daily-claim-zone" id="daily-claim-zone">
            <button class="btn-primary btn-claim-daily-reward" id="btn-claim-daily-reward">🎁 Récompense</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('modal-close')?.addEventListener('click', finish);
    document.getElementById('modal-backdrop')?.addEventListener('click', e => { if (e.target === e.currentTarget) finish(); });

    document.getElementById('btn-claim-daily-reward')?.addEventListener('click', () => {
      const result = WBGameState.claimDailyLoginReward(cycleId);
      const zone = document.getElementById('daily-claim-zone');
      if (!zone) { finish(); return; }

      if (!result.success) {
        _showToast('Cette récompense a déjà été réclamée.', 'error');
        finish();
        return;
      }

      WBAudioSystem.playSfx(WBAudioSystem.SFX_KEYS.levelUp);
      // Empêcher toute fermeture anticipée (clic backdrop / croix) pendant l'animation
      document.getElementById('modal-close')?.remove();

      zone.innerHTML = `
        <div class="daily-claim-validated" id="daily-claim-validated">
          <div class="validated-checkmark">✓</div>
          <div class="validated-text">Validé !</div>
          <div class="validated-reward-label">${_formatRewardLabel(result.reward, state)}</div>
        </div>
      `;
      requestAnimationFrame(() => document.getElementById('daily-claim-validated')?.classList.add('visible'));

      // L'animation doit se jouer ENTIÈREMENT avant de fermer / passer au cycle suivant
      setTimeout(finish, 1600);
    });
  }

  // ─── CATALOGUE ─────────────────────────────────────────────────────────────────

  function renderCatalogue() {
    const el = document.getElementById('screen-catalogue');
    if (!el) return;
    const state   = WBGameState.get();
    const catalogue = state.player.catalogue;
    const allChars = state.characters;

    // Progression globale (sur tous les personnages)
    const discovered = Object.keys(catalogue).length;
    const total = allChars.length;
    const pct = total ? Math.round((discovered / total) * 100) : 0;

    // N'afficher que les premières formes (evolutionStage === 0)
    // Grouper tous les personnages par lignée pour pouvoir les retrouver au clic
    const baseChars = allChars.filter(c => c.evolutionStage === 0);

    el.innerHTML = `
      <div class="screen-header"><h2>📖 Catalogue</h2>${_helpBtn('catalogue')}</div>
      <div class="catalogue-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="progress-text">${discovered} / ${total} découverts (${pct}%)</div>
      </div>
      <div class="catalogue-grid">
        ${baseChars.map(char => {
          const entry = catalogue[char.id];
          const types = state.types;
          const t1 = types.find(t => t.id === char.type1);
          const rarityDef = WBGameDatabase.RARITIES[char.rarity] || {};
          // Compter les formes découvertes dans la lignée
          const lineChars = allChars.filter(c => c.evolutionLine === char.evolutionLine);
          const lineDiscovered = lineChars.filter(c => catalogue[c.id]).length;
          return `
          <div class="catalogue-entry ${entry ? 'discovered' : 'unknown'}" data-line="${char.evolutionLine}" style="cursor:pointer">
            <div class="catalogue-portrait">
              ${entry && char.portrait ? `<img src="${char.portrait}" alt="${char.name}">` :
                entry ? `<div class="portrait-ph">${char.name.charAt(0)}</div>` :
                `<div class="unknown-silhouette">?</div>`}
            </div>
            <div class="catalogue-info">
              <div class="catalogue-name">${entry ? char.name : '???'}</div>
              <div class="catalogue-rarity" style="color:${rarityDef.color}">${entry ? rarityDef.name : ''}</div>
              ${entry && t1 ? `<span class="type-badge" style="background:${t1.color}">${t1.icon}</span>` : ''}
              ${lineChars.length > 1
                ? `<div class="catalogue-line-count">${lineDiscovered}/${lineChars.length} formes</div>`
                : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    `;

    // Clic sur une entrée → modal de la lignée évolutive
    el.querySelectorAll('.catalogue-entry').forEach(entry => {
      entry.addEventListener('click', () => _openCatalogueLine(entry.dataset.line));
    });
  }

  /**
   * Ouvre un modal affichant toutes les formes d'une lignée évolutive.
   * Les formes débloquées sont affichées en 540×675, les autres en "?".
   * @param {string} evolutionLine - ID de la lignée
   */
  function _openCatalogueLine(evolutionLine) {
    const state   = WBGameState.get();
    const catalogue = state.player.catalogue;
    const types   = state.types;

    // Récupérer et trier les formes de la lignée par stade
    const lineChars = state.characters
      .filter(c => c.evolutionLine === evolutionLine)
      .sort((a, b) => a.evolutionStage - b.evolutionStage);

    if (lineChars.length === 0) return;

    const modal = document.getElementById('modal');
    if (!modal) return;

    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-box modal-catalogue-line">
          <button class="modal-close" id="modal-close">✕</button>
          <h3 class="catalogue-line-title">Lignée évolutive</h3>
          <div class="catalogue-line-forms">
            ${lineChars.map((char, i) => {
              const entry    = catalogue[char.id];
              const rarityDef = WBGameDatabase.RARITIES[char.rarity] || {};
              const t1 = types.find(t => t.id === char.type1);
              const t2 = char.type2 ? types.find(t => t.id === char.type2) : null;
              return `
              ${i > 0 ? '<div class="catalogue-line-arrow">→</div>' : ''}
              <div class="catalogue-line-form ${entry ? 'discovered' : 'unknown'}">
                <div class="catalogue-line-portrait">
                  ${entry && char.portrait
                    ? `<img src="${char.portrait}" alt="${char.name}" style="width:100%;height:100%;object-fit:cover;object-position:center 20%;display:block;">`
                    : entry
                      ? `<div class="portrait-ph large">${char.name.charAt(0)}</div>`
                      : `<div class="unknown-silhouette large">?</div>`}
                </div>
                <div class="catalogue-line-info">
                  <div class="catalogue-line-name">${entry ? char.name : '???'}</div>
                  <div class="catalogue-line-rarity" style="color:${rarityDef.color}">${entry ? rarityDef.name : ''}</div>
                  <div class="catalogue-line-types">
                    ${entry && t1 ? `<span class="type-badge" style="background:${t1.color}">${t1.icon} ${t1.name}</span>` : ''}
                    ${entry && t2 ? `<span class="type-badge" style="background:${t2.color}">${t2.icon} ${t2.name}</span>` : ''}
                  </div>
                  ${entry && char.evolvesTo
                    ? `<div class="catalogue-line-evo-hint">${_formatEvoConditionText(char)}</div>`
                    : ''}
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;

    modal.style.display = 'block';
    document.getElementById('modal-close')?.addEventListener('click', _closeModal);
    document.getElementById('modal-backdrop')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) _closeModal();
    });
  }

  // ─── TOAST ────────────────────────────────────────────────────────────────────

  function _showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('toast-show'), 10);
    setTimeout(() => {
      toast.classList.remove('toast-show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ─── API PUBLIQUE ─────────────────────────────────────────────────────────────

  return {
    init, showScreen,
    renderCollection, renderTeam, renderGacha, renderEquip, renderInventory, renderShop, renderQuests, renderCatalogue, renderCombatLobby, renderCombatByLine, showHelp, _toggleBannerInfo,
    _openPlayerMenu, _closePlayerMenu, _pmSelectAvatar, _editPlayerName,
    _pmToggleMusic, _pmSetMusicVol, _pmSetSfxVol, _pmToggleSfx, _pmTogglePref,
    _showStatDetail, _showTitleScreen, _runTutorial,
    renderStoryChapters, renderStoryChapter,
    _showEvolutionShowcase, _showPlayerLevelUpShowcase,
  };
})();
