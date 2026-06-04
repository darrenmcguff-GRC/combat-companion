const MODULE_ID = 'combat-companion';

/* ─── Diagnostic: confirm script load ───────────────────────────── */
console.log(`%c[Combat Companion] Script loaded — v1.5.8`, 'color:#06b6d4;font-weight:bold');

/* ─── Settings ──────────────────────────────────────────────────── */
Hooks.on('init', () => {
  console.log('[Combat Companion] init hook running');
  game.settings.register(MODULE_ID, 'hudOpen',      { scope:'client', config:false, type:Boolean, default:false });
  game.settings.register(MODULE_ID, 'hudPosition',    { scope:'client', config:false, type:Object,  default:{top:80, left:10} });
  game.settings.register(MODULE_ID, 'hudSize',        { scope:'client', config:false, type:Object,  default:{width:420, height:680} });
  game.settings.register(MODULE_ID, 'popoutOpen',     { scope:'client', config:false, type:Boolean, default:false });
  game.settings.register(MODULE_ID, 'popoutPosition', { scope:'client', config:false, type:Object,  default:{top:100, left:500} });
  game.settings.register(MODULE_ID, 'popoutSize',     { scope:'client', config:false, type:Object,  default:{width:420, height:680} });
  game.settings.register(MODULE_ID, 'collapsedBoxes', { scope:'client', config:false, type:Object,  default:{} });
  game.settings.register(MODULE_ID, 'weaponFilter',   { scope:'client', config:false, type:String,  default:'all' });
  game.settings.register(MODULE_ID, 'spellFilter',    { scope:'client', config:false, type:String,  default:'all' });
  game.settings.register(MODULE_ID, 'featureFilter',  { scope:'client', config:false, type:String,  default:'all' });
});

/* ─── Ready ─────────────────────────────────────────────────────── */
Hooks.on('ready', () => {
  console.log('[Combat Companion] ready hook running');
  try {
    if (game.settings.get(MODULE_ID, 'hudOpen'))    CombatCompanion.open();
    if (game.settings.get(MODULE_ID, 'popoutOpen')) CombatCompanion.openPopout();
  } catch (e) { console.warn('[Combat Companion] ready error:', e); }
  // Inject main menu toggle button
  setTimeout(() => CombatCompanion._injectMenuButton(), 200);
});

/* ─── Token HUD button (v12–v14 compatible) ─────────────────────── */
Hooks.on('renderTokenHUD', (hud, html, token) => {
  try {
    const $html = html instanceof HTMLElement ? $(html) : html;
    if (!$html?.length) return;
    let target = $html.find('.col.left');
    if (!target.length) target = $html.find('[class*="left"]');
    if (!target.length) target = $html;
    const btn = $('<div class="control-icon" title="Open Combat Companion"><i class="fas fa-swords"></i></div>');
    btn.on('click', () => { ui.notifications?.info?.('Opening Combat Companion…'); CombatCompanion.open(); });
    if (target.hasClass('col') || target.hasClass('left')) target.append(btn);
    else { const row=$html.find('.col').first()||$html; row.append(btn); }
  } catch (e) { console.warn('[Combat Companion] HUD button failed:', e); }
});

/* ─── Update on selection / combat changes / token moves ────────── */
Hooks.on('controlToken',      () => CombatCompanion.refreshDebounced());
Hooks.on('updateActor',       () => CombatCompanion.refreshDebounced());
Hooks.on('updateItem',        () => CombatCompanion.refreshDebounced());
Hooks.on('updateCombat',      (combat, updated) => {
  // When turn changes, the new active combatant regains their reaction
  if (updated?.turn !== undefined) {
    const tokenId = combat.combatant?.token?.id;
    if (tokenId) {
      const token = canvas.tokens?.get(tokenId);
      if (token?.actor) {
        token.actor.unsetFlag(MODULE_ID, 'reactionUsedRound').catch(()=>{});
        token.actor.unsetFlag(MODULE_ID, 'reactionSpentManual').catch(()=>{});
      }
    }
  }
  CombatCompanion.refreshDebounced();
});
Hooks.on('deleteCombat',      () => CombatCompanion.refreshDebounced());
Hooks.on('updateToken',       (doc, chg) => {
  if (chg.x !== undefined || chg.y !== undefined) CombatCompanion.refreshDebounced();
});

/* ─── Detect reaction use from items ─────────────────────────────── */
Hooks.on('dnd5e.useItem', (item, config, options) => {
  try {
    const activation = item.system?.activation;
    if (activation?.type === 'reaction' || activation?.type?.includes('reaction')) {
      const actor = item.actor;
      if (!actor) return;
      // Mark reaction as used for this round
      if (game.combat && game.combat.started) {
        actor.setFlag(MODULE_ID, 'reactionUsedRound', game.combat.round).catch(()=>{});
      } else {
        actor.setFlag(MODULE_ID, 'reactionSpentManual', true).catch(()=>{});
      }
      CombatCompanion.refreshDebounced();
    }
  } catch(e){}
});

/* ─── Detect reaction use from item rolls ─────────────────────────── */
Hooks.on('dnd5e.rollAttack', (item, roll, ammoUpdate) => {
  try {
    const activation = item.system?.activation;
    if (activation?.type === 'reaction' || activation?.type?.includes('reaction')) {
      const actor = item.actor;
      if (!actor) return;
      if (game.combat && game.combat.started) {
        actor.setFlag(MODULE_ID, 'reactionUsedRound', game.combat.round).catch(()=>{});
      } else {
        actor.setFlag(MODULE_ID, 'reactionSpentManual', true).catch(()=>{});
      }
      CombatCompanion.refreshDebounced();
    }
  } catch(e){}
});

/* ─── Main Class ───────────────────────────────────────────────── */
class CombatCompanion {
  static _instance = null;
  static _lastTokenId = null;
  static get actor() {
    const t = this.token;
    return t?.actor ?? t?.document?.actor ?? null;
  }
  static get token() {
    if (!canvas?.tokens) return null;
    const ctrl = canvas.tokens.controlled;
    let t = null;
    if (ctrl) {
      if (typeof ctrl[Symbol.iterator] === 'function') {
        for (const item of ctrl) { t = item; break; }
      } else if (Array.isArray(ctrl)) {
        t = ctrl[0];
      } else if (typeof ctrl.first === 'function') {
        t = ctrl.first();
      } else if (ctrl.size > 0) {
        ctrl.forEach(v => { if (!t) t = v; });
      }
    }
    if (!t && this._lastTokenId) t = canvas.tokens.get(this._lastTokenId);
    if (t) this._lastTokenId = t.id;
    return t;
  }

  /* ── Debounced refresh ─────────────────────────────────────────── */
  static _refreshTimer = null;
  static refreshDebounced() {
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this.refresh(), 50);
  }

  /* ── Open sidebar HUD ──────────────────────────────────────────── */
  static async open() {
    let $el = $('#cc-sidebar');
    if (!$el.length) {
      const pos = await game.settings.get(MODULE_ID, 'hudPosition');
      const sz  = await game.settings.get(MODULE_ID, 'hudSize');
      $('body').append(`
        <div id="cc-sidebar" class="cc-panel" style="top:${pos.top}px;left:${pos.left}px;width:${sz.width}px;height:${sz.height}px;">
          <div class="cc-drag-handle"><span>Combat Companion</span>
            <div class="cc-actions">
              <i class="fas fa-window-maximize" data-action="popout" title="Pop out"></i>
              <i class="fas fa-times" data-action="close" title="Close"></i>
            </div>
          </div>
          <div class="cc-body"></div>
          <div class="cc-resize-handle"></div>
        </div>`);
      $el = $('#cc-sidebar');
      this._bindDragResize('#cc-sidebar');
      $el.find('[data-action="popout"]').on('click', ()=>this.openPopout());
      $el.find('[data-action="close"]').on('click', ()=>this.close());
    }
    try { await game.settings.set(MODULE_ID, 'hudOpen', true); } catch(e){}
    $el.show();
    $('#cc-menu-toggle').addClass('active');
    this.refresh();
  }

  static async close() {
    $('#cc-sidebar').hide();
    $('#cc-menu-toggle').removeClass('active');
    try { await game.settings.set(MODULE_ID, 'hudOpen', false); } catch(e){}
  }

  /* ── Toggle sidebar ────────────────────────────────────────────── */
  static toggle() {
    const $el = $('#cc-sidebar');
    if ($el.length && $el.is(':visible')) {
      this.close();
    } else {
      this.open();
    }
  }

  /* ── Inject main menu toggle button ────────────────────────────── */
  static _injectMenuButton() {
    if (document.getElementById('cc-menu-toggle')) return;
    // Find the header controls area — Foundry v14 stores it in #controls
    const $target = $('#controls .scene-controls') || $('#controls');
    if (!$target.length) {
      // Fallback: try ui-top navigation
      const $fallback = $('#ui-top');
      if (!$fallback.length) return;
      const btn = $(`<div id="cc-menu-toggle" class="cc-menu-btn scene-control" title="Toggle Combat Companion" data-tooltip="Combat Companion"><i class="fas fa-swords"></i></div>`);
      btn.on('click', () => CombatCompanion.toggle());
      $fallback.find('.flexrow').length ? $fallback.find('.flexrow').append(btn) : $fallback.append(btn);
      return;
    }
    const btn = $(`<div id="cc-menu-toggle" class="cc-menu-btn scene-control" title="Toggle Combat Companion" data-tooltip="Combat Companion"><i class="fas fa-swords"></i></div>`);
    btn.on('click', () => CombatCompanion.toggle());
    $target.prepend(btn);
  }

  /* ── Open popout window ────────────────────────────────────────── */
  static async openPopout() {
    $('#cc-sidebar').hide();
    $('#cc-menu-toggle').addClass('active');
    if (this._instance) { this._instance.render(true); return; }
    this._instance = new CombatCompanionPopout();
    this._instance.render(true);
    try { await game.settings.set(MODULE_ID, 'popoutOpen', true); } catch(e){}
  }

  /* ── Drag & resize wiring ────────────────────────────────────── */
  static _bindDragResize(sel) {
    const $el = $(sel); let isDrag=false, isResize=false;
    let sx, sy, sl, st, sw, sh;

    $el.find('.cc-drag-handle').on('mousedown.cc-drag', (e) => {
      if (e.target.closest('.cc-actions')) return;
      isDrag=true; sx=e.clientX; sy=e.clientY;
      const o=$el.offset(); sl=o.left; st=o.top;
      e.preventDefault();
    });
    $el.find('.cc-resize-handle').on('mousedown.cc-resize', (e) => {
      isResize=true; sx=e.clientX; sy=e.clientY;
      sw=$el.outerWidth(); sh=$el.outerHeight();
      e.preventDefault();
    });

    const onMove=(e)=>{
      if (isDrag) $el.css({left:Math.max(0,sl+e.clientX-sx), top:Math.max(0,st+e.clientY-sy)});
      if (isResize) $el.css({width:Math.max(300,sw+e.clientX-sx), height:Math.max(300,sh+e.clientY-sy)});
    };
    const onUp=()=>{
      if (isDrag) {
        const o=$el.offset();
        try { game.settings.set(MODULE_ID, sel==='#cc-sidebar'?'hudPosition':'popoutPosition',
          {top:Math.round(o.top), left:Math.round(o.left)}); } catch(e){}
      }
      if (isResize) {
        try { game.settings.set(MODULE_ID, sel==='#cc-sidebar'?'hudSize':'popoutSize',
          {width:Math.round($el.outerWidth()), height:Math.round($el.outerHeight())}); } catch(e){}
      }
      isDrag=isResize=false;
    };
    $(document).off('mousemove.cc-drag mouseup.cc-drag')
      .on('mousemove.cc-drag', onMove).on('mouseup.cc-drag', onUp);
  }

  /* ─── Refresh & Build Data ───────────────────────────────────── */
  static refresh() {
    try {
      const actor = this.actor;
      const tokenName = this.token?.name || 'none';
      console.log(`[Combat Companion] refresh() — token: ${tokenName}, actor: ${actor?.name || 'none'}`);
      if (!actor) { this._renderNoSelection(); return; }
      const data = this._buildData(actor);
      console.log('[Combat Companion] _buildData OK — weapons:', data.weapons?.length, 'spells:', data.spells?.length);
      this._renderAll(data);
      console.log('[Combat Companion] _renderAll OK');
    } catch (err) {
      console.error('[Combat Companion] refresh error:', err);
      this._renderError(err.message || String(err));
    }
  }

  static _buildData(actor) {
    const sys = actor.system || {};
    const attrs = sys.attributes || {};

    // AC
    let acVal = 10;
    try { acVal = attrs.ac?.value ?? attrs.ac ?? 10; if (typeof acVal === 'object') acVal = acVal.value ?? 10; } catch(e){}

    // HP
    let hpCurrent=0, hpMax=1, hpTemp=0, hpTempmax=0;
    try { const hp=attrs.hp||{}; hpCurrent=hp.value??hp.current??0; hpMax=hp.max??1; hpTemp=hp.temp??0; hpTempmax=hp.tempmax??0; } catch(e){}

    // Death saves
    let deathFails = 0, deathPasses = 0;
    try {
      deathFails = parseInt(actor.getFlag(MODULE_ID, 'deathFail') || 0) || 0;
      deathPasses = parseInt(actor.getFlag(MODULE_ID, 'deathPass') || 0) || 0;
    } catch(e){}
    const isDying = hpCurrent <= 0 && (actor.type === 'character' || actor.type === 'npc');

    // Initiative
    let initVal = 0;
    try { initVal = attrs.init?.total ?? attrs.init?.value ?? attrs.init ?? 0; } catch(e){}

    // Conditions
    const conditions = [];
    try { for (const e of (actor.effects||[])) { if (e.disabled===true) continue; conditions.push(e.name||e.label||'Effect'); } } catch(e){}
    let concentration = false;
    try { concentration = attrs.concentration?.value ?? false; } catch(e){}

    // Weapons
    const weapons = [];
    try {
      for (const it of (actor.items||[])) {
        if (it.type !== 'weapon') continue;
        const s = it.system || {};
        if (s.equipped===true||s.equip===true||s.equipped===1||s.equip===1) {
          weapons.push(it);
        }
      }
    } catch(e){}

    // Spells
    const spells = [];
    try {
      for (const it of (actor.items||[])) {
        if (it.type !== 'spell') continue;
        const prep = it.system?.preparation;
        if (!prep) { spells.push(it); continue; }
        const mode = prep.mode || 'prepared';
        const isPrepared = prep.prepared===true||prep.prepared===1||prep.prepared==='true';
        if (mode==='prepared' && !isPrepared) continue;
        spells.push(it);
      }
    } catch(e){}

    const spellSlots = this._getSpellSlots(actor);

    // Features / Abilities
    const features = [];
    try {
      for (const it of (actor.items||[])) {
        if (it.type !== 'feat') continue;
        features.push(it);
      }
    } catch(e){}

    // Resources
    const resources = [];
    try { for (const r of Object.values(sys.resources||{})) { if (r && (r.max??0)>0) resources.push(r); } } catch(e){}

    // Actions: track reaction
    let reactionAvailable = true;
    try {
      const u = actor.system?.uses?.actions;
      if (typeof u === 'object' && typeof u.reaction === 'number') {
        reactionAvailable = u.reaction > 0;
      }
      // Check for reaction-spent flags in active effects
      if (reactionAvailable && actor.effects?.length) {
        for (const e of actor.effects) {
          const name = (e.name||e.label||'').toLowerCase();
          if (name.includes('reaction') && name.includes('spent')) { reactionAvailable = false; break; }
          const flags = e.flags || {};
          if (flags.dnd5e?.reactionUsed || flags['dnd5e']?.reactionUsed) { reactionAvailable = false; break; }
        }
      }
      // Check for reaction items used this round
      const lastUsed = actor.getFlag(MODULE_ID, 'reactionUsedRound');
      if (lastUsed && game.combat && game.combat.round === lastUsed) {
        if (game.combat.started) { reactionAvailable = false; }
      }
    } catch(e){}

    // Proficiency bonus
    const profBonus = attrs.prof ?? 0;

    // ── Helper: compute ability mod from score ──
    const _abiMod = (a) => {
      if (!a) return 0;
      // dnd5e v4.x stores mod as a numeric value in v3 compat OR a formula string
      const m = a.mod;
      if (typeof m === 'number') return m;
      // Fallback: compute from ability score
      const val = a.value ?? 10;
      return Math.floor((val - 10) / 2);
    };

    // Helper: get raw score, for display
    const _abiValue = (a) => {
      if (!a) return 10;
      return a.value ?? 10;
    };

    // ── Ability scores ──
    const abs = sys.abilities || {};
    const abilities = [];
    try {
      const abiMap = { str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA' };
      for (const [key, label] of Object.entries(abiMap)) {
        const a = abs[key] || {};
        const mod = _abiMod(a);
        abilities.push({ key, label, value: _abiValue(a), mod });
      }
    } catch(e){}

    // ── Compute a map of ability key -> mod for skill calculations ──
    const abiModMap = {};
    for (const ab of abilities) { abiModMap[ab.key] = ab.mod; }

    // ── Saving throws ──
    const savingThrows = [];
    try {
      const saveMap = { str:'Strength', dex:'Dexterity', con:'Constitution', int:'Intelligence', wis:'Wisdom', cha:'Charisma' };
      for (const [key, name] of Object.entries(saveMap)) {
        const a = abs[key] || {};
        // dnd5e v4.x: proficient is a multiplier (0, 0.5, 1, 2) not a boolean
        const profMult = typeof a.proficient === 'number' ? a.proficient : 0;
        const mod = _abiMod(a);
        const saveMod = profMult ? mod + profBonus * profMult : mod;
        savingThrows.push({ key, name, mod, prof: profMult > 0, saveMod });
      }
    } catch(e){}

    // ── Skills ──
    const skills = [];
    try {
      const sk = sys.skills || {};
      const skillMap = {
        acr:'Acrobatics', ani:'Animal Handling', arc:'Arcana', ath:'Athletics',
        dec:'Deception', his:'History', ins:'Insight', itm:'Intimidation',
        inv:'Investigation', med:'Medicine', nat:'Nature', prc:'Perception',
        prf:'Performance', per:'Persuasion', rel:'Religion', slt:'Sleight of Hand',
        ste:'Stealth', sur:'Survival'
      };
      for (const [key, name] of Object.entries(skillMap)) {
        const s = sk[key] || {};
        // dnd5e v4.x: s.value is NOT the total modifier — compute from ability mod + prof multiplier + bonus
        const abiKey = s.ability || 'int';
        const abilityMod = abiModMap[abiKey] ?? 0;
        // Prof multiplier: 0, 0.5, 1, 2 (expertise)
        const profMult = typeof s.proficient === 'number' ? s.proficient : 0;
        const bonus = typeof s.bonus === 'number' ? s.bonus : 0;
        const total = abilityMod + (profMult * profBonus) + bonus;
        skills.push({ key, name, total, prof: profMult, ability: s.ability || '' });
      }
    } catch(e){}

    // Reaction items (from feats + spells that use a reaction)
    const reactionItems = [];
    try {
      for (const it of (actor.items||[])) {
        const act = it.system?.activation?.type || '';
        if (act === 'reaction' || act.includes('reaction')) {
          reactionItems.push(it);
        }
      }
    } catch(e){}

    return {
      actor, img:actor.img||actor.prototypeToken?.texture?.src||'icons/svg/mystery-man.svg',
      name:actor.name||'Unknown', ac:acVal,
      hp:{current:hpCurrent, max:hpMax, temp:hpTemp, tempmax:hpTempmax},
      prof:profBonus, conditions, concentration, initiative:initVal,
      reactionAvailable, weapons, spells, features, spellSlots, resources, savingThrows,
      abilities, skills, reactionItems,
      isNPC:actor.type==='npc',
      labels:actor.labels||{},
      deathFails, deathPasses, isDying
    };
  }

  static _getSpellSlots(actor) {
    const slots=[];
    try {
      const spells=actor.system?.spells;
      if (!spells) return slots;
      for (let i=1;i<=9;i++) {
        const s=spells[`spell${i}`];
        if (s && (s.max??0)>0) slots.push({level:i, max:s.max, value:s.value??s.max});
      }
      if (spells.pact && (spells.pact.max??0)>0) slots.push({level:'Pact', max:spells.pact.max, value:spells.pact.value??spells.pact.max});
    } catch(e){}
    return slots;
  }

  /* ─── Renderers ─────────────────────────────────────────────────── */
  static _renderNoSelection() {
    const html = `<div class="cc-empty"><i class="fas fa-user-slash"></i><p>Select a token</p></div>`;
    $('#cc-sidebar .cc-body, #cc-popout .cc-body').html(html);
  }
  static _renderError(msg) {
    const html = `<div class="cc-empty" style="color:#f43f5e"><i class="fas fa-triangle-exclamation"></i><p>${msg}</p></div>`;
    $('#cc-sidebar .cc-body, #cc-popout .cc-body').html(html);
  }

  static _renderAll(data) {
    const sections = [
      this._actorCard(data),
      this._reactionBox(data),
      this._skillsBox(data),
      this._savingThrowsBox(data),
      this._conditionsBox(data),
      this._weaponsBox(data),
      this._featuresBox(data),
      this._spellsBox(data),
      this._slotsBox(data),
      this._initiativeBox(data),
      this._resourcesBox(data)
    ];
    const html = sections.join('');
    $('#cc-sidebar .cc-body, #cc-popout .cc-body').html(html);
    this._bindBoxes();
    this._bindFilters();
    this._bindInteractions(data);
  }

  static _actorCard(d) {
    const hpMaxTotal = d.hp.max + (d.hp.tempmax||0);
    const hpCurTotal = d.hp.current + (d.hp.temp||0);
    const pct = hpMaxTotal>0 ? Math.max(0,Math.min(100,(hpCurTotal/hpMaxTotal)*100)) : 0;
    const col = pct>50?'#10b981':pct>25?'#f59e0b':'#f43f5e';
    const isDead = d.hp.current <= 0;
    const hpRow = d.hp.temp
      ? `<span class="cc-hp">${hpCurTotal} / ${hpMaxTotal} HP</span><span class="cc-temp">+${d.hp.temp} temp</span>`
      : `<span class="cc-hp">${hpCurTotal} / ${hpMaxTotal} HP</span>`;
    return this._wrap('Actor', `
      <div class="cc-actor"><img src="${d.img}" alt="" loading="lazy"><div>
        <strong>${d.name}</strong>
        <span class="cc-ac"><i class="fas fa-shield-halved"></i> ${d.ac} AC</span>
        <div class="cc-hp-bar"><div style="width:${pct}%;background:${col}"></div></div>
        ${hpRow}
      </div></div>
      <!-- HP controls -->
      <div class="cc-hp-controls">
        <div class="cc-hp-row">
          <button class="cc-hp-btn cc-hp-heal" data-hp-action="heal" title="Heal">+<i class="fas fa-plus"></i></button>
          <button class="cc-hp-btn cc-hp-dmg" data-hp-action="damage" title="Damage"><i class="fas fa-minus"></i></button>
          <input type="number" class="cc-hp-amount" value="1" min="1" max="999" step="1">
          <span class="cc-hp-label">HP</span>
        </div>
        <div class="cc-hp-row">
          <button class="cc-hp-btn cc-hp-temp" data-hp-action="temp" title="Add Temp HP"><i class="fas fa-shield"></i></button>
          <input type="number" class="cc-hp-temp-amount" value="1" min="1" max="999" step="1">
          <span class="cc-hp-label">Temp HP</span>
          ${d.hp.temp ? `<button class="cc-hp-btn cc-hp-clear-temp" data-hp-action="clear-temp" title="Clear Temp HP"><i class="fas fa-times"></i></button>` : ''}
        </div>
      </div>
      ${isDead ? this._deathSaveBox(d) : ''}
      <div class="cc-stats-row">${(d.abilities||[]).map(a=>{
        const sign=a.mod>=0?'+':'';
        return `<div class="cc-stat" data-stat="${a.key}" title="${a.label} — click to roll">
          <span class="cc-stat-label">${a.label}</span>
          <span class="cc-stat-value">${a.value}</span>
          <span class="cc-stat-mod">${sign}${a.mod}</span>
        </div>`;
      }).join('')}</div>`);
  }

  /* ─── Death Save Box ──────────────────────────────────────────── */
  static _deathSaveBox(d) {
    const maxDots = 3;
    const fails = Array.from({length: maxDots}, (_, i) =>
      `<span class="cc-death-dot cc-death-fail ${i < d.deathFails ? 'cc-death-filled' : ''}"></span>`
    ).join('');
    const passes = Array.from({length: maxDots}, (_, i) =>
      `<span class="cc-death-dot cc-death-pass ${i < d.deathPasses ? 'cc-death-filled' : ''}"></span>`
    ).join('');
    const stable = d.deathPasses >= 3;
    const dead = d.deathFails >= 3 || d.hp.current < 0;
    let statusText = '';
    let statusClass = '';
    if (stable) { statusText = '✅ Stable'; statusClass = 'cc-death-stable'; }
    else if (dead) { statusText = '💀 Dead'; statusClass = 'cc-death-dead'; }
    else { statusText = '⬇️ Dying'; statusClass = 'cc-death-dying'; }
    return `
      <div class="cc-death-box ${statusClass}">
        <div class="cc-death-header">
          <span>${statusText}</span>
          <button class="cc-hp-btn cc-death-reset" data-hp-action="death-reset" title="Reset death saves"><i class="fas fa-rotate-left"></i></button>
        </div>
        <div class="cc-death-rows">
          <div class="cc-death-row">
            <span class="cc-death-label">Fails</span>
            <div class="cc-death-dots">${fails}</div>
            <button class="cc-death-btn" data-death-type="fail" data-death-dir="1" title="Add fail"><i class="fas fa-plus"></i></button>
            <button class="cc-death-btn" data-death-type="fail" data-death-dir="-1" title="Remove fail"><i class="fas fa-minus"></i></button>
          </div>
          <div class="cc-death-row">
            <span class="cc-death-label">Passes</span>
            <div class="cc-death-dots">${passes}</div>
            <button class="cc-death-btn" data-death-type="pass" data-death-dir="1" title="Add pass"><i class="fas fa-plus"></i></button>
            <button class="cc-death-btn" data-death-type="pass" data-death-dir="-1" title="Remove pass"><i class="fas fa-minus"></i></button>
          </div>
        </div>
      </div>`;
  }

  static _reactionBox(d) {
    const avail = d.reactionAvailable;
    const cls = avail ? 'cc-reaction-avail' : 'cc-reaction-spent';
    const text = avail ? '🛡️ Reaction Available' : '🛡️⛔ Reaction Used';
    const items = d.reactionItems || [];
    const itemList = items.length
      ? `<div class="cc-react-items">${items.map(it => {
          const actType = (it.system?.activation?.type || '').toLowerCase();
          let badge = '';
          if (actType==='action') badge = '<span class="cc-badge act">A</span>';
          else if (actType==='bonus') badge = '<span class="cc-badge bns">B</span>';
          else if (actType==='reaction' || actType.includes('reaction')) badge = '<span class="cc-badge rct">R</span>';
          else badge = '';
          let uses = it.system?.uses;
          let usesText = '';
          if (uses && uses.max > 0) { usesText = ` (${uses.value ?? uses.max}/${uses.max})`; }
          else if (it.system?.recovery?.length && it.system.recovery.some(r=> r.period)) {
            const r = it.system.recovery[0];
            const periodMap = {'sr':'short rest','lr':'long rest','day':'daily','dawn':'dawn','dusk':'dusk'};
            usesText = ' (' + (periodMap[r.period] || r.period) + ')';
          }
          return `<button class="cc-item-btn cc-react-item" data-item-id="${it.id}" data-type="${it.type}">
            <img src="${it.img||'icons/svg/mystery-man.svg'}" loading="lazy">
            <span>${it.name}</span>
            <div class="cc-badges">${badge}<small>${usesText}</small></div>
          </button>`;
        }).join('')}</div>`
      : '<em class="cc-muted">No reaction abilities</em>';
    return this._wrap('Reaction', `
      <button class="cc-reaction-btn ${cls}" data-type="reaction">
        ${text}
      </button>
      ${itemList}`);
  }

  /* ─── Skills ─────────────────────────────────────────────────── */
  static _skillsBox(d) {
    if (!d.skills?.length) return '';
    const rows = d.skills.map(s => {
      const sign = s.total >= 0 ? '+' : '';
      const abilityShort = s.ability ? s.ability.slice(0, 3).toUpperCase() : '';
      const profIcon = s.prof >= 2 ? '<i class="fas fa-check-double"></i>' : s.prof ? '<i class="fas fa-check-circle"></i>' : '<i class="far fa-circle"></i>';
      const cls = s.prof ? 'cc-skill-prof' : '';
      return `<div class="cc-skill-row ${cls}" data-skill="${s.key}" title="${s.name} (${s.ability||'?'})">
        <span class="cc-skill-name">${s.name}</span>
        <span class="cc-skill-abi">${abilityShort}</span>
        <span class="cc-skill-mod">${sign}${s.total}</span>
        <span class="cc-skill-prof-icon">${profIcon}</span>
      </div>`;
    }).join('');
    return this._wrap('Skills', rows);
  }

  static _savingThrowsBox(d) {
    if (!d.savingThrows?.length) return '';
    const rows = d.savingThrows.map(s=>{
      const sign = s.saveMod>=0?'+':'';
      const profIcon = s.prof ? '<i class="fas fa-check-circle"></i>' : '<i class="far fa-circle"></i>';
      const cls = s.prof ? 'cc-save-prof' : '';
      return `<div class="cc-save-row ${cls}" data-save="${s.key}" title="${s.name} save (${s.prof?'proficient':'not proficient'})">
        <span class="cc-save-name">${s.name}</span>
        <span class="cc-save-mod">${sign}${s.saveMod}</span>
        <span class="cc-save-prof">${profIcon}</span>
      </div>`;
    }).join('');
    return this._wrap('Saving Throws', rows);
  }

  static _conditionsBox(d) {
    const chips = d.conditions.length
      ? d.conditions.map(c=>`<span class="cc-chip">${c}</span>`).join('')
      : '<em class="cc-muted">None</em>';
    return this._wrap('Conditions',
      `${d.concentration?'<span class="cc-chip cc-conc"><i class="fas fa-eye"></i> Concentrating</span>':''}${chips}`);
  }

  /* ─── Features & Abilities with action type filter ──────────────── */
  static _featuresBox(d) {
    if (!d.features.length) return this._wrap('Features','<em class="cc-muted">No features</em>');
    const filter = (()=>{ try{return game.settings.get(MODULE_ID,'featureFilter');}catch(e){return 'all';} })();
    const current = d.features.filter(f=>{
      if (filter==='all') return true;
      const act = f.system?.activation?.type?.toLowerCase() || '';
      if (filter==='action') return act==='action';
      if (filter==='bonus') return act==='bonus';
      if (filter==='reaction') return act==='reaction' || act.includes('reaction');
      if (filter==='other') return act !== 'action' && act !== 'bonus' && !(act.includes('reaction'));
      if (filter==='passive') return !act || act==='' || act==='none' || act==='passive';
      return true;
    });
    const select = `
      <option value="all" ${filter==='all'?'selected':''}>All</option>
      <option value="action" ${filter==='action'?'selected':''}>Action</option>
      <option value="bonus" ${filter==='bonus'?'selected':''}>Bonus Action</option>
      <option value="reaction" ${filter==='reaction'?'selected':''}>Reaction</option>
      <option value="other" ${filter==='other'?'selected':''}>Other</option>
      <option value="passive" ${filter==='passive'?'selected':''}>Passive</option>`;
    const list = current.map(f=>{
      const actType = f.system?.activation?.type?.toLowerCase() || '';
      let badge = '';
      if (actType==='action') badge = '<span class="cc-badge act">A</span>';
      else if (actType==='bonus') badge = '<span class="cc-badge bns">B</span>';
      else if (actType==='reaction' || actType.includes('reaction')) badge = '<span class="cc-badge rct">R</span>';
      else if (!actType || actType==='' || actType==='none') badge = '<span class="cc-badge psv">P</span>';
      else badge = '<span class="cc-badge other">O</span>';
      // Build subtitle: uses / recharge info
      let uses = f.system?.uses;
      let usesText = '';
      if (uses && uses.max > 0) { usesText = ` (${uses.value ?? uses.max}/${uses.max})`; }
      else if (f.system?.recovery?.length && f.system.recovery.some(r=> r.period)) {
        const r = f.system.recovery[0];
        const periodMap = {'sr':'short rest','lr':'long rest','day':'daily','dawn':'dawn','dusk':'dusk'};
        usesText = ' (' + (periodMap[r.period] || r.period) + ')';
      }
      return `<button class="cc-item-btn" data-item-id="${f.id}" data-type="feat">
        <img src="${f.img||'icons/svg/mystery-man.svg'}" loading="lazy">
        <span>${f.name}</span>
        <div class="cc-badges">${badge}<small>${usesText}</small></div>
      </button>`;
    }).join('');
    return this._wrap('Features', `
      <div class="cc-filter-row"><select class="cc-filter" data-filter="features">${select}</select></div>
      <div class="cc-scroll-list">${list||'<em class="cc-muted">No features match filter</em>'}</div>`);
  }

  /* ─── Weapons with type filter ───────────────────────────────────── */
  static _weaponsBox(d) {
    if (!d.weapons.length) return this._wrap('Weapons','<em class="cc-muted">No equipped weapons</em>');
    const types = [...new Set(d.weapons.map(w=>w.system?.type?.value||w.system?.weaponType||'Other'))];
    types.sort();
    const filter = (()=>{ try{return game.settings.get(MODULE_ID,'weaponFilter');}catch(e){return 'all';} })();
    const current = d.weapons.filter(w=>{
      if (filter==='all') return true;
      const t = w.system?.type?.value||w.system?.weaponType||'Other';
      return t===filter;
    });
    const select = ['<option value="all" '+ (filter==='all'?'selected':'') +'>All Types</option>']
      .concat(types.map(t=>`<option value="${t}" ${filter===t?'selected':''}>${this._cap(t)}</option>`))
      .join('');
    const list = current.map(w=>`
      <button class="cc-item-btn" data-item-id="${w.id}" data-type="weapon">
        <img src="${w.img||'icons/svg/mystery-man.svg'}" loading="lazy"><span>${w.name}</span>
        <small>${this._weaponStats(w)}</small>
      </button>`).join('');
    return this._wrap('Weapons', `
      <div class="cc-filter-row"><select class="cc-filter" data-filter="weapons">${select}</select></div>
      <div class="cc-scroll-list">${list||'<em class="cc-muted">No weapons match filter</em>'}</div>`);
  }

  static _cap(s) { return s.charAt(0).toUpperCase()+s.slice(1); }

  static _weaponStats(w) {
    try {
      const s = w.system||{};
      const actor = w.actor;
      // ── Attack bonus: compute from prof + ability + flat bonuses ──
      let atk = 0;
      if (actor?.system) {
        const prof = actor.system.attributes?.prof ?? 0;
        const ability = s.ability ?? 'str';
        // For finesse weapons, use the higher of str or dex
        const props = s.properties || {};
        const isFinesse = props.fin || props.finesse || (Array.isArray(s.properties) && s.properties.includes('fin'));
        let abiMod = actor.system.abilities?.[ability]?.mod ?? 0;
        if (isFinesse) {
          const dexMod = actor.system.abilities?.dex?.mod ?? 0;
          abiMod = Math.max(abiMod, dexMod);
        }
        const magic = typeof s.magicalBonus === 'number' ? s.magicalBonus : 0;
        const flatBonus = typeof s.attackBonus === 'number' ? s.attackBonus : 0;
        // prof multiplier: v4 uses boolean (true=1) or numeric (0, 0.5, 1, 2)
        let profMult = 0;
        if (typeof s.proficient === 'number') profMult = s.proficient;
        else if (s.proficient === true) profMult = 1;
        atk = Math.round((prof * profMult) + abiMod + magic + flatBonus);
      }
      // ── Damage: try v4 activities first, then labels, then legacy ──
      let dmg = null;
      // v4: activities.contents[0].damage.parts
      try {
        const activities = s.activities?.contents || Object.values(s.activities || {});
        const act = activities?.[0];
        if (act?.damage?.parts?.length) {
          const parts = act.damage.parts;
          dmg = parts.map(p => {
            const num = p.number ?? 1;
            const faces = p.faces ?? p.denomination ?? 0;
            const bonus = p.bonus ?? 0;
            let str = `${num}d${faces}`;
            if (bonus) str += bonus > 0 ? ` + ${bonus}` : ` - ${Math.abs(bonus)}`;
            return str;
          }).filter(Boolean).join(' + ');
        }
      } catch(e){}
      // Fallback: labels (dnd5e computed)
      if (!dmg && w.labels?.damage) dmg = String(w.labels.damage);
      // Fallback: legacy damage fields
      if (!dmg && s.damage?.formula) dmg = s.damage.formula;
      if (!dmg && s.formula) dmg = s.formula;
      if (!dmg && s.attack?.parts?.length) dmg = s.attack.parts.map(p=>Array.isArray(p)?p[0]:String(p)).filter(Boolean).join(' + ');
      if (!dmg && s.damage?.parts?.length) dmg = s.damage.parts.map(p=>Array.isArray(p)?p[0]:String(p)).filter(Boolean).join(' + ');
      if (!dmg && s.damage?.base) dmg = this._fmtDie(s.damage.base, w);
      if (!dmg && s.damage?.versatile) dmg = this._fmtDie(s.damage.versatile, w);
      if (!dmg && s.damage) {
        const flat = Object.values(foundry.utils.flattenObject(s.damage));
        for (const v of flat) { if (typeof v==='string'&&v.match(/\d+d\d+/)){dmg=v;break;} }
      }
      if (!dmg && s.damage?.base?.number&&(s.damage.base.faces||s.damage.base.denomination)) {
        dmg = `${s.damage.base.number}d${s.damage.base.faces||s.damage.base.denomination}`;
      }
      if (typeof dmg==='string' && dmg.match(/[@$][a-zA-Z_]/)) {
        try {
          const sourceData=(w.getRollData?w.getRollData():null)||(actor?.getRollData?actor.getRollData():null)||null;
          if (sourceData) {
            let resolved=dmg;
            const refs = dmg.match(/[@$][a-zA-Z_][\w.]*/g)||[];
            for (const ref of refs) { const path=ref.slice(1).split('.'); let val=sourceData; for (const p of path){ val=val?.[p]; } if (typeof val==='number'&&!Number.isNaN(val)){ resolved=resolved.split(ref).join(String(val)); } }
            if (resolved!==dmg) dmg=resolved;
          }
        } catch(e){}
      }
      dmg = dmg || '–';
      const props=[];
      const propList=s.properties;
      if (Array.isArray(propList)) {
        for (const p of propList) { if(p==='fin'||p==='finesse')props.push('Finesse'); if(p==='thr'||p==='thrown')props.push('Thrown'); if(p==='two'||p==='twoHanded')props.push('Two-Handed'); if(p==='ver'||p==='versatile')props.push('Versatile'); if(p==='lgt'||p==='light')props.push('Light'); if(p==='lod'||p==='loading')props.push('Loading'); }
      } else if (typeof propList==='object'&&propList!==null) {
        if (propList.fin||propList.finesse)props.push('Finesse'); if (propList.thr||propList.thrown)props.push('Thrown'); if (propList.two||propList.twoHanded)props.push('Two-Handed'); if (propList.ver||propList.versatile)props.push('Versatile'); if (propList.lgt||propList.light)props.push('Light'); if (propList.lod||propList.loading)props.push('Loading');
      }
      const propStr=props.length?props.join(', ')+' · ':'';
      const sign=atk>=0?'+':'';
      return `${propStr}${sign}${atk} / ${dmg}`;
    } catch(e){ console.warn('[Combat Companion] weaponStats error:',w?.name,e); return '–'; }
  }

  static _fmtDie(base, w) {
    if (!base||!base.number) return null;
    const faces=base.faces??base.denomination;
    if (!faces) return null;
    let str=`${base.number}d${faces}`;
    let b=base.bonus;
    if (b===null||b===undefined||b===''||b===0) return str;
    if (typeof b==='number') { if (b!==0) str+=b>0?` + ${b}`:` - ${Math.abs(b)}`; return str; }
    const bs=String(b).trim(); if (!bs) return str;
    if (bs.match(/^[@$]/)) {
      try { if (w&&w.getRollData){ const rollData=w.getRollData(); if (rollData){ const resolved=Roll.create(bs,rollData).evaluateSync?.().total??null; if (resolved!==null&&resolved!==0){ str+=resolved>0?` + ${resolved}`:` - ${Math.abs(resolved)}`; return str; } } } } catch(e){}
      return str;
    }
    const bn=Number(bs); if (!isNaN(bn)&&bn!==0){ str+=bn>0?` + ${bn}`:` - ${Math.abs(bn)}`; }
    return str;
  }

  /* ─── Spells with level filter ──────────────────────────────────── */
  static _spellsBox(d) {
    if (!d.spells.length) return this._wrap('Prepared Spells','<em class="cc-muted">No prepared spells</em>');
    const levels = [...new Set(d.spells.map(s=>s.system?.level??0))].sort((a,b)=>a-b);
    const filter = (()=>{ try{return game.settings.get(MODULE_ID,'spellFilter');}catch(e){return 'all';} })();
    let current = d.spells;
    if (filter !== 'all') {
      const target = filter==='Cantrip'?0:parseInt(filter);
      current = d.spells.filter(s=>(s.system?.level??0)===target);
    }
    const opts = ['<option value="all" '+(filter==='all'?'selected':'')+'>All Levels</option>'];
    if (levels.includes(0)) opts.push('<option value="Cantrip" '+(filter==='Cantrip'?'selected':'')+'>Cantrips</option>');
    for (let i=1;i<=9;i++) if(levels.includes(i)) opts.push(`<option value="${i}" ${filter===String(i)?'selected':''}>Level ${i}</option>`);
    const select = opts.join('');
    const list = current.map(s=>{
      const lvl=s.system?.level??0;
      const label=lvl===0?'Cantrip':`Lv ${lvl}`;
      // Action type badge
      const actType = (s.system?.activation?.type || '').toLowerCase();
      let badge = '';
      if (actType==='action') badge = '<span class="cc-badge act">A</span>';
      else if (actType==='bonus') badge = '<span class="cc-badge bns">B</span>';
      else if (actType==='reaction' || actType.includes('reaction')) badge = '<span class="cc-badge rct">R</span>';
      // Save / roll info — show actual numbers
      let rollInfo = '';
      try {
        const activities = s.system?.activities?.contents || Object.values(s.system?.activities || {});
        const act = activities?.[0];
        if (act) {
          // Spell attack bonus
          if (act.attack?.type === 'ranged' || act.attack?.type === 'melee' || act.attack?.type === 'rangedtouch' || act.attack?.type === 'meleetouch' || act.attack === true) {
            const spellAtk = s.actor?.system?.attributes?.spellattack ?? 0;
            const sign = spellAtk >= 0 ? '+' : '';
            rollInfo = `+${sign}${spellAtk} hit`;
          }
          // Save DC
          const save = act.save?.ability || act.save || act.ability;
          if (save && !rollInfo) {
            const dc = act.save?.dc || s.actor?.system?.attributes?.spelldc || '?';
            const abil = typeof save === 'string' ? save : (save.ability || save);
            rollInfo = `DC${dc} ${String(abil).slice(0,3).toUpperCase()}`;
          }
          // Damage
          const dmgParts = act.damage?.parts || [];
          if (dmgParts.length > 0) {
            const dmgStr = dmgParts.map(p => {
              const num = p.number ?? 1;
              const faces = p.faces ?? p.denomination ?? 0;
              const bonus = p.bonus ?? 0;
              let str = `${num}d${faces}`;
              if (bonus) str += bonus > 0 ? `+${bonus}` : `${bonus}`;
              return str;
            }).filter(Boolean).join(' + ');
            if (dmgStr) rollInfo = rollInfo ? `${rollInfo} · ${dmgStr}` : dmgStr;
          } else if (typeof act.damage?.formula === 'string' && act.damage.formula) {
            rollInfo = rollInfo ? `${rollInfo} · ${act.damage.formula}` : act.damage.formula;
          }
        }
        // Fallback: look at spell description for save/attack mentions
        if (!rollInfo && s.system?.description?.value) {
          const desc = s.system.description.value.toLowerCase();
          const saveMatch = desc.match(/dc\s*(\d+)\s*(?:(?:\w+)\s+)?saving/);
          if (saveMatch) {
            const dc = s.actor?.system?.attributes?.spelldc || saveMatch[1];
            rollInfo = `DC${dc} save`;
          } else if (desc.includes('attack roll') || desc.includes('spell attack')) {
            const spellAtk = s.actor?.system?.attributes?.spellattack ?? 0;
            const sign = spellAtk >= 0 ? '+' : '';
            rollInfo = `+${sign}${spellAtk} hit`;
          }
        }
      } catch(e){}
      return `<button class="cc-item-btn" data-item-id="${s.id}" data-type="spell">
        <img src="${s.img||'icons/svg/mystery-man.svg'}" loading="lazy"><span>${s.name}</span>
        <div class="cc-badges">${badge}<small>${rollInfo || label}</small></div>
      </button>`;
    }).join('');
    return this._wrap('Prepared Spells', `
      <div class="cc-filter-row"><select class="cc-filter" data-filter="spells">${select}</select></div>
      <div class="cc-scroll-list">${list||'<em class="cc-muted">No spells match filter</em>'}</div>`);
  }

  static _slotsBox(d) {
    if (!d.spellSlots.length) return this._wrap('Spell Slots','<em class="cc-muted">No spell slots</em>');
    const rows=d.spellSlots.map(s=>{
      const spent=s.max-(s.value??0);
      const dots=Array.from({length:s.max},(_,i)=>`<span class="cc-dot ${i<spent?'spent':''}"></span>`).join('');
      const lbl=typeof s.level==='number'?`Lv ${s.level}`:s.level;
      return `<div class="cc-slot-row"><span class="cc-slot-label">${lbl}</span><div class="cc-dots">${dots}</div>
        <button class="cc-slot-btn" data-level="${s.level}" data-delta="-1"><i class="fas fa-minus"></i></button>
        <button class="cc-slot-btn" data-level="${s.level}" data-delta="1"><i class="fas fa-plus"></i></button>
      </div>`;
    }).join('');
    return this._wrap('Spell Slots', rows);
  }

  static _initiativeBox(d) {
    const sign=d.initiative>=0?'+':'';
    return this._wrap('Initiative',`<button class="cc-big-btn cc-roll-init"><i class="fas fa-dice-d20"></i> Roll ${sign}${d.initiative}</button>`);
  }

  static _resourcesBox(d) {
    if (!d.resources.length) return '';
    let idx=0;
    const list=d.resources.map(r=>`<div class="cc-resource"><span>${r.label||`Resource ${++idx}`}</span>
      <input type="number" value="${r.value??0}" data-res-label="${r.label||''}"> / <span>${r.max}</span></div>`).join('');
    return this._wrap('Resources', list);
  }

  /* ─── Right-click description popup ──────────────────────────── */
  static _showItemDescription(item, event) {
    // Remove any existing popup
    $('#cc-desc-popup').remove();

    const name = item.name || 'Unknown';
    const img = item.img || 'icons/svg/mystery-man.svg';
    const type = item.type || 'item';
    const sys = item.system || {};
    const desc = sys.description?.value || sys.description || '';

    // Strip HTML tags for a clean preview, keep basic formatting
    const stripHtml = (html) => {
      if (!html) return '';
      // Replace common block tags with newlines
      let text = html.replace(/<\/p>/gi, '\n\n').replace(/<\/li>/gi, '\n').replace(/<\/tr>/gi, '\n').replace(/<\/div>/gi, '\n');
      text = text.replace(/<br\s*\/?>/gi, '\n');
      text = text.replace(/<[^>]+>/g, '');
      text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      text = text.replace(/\n{3,}/g, '\n\n').trim();
      return text;
    };

    const cleanDesc = stripHtml(desc);
    const shortDesc = cleanDesc.length > 600 ? cleanDesc.substring(0, 597) + '...' : cleanDesc;

    // Build properties string
    const properties = [];
    if (type === 'weapon') {
      // Use the same calculation as _weaponStats
      const s = item.system || {};
      const actor = item.actor;
      let atk = 0;
      if (actor?.system) {
        const prof = actor.system.attributes?.prof ?? 0;
        const ability = s.ability ?? 'str';
        const props = s.properties || {};
        const isFinesse = props.fin || props.finesse || (Array.isArray(s.properties) && s.properties.includes('fin'));
        let abiMod = actor.system.abilities?.[ability]?.mod ?? 0;
        if (isFinesse) {
          const dexMod = actor.system.abilities?.dex?.mod ?? 0;
          abiMod = Math.max(abiMod, dexMod);
        }
        const magic = typeof s.magicalBonus === 'number' ? s.magicalBonus : 0;
        const flatBonus = typeof s.attackBonus === 'number' ? s.attackBonus : 0;
        let profMult = 0;
        if (typeof s.proficient === 'number') profMult = s.proficient;
        else if (s.proficient === true) profMult = 1;
        atk = Math.round((prof * profMult) + abiMod + magic + flatBonus);
      }
      const sign = atk >= 0 ? '+' : '';
      properties.push(`Attack +${sign}${atk}`);
      // Damage from v4 activities
      let dmgStr = '';
      try {
        const activities = s.activities?.contents || Object.values(s.activities || {});
        const act = activities?.[0];
        if (act?.damage?.parts?.length) {
          dmgStr = act.damage.parts.map(p => {
            const num = p.number ?? 1;
            const faces = p.faces ?? p.denomination ?? 0;
            const bonus = p.bonus ?? 0;
            let str = `${num}d${faces}`;
            if (bonus) str += bonus > 0 ? `+${bonus}` : `${bonus}`;
            return str;
          }).filter(Boolean).join(' + ');
        }
      } catch(e){}
      if (!dmgStr && s.damage?.parts?.length) dmgStr = s.damage.parts.map(p => Array.isArray(p) ? p[0] : p).join(' + ');
      if (!dmgStr && s.damage?.base) dmgStr = `${s.damage.base.number}d${s.damage.base.faces}`;
      if (dmgStr) properties.push(`Damage: ${dmgStr}`);
      if (s.range?.value) properties.push(`Range: ${s.range.value} ft`);
    }
    if (type === 'spell') {
      const lvl = sys.level ?? 0;
      properties.push(lvl === 0 ? 'Cantrip' : `Level ${lvl}`);
      if (sys.school) properties.push(sys.school.label || sys.school);
      // Spell attack bonus
      const spellAtk = item.actor?.system?.attributes?.spellattack ?? 0;
      if (spellAtk) {
        const sgn = spellAtk >= 0 ? '+' : '';
        properties.push(`Attack +${sgn}${spellAtk}`);
      }
      // Save DC
      const spellDC = item.actor?.system?.attributes?.spelldc;
      if (spellDC) properties.push(`DC ${spellDC}`);
      // Damage from activities
      let spellDmg = '';
      try {
        const activities = sys.activities?.contents || Object.values(sys.activities || {});
        const act = activities?.[0];
        if (act?.damage?.parts?.length) {
          spellDmg = act.damage.parts.map(p => {
            const num = p.number ?? 1;
            const faces = p.faces ?? p.denomination ?? 0;
            const bonus = p.bonus ?? 0;
            let str = `${num}d${faces}`;
            if (bonus) str += bonus > 0 ? `+${bonus}` : `${bonus}`;
            return str;
          }).filter(Boolean).join(' + ');
        }
      } catch(e){}
      if (!spellDmg && sys.damage?.parts?.length) spellDmg = sys.damage.parts.map(p => Array.isArray(p) ? p[0] : p).join(' + ');
      if (spellDmg) properties.push(`Damage: ${spellDmg}`);
      if (sys.duration?.value) properties.push(`Duration: ${sys.duration.value} ${sys.duration.units || ''}`);
      if (sys.range?.value) properties.push(`Range: ${sys.range.value} ft`);
      if (sys.activation?.cost) properties.push(`Cast: ${sys.activation.cost} ${sys.activation.type || ''}`);
    }
    if (sys.activation?.type) {
      const actType = sys.activation.type;
      const cost = sys.activation.cost || '';
      if (!properties.some(p => p.toLowerCase().includes('cast') && type === 'spell')) {
        properties.push(`Action: ${cost ? cost + ' ' : ''}${actType}`);
      }
    }

    const propsHtml = properties.length 
      ? `<div class="cc-desc-props">${properties.map(p => `<span class="cc-desc-tag">${p}</span>`).join('')}</div>` 
      : '';

    const pos = { left: event.clientX + 15, top: event.clientY - 10 };
    const panel = $('#cc-sidebar');
    if (panel.length) {
      const panelOffset = panel.offset();
      const panelRight = panelOffset.left + panel.outerWidth();
      if (pos.left + 320 > window.innerWidth) pos.left = event.clientX - 340;
      if (pos.left < 10) pos.left = 10;
    }

    const popup = $(`
      <div id="cc-desc-popup" class="cc-desc-popup" style="left:${pos.left}px;top:${pos.top}px;">
        <div class="cc-desc-header">
          <img src="${img}" alt="" loading="lazy">
          <span>${name}</span>
          <i class="fas fa-times cc-desc-close"></i>
        </div>
        ${propsHtml}
        <div class="cc-desc-body">${cleanDesc ? cleanDesc.split('\n').map(p => p.trim() ? `<p>${p}</p>` : '').join('') : '<em>No description</em>'}</div>
      </div>
    `);
    $('body').append(popup);

    // Close handlers
    popup.find('.cc-desc-close').on('click', () => popup.remove());
    // Close on click outside
    setTimeout(() => {
      $(document).one('mousedown.cc-desc', (e) => {
        if (!$(e.target).closest('#cc-desc-popup').length) {
          popup.remove();
          $(document).off('mousedown.cc-desc');
        }
      });
    }, 10);
  }

  static _wrap(title, body) {
    const cid='cc-box-'+title.replace(/[^a-z0-9]/gi,'');
    let collapsed=false;
    try { collapsed=(game.settings.get(MODULE_ID,'collapsedBoxes')||{})[cid]; } catch(e){}
    return `<div class="cc-box${collapsed?' collapsed':''}" id="${cid}">
      <header><span>${title}</span><i class="fas fa-chevron-down cc-toggle-box"></i></header>
      <div class="cc-box-body">${body}</div>
    </div>`;
  }

  /* ─── Interactions ─────────────────────────────────────────────── */
  static _bindBoxes() {
    $('.cc-box header').off('click.cc-box').on('click.cc-box', function(){
      const box=$(this).closest('.cc-box');
      box.toggleClass('collapsed');
      const collapsed=box.hasClass('collapsed');
      const id=box.attr('id');
      try { const state=game.settings.get(MODULE_ID,'collapsedBoxes')||{}; state[id]=collapsed; game.settings.set(MODULE_ID,'collapsedBoxes',state); } catch(e){}
    });
  }

  static _bindFilters() {
    $('.cc-filter').off('change.cc-filter').on('change.cc-filter', async function(){
      const type=$(this).data('filter');
      const val=$(this).val();
      const settingKey = type==='weapons'?'weaponFilter':type==='spells'?'spellFilter':'featureFilter';
      try { await game.settings.set(MODULE_ID, settingKey, val); } catch(e){}
      CombatCompanion.refresh();
    });
  }

  static _bindInteractions(data) {
    // Items — left click to use, right click for description
    $('.cc-item-btn').off('click.cc-item contextmenu.cc-item').on('click.cc-item', function(){
      const id=$(this).data('item-id');
      const actor=CombatCompanion.actor;
      if (!actor) return;
      const item=actor.items.get(id);
      if (!item) return;
      try { item.use?.(); } catch(e){ console.warn('[Combat Companion] item.use failed:',e); ui.notifications?.warn?.('Could not use item.'); }
    }).on('contextmenu.cc-item', function(e){
      e.preventDefault();
      e.stopPropagation();
      const id=$(this).data('item-id');
      const actor=CombatCompanion.actor;
      if (!actor) return;
      const item=actor.items.get(id);
      if (!item) return;
      CombatCompanion._showItemDescription(item, e);
    });

    // Spell slots
    $('.cc-slot-btn').off('click.cc-slot').on('click.cc-slot', async function(){
      const level=$(this).data('level');
      const delta=parseInt($(this).data('delta'))||0;
      const actor=CombatCompanion.actor;
      if (!actor) return;
      const prop=typeof level==='number'?`system.spells.spell${level}.value`:'system.spells.pact.value';
      try {
        const cur=foundry.utils.getProperty(actor,prop)??0;
        const max=foundry.utils.getProperty(actor,prop.replace('.value','.max'))??0;
        const nxt=Math.max(0,Math.min(max,cur+delta));
        await actor.update({[prop]:nxt});
        ui.notifications?.info?.(`Spell slot ${delta>0?'restored':'used'}.`);
        CombatCompanion.refresh();
      } catch(e){ console.warn('[Combat Companion] slot adjust failed:',e); ui.notifications?.warn?.('Could not adjust spell slot.'); }
    });

    // Initiative
    $('.cc-roll-init').off('click.cc-init').on('click.cc-init',()=>{
      const t=CombatCompanion.token;
      if (!t) return;
      if (t.actor?.rollInitiativeDialog) t.actor.rollInitiativeDialog();
      else if (t.actor?.rollInitiative) t.actor.rollInitiative();
    });

    // HP controls
    $('.cc-hp-btn').off('click.cc-hp').on('click.cc-hp', async function(){
      const actor=CombatCompanion.actor; if (!actor) return;
      const action=$(this).data('hp-action') || '';
      const hp = actor.system?.attributes?.hp || {};
      let cur = hp.value ?? hp.current ?? 0;
      let max = hp.max ?? 1;
      let temp = hp.temp ?? 0;
      if (action === 'heal') {
        const amt = parseInt($('.cc-hp-amount').val()) || 1;
        await actor.update({'system.attributes.hp.value': Math.min(max, cur + amt)});
      } else if (action === 'damage') {
        const amt = parseInt($('.cc-hp-amount').val()) || 1;
        let remaining = amt;
        // Temp HP absorbs damage first
        if (temp > 0) {
          const tempUsed = Math.min(temp, remaining);
          temp -= tempUsed;
          remaining -= tempUsed;
          await actor.update({'system.attributes.hp.temp': temp});
        }
        if (remaining > 0) {
          const overflow = Math.max(0 - Math.floor(max / 2), cur - remaining);
          await actor.update({'system.attributes.hp.value': overflow});
        }
      } else if (action === 'temp') {
        const amt = parseInt($('.cc-hp-temp-amount').val()) || 1;
        await actor.update({'system.attributes.hp.temp': (temp || 0) + amt});
      } else if (action === 'clear-temp') {
        await actor.update({'system.attributes.hp.temp': 0});
      } else if (action === 'death-reset') {
        await actor.unsetFlag(MODULE_ID, 'deathFail').catch(()=>{});
        await actor.unsetFlag(MODULE_ID, 'deathPass').catch(()=>{});
      }
      CombatCompanion.refresh();
    });

    // Death save dots — +/- buttons
    $('.cc-death-btn').off('click.cc-death').on('click.cc-death', async function(){
      const actor=CombatCompanion.actor; if (!actor) return;
      const type = $(this).data('death-type');
      const dir = parseInt($(this).data('death-dir')) || 0;
      const flagKey = type === 'fail' ? 'deathFail' : 'deathPass';
      let cur = parseInt(actor.getFlag(MODULE_ID, flagKey) || 0) || 0;
      const nxt = Math.max(0, Math.min(3, cur + dir));
      await actor.setFlag(MODULE_ID, flagKey, nxt);
      CombatCompanion.refresh();
    });

    // Resources
    $('.cc-resource input').off('change.cc-res').on('change.cc-res', async function(){
      const actor=CombatCompanion.actor; if (!actor) return;
      const val=parseInt($(this).val())||0;
      const label=$(this).data('res-label');
      try { for (const [key,r] of Object.entries(actor.system?.resources||{})) { if (r && r.label===label){ await actor.update({[`system.resources.${key}.value`]:val}); return; } } } catch(e){}
      ui.notifications?.warn?.('Could not map resource.');
    });

    // Reaction toggle
    $('.cc-reaction-btn').off('click.cc-react').on('click.cc-react', async function(){
      const actor = CombatCompanion.actor;
      if (!actor) return;
      try {
        if (actor.system?.uses?.actions) {
          const cur = actor.system.uses.actions;
          const react = !cur.reaction || cur.reaction <= 0 ? 1 : 0;
          await actor.update({'system.uses.actions.reaction': react});
        } else {
          const lastUsed = actor.getFlag(MODULE_ID, 'reactionUsedRound');
          if (lastUsed && game.combat && game.combat.started && game.combat.round === lastUsed) {
            await actor.unsetFlag(MODULE_ID, 'reactionUsedRound');
          } else if (game.combat && game.combat.started) {
            await actor.setFlag(MODULE_ID, 'reactionUsedRound', game.combat.round);
          } else {
            const nowManual = actor.getFlag(MODULE_ID, 'reactionSpentManual');
            if (nowManual) { await actor.unsetFlag(MODULE_ID, 'reactionSpentManual'); }
            else { await actor.setFlag(MODULE_ID, 'reactionSpentManual', true); }
          }
        }
        CombatCompanion.refresh();
      } catch(e) { console.warn('[Combat Companion] toggle failed:',e); }
    });

    // Stats — click to roll ability check and save
    $('.cc-stat').off('click.cc-stat').on('click.cc-stat', async function(){
      const actor=CombatCompanion.actor; if (!actor) return;
      const key=$(this).data('stat');
      try {
        if (typeof actor.rollAbility === 'function') {
          await actor.rollAbility(key);
          CombatCompanion.refreshDebounced();
          return;
        }
      } catch(e) {
        console.warn('[Combat Companion] rollAbility threw, using fallback:', e);
      }
      // Fallback: manual ChatMessage — compute mod from score
      try {
        const abs = actor.system?.abilities || {};
        const a = abs[key];
        if (!a) return;
        const val = a.value ?? 10;
        const mod = Math.floor((val - 10) / 2);
        const sign = mod >= 0 ? '+' : '';
        const label = (a.label || key).toUpperCase();
        const roll = await new Roll(`1d20${sign}${Math.abs(mod)}`).evaluate({async: true});
        await roll.toMessage({
          speaker: ChatMessage.getSpeaker({actor}),
          flavor: `${label} Check`
        });
      } catch(e2) { console.warn('[Combat Companion] stat fallback failed:', e2); }
    });

    // Skills — click to roll
    $('.cc-skill-row').off('click.cc-skill').on('click.cc-skill', async function(){
      const actor=CombatCompanion.actor; if (!actor) return;
      const key=$(this).data('skill');
      const labelMap = {
        acr:'Acrobatics', ani:'Animal Handling', arc:'Arcana', ath:'Athletics',
        dec:'Deception', his:'History', ins:'Insight', itm:'Intimidation',
        inv:'Investigation', med:'Medicine', nat:'Nature', prc:'Perception',
        prf:'Performance', per:'Persuasion', rel:'Religion', slt:'Sleight of Hand',
        ste:'Stealth', sur:'Survival'
      };
      // Use the dnd5e system's native skill roll when available
      if (typeof actor.rollSkill === 'function') {
        try {
          await actor.rollSkill(key, {});
          CombatCompanion.refreshDebounced();
          return;
        } catch(e) {
          console.warn('[Combat Companion] rollSkill threw:', e);
        }
      }
      // Fallback: build a proper dnd5e roll message
      try {
        const sk = actor.system?.skills?.[key];
        if (!sk) { console.warn('[Combat Companion] skill not found:', key); return; }
        // Compute total from ability mod + prof multiplier + bonus
        const abiKey = sk.ability || 'int';
        const abiScore = actor.system?.abilities?.[abiKey]?.value ?? 10;
        const abiMod = Math.floor((abiScore - 10) / 2);
        const profMult = typeof sk.proficient === 'number' ? sk.proficient : 0;
        const bonus = typeof sk.bonus === 'number' ? sk.bonus : 0;
        const profBonus = actor.system?.attributes?.prof ?? 0;
        const total = abiMod + (profMult * profBonus) + bonus;
        const sign = total >= 0 ? '+' : '';
        const label = sk.label || labelMap[key] || key.charAt(0).toUpperCase() + key.slice(1);
        const rollData = actor.getRollData();
        const roll = new Roll(`1d20${sign}${Math.abs(total)}`, rollData);
        await roll.evaluate({async: true});
        await roll.toMessage({
          speaker: ChatMessage.getSpeaker({actor}),
          flavor: `${label} Check`
        });
      } catch(e2) { console.warn('[Combat Companion] skill fallback failed:', e2); }
    });

    // Saving throws
    $('.cc-save-row').off('click.cc-save').on('click.cc-save', async function(){
      const actor=CombatCompanion.actor; if (!actor) return;
      const key=$(this).data('save');
      // dnd5e v3+ native rollAbilitySave
      if (typeof actor.rollAbilitySave === 'function') {
        try {
          await actor.rollAbilitySave(key);
          CombatCompanion.refreshDebounced();
          return;
        } catch(e) {
          console.warn('[Combat Companion] rollAbilitySave threw:', e);
        }
      }
      // Fallback: manual ChatMessage with proper roll
      try {
        const abs = actor.system?.abilities || {};
        const a = abs[key];
        if (!a) return;
        const val = a.value ?? 10;
        const mod = Math.floor((val - 10) / 2);
        const profMult = typeof a.proficient === 'number' ? a.proficient : 0;
        const profBonus = actor.system?.attributes?.prof ?? 0;
        const total = mod + (profMult * profBonus);
        const sign = total >= 0 ? '+' : '';
        const label = a.label || key.charAt(0).toUpperCase() + key.slice(1);
        const rollData = actor.getRollData();
        const roll = new Roll(`1d20${sign}${Math.abs(total)}`, rollData);
        await roll.evaluate({async: true});
        await roll.toMessage({
          speaker: ChatMessage.getSpeaker({actor}),
          flavor: `${label} Saving Throw`
        });
      } catch(e2) { console.warn('[Combat Companion] save roll fallback failed:', e2); }
    });
  }
}

/* ─── Popout Application ───────────────────────────────────────────── */
class CombatCompanionPopout extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'cc-popout', title: 'Combat Companion', template: 'modules/combat-companion/sidebar.html',
      width: 420, height: 680, resizable: true, minimizable: true
    });
  }
  async getData() { return {}; }
  activateListeners(html) {
    super.activateListeners(html);
    const $root=html instanceof HTMLElement?$(html):html;
    const pos=game.settings.get(MODULE_ID,'popoutPosition');
    const el=this.element instanceof HTMLElement?this.element:this.element[0];
    if (el && pos) { el.style.top=`${pos.top}px`; el.style.left=`${pos.left}px`; }
    // Bind minimize toggle — click the header to collapse/expand
    const $header = $root.find('.window-header');
    if ($header.length) {
      $header.off('click.cc-minimize').on('click.cc-minimize', (e) => {
        if ($(e.target).closest('.header-button,.close').length) return;
        const $win = $root.closest('.app') || $root.parent();
        $win.toggleClass('cc-minimized');
        if ($win.hasClass('cc-minimized')) {
          // Save current height and shrink to just header
          $win.data('cc-full-height', $win.outerHeight());
          $win.css('height', $win.find('.window-header').outerHeight() + 'px');
        } else {
          // Restore full height
          const fullH = $win.data('cc-full-height') || 680;
          $win.css('height', fullH + 'px');
        }
      });
    }
    setTimeout(()=>CombatCompanion.refresh(), 50);
  }
  async close(options={}) {
    try { await game.settings.set(MODULE_ID,'popoutOpen',false); } catch(e){}
    $('#cc-menu-toggle').removeClass('active');
    return super.close(options);
  }
}

window.CombatCompanion = CombatCompanion;
