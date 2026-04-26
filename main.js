const MODULE_ID = 'combat-companion';

/* ─── Diagnostic: confirm script load ───────────────────────────── */
console.log(`%c[Combat Companion] Script loaded — v1.3.0`, 'color:#06b6d4;font-weight:bold');

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
});

/* ─── Ready ─────────────────────────────────────────────────────── */
Hooks.on('ready', () => {
  console.log('[Combat Companion] ready hook running');
  try {
    if (game.settings.get(MODULE_ID, 'hudOpen'))    CombatCompanion.open();
    if (game.settings.get(MODULE_ID, 'popoutOpen')) CombatCompanion.openPopout();
  } catch (e) { console.warn('[Combat Companion] ready error:', e); }
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
Hooks.on('updateCombat',      () => CombatCompanion.refreshDebounced());
Hooks.on('deleteCombat',      () => CombatCompanion.refreshDebounced());
Hooks.on('updateToken',       (doc, chg) => {
  if (chg.x !== undefined || chg.y !== undefined) CombatCompanion.refreshDebounced();
});

/* ─── Main Class ───────────────────────────────────────────────── */
class CombatCompanion {
  static _instance = null;
  static get actor() {
    const t = this.token;
    return t?.actor ?? t?.document?.actor ?? null;
  }
  static get token() {
    const c = canvas;
    if (!c) return null;
    const s = c.tokens?.controlled;
    if (s?.size === 1) return s.first();
    return canvas?.tokens?.get(this._lastTokenId) ?? null;
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
    this.refresh();
  }

  static async close() {
    $('#cc-sidebar').hide();
    try { await game.settings.set(MODULE_ID, 'hudOpen', false); } catch(e){}
  }

  /* ── Open popout window ────────────────────────────────────────── */
  static async openPopout() {
    $('#cc-sidebar').hide();
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
      if (!actor) { this._renderNoSelection(); return; }
      const data = this._buildData(actor);
      this._renderAll(data);
    } catch (err) {
      console.error('[Combat Companion] refresh error:', err);
      this._renderError(err.message);
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

    // Initiative
    let initVal = 0;
    try { initVal = attrs.init?.total ?? attrs.init?.value ?? attrs.init ?? sys.abilities?.dex?.mod ?? 0; } catch(e){}

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

    // Resources
    const resources = [];
    try { for (const r of Object.values(sys.resources||{})) { if (r && (r.max??0)>0) resources.push(r); } } catch(e){}

    // Actions
    const actions = { action:1, bonus:1, reaction:1 };
    try { const u=actor.system?.uses?.actions; if (typeof u==='object'){ actions.action=u.action??1; actions.bonus=u.bonus??1; actions.reaction=u.reaction??1; } } catch(e){}

    // Proficiency bonus
    const profBonus = attrs.prof ?? 0;

    // Saving throws
    const savingThrows = [];
    try {
      const abs = sys.abilities || {};
      const saveMap = { str:'Strength', dex:'Dexterity', con:'Constitution', int:'Intelligence', wis:'Wisdom', cha:'Charisma' };
      for (const [key, name] of Object.entries(saveMap)) {
        const a = abs[key] || {};
        const prof = a.proficient ?? 0;
        const mod  = a.mod ?? 0;
        const saveMod = prof ? (mod + profBonus) : mod;
        savingThrows.push({ key, name, mod, prof: prof>0, saveMod });
      }
    } catch(e){}

    return {
      actor, img:actor.img||actor.prototypeToken?.texture?.src||'icons/svg/mystery-man.svg',
      name:actor.name||'Unknown', ac:acVal,
      hp:{current:hpCurrent, max:hpMax, temp:hpTemp, tempmax:hpTempmax},
      prof:profBonus, conditions, concentration, initiative:initVal,
      actions, weapons, spells, spellSlots, resources, savingThrows,
      isNPC:actor.type==='npc',
      labels:actor.labels||{}
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
      this._actionEconomy(data),
      this._savingThrowsBox(data),
      this._conditionsBox(data),
      this._weaponsBox(data),
      this._spellsBox(data),
      this._slotsBox(data),
      this._initiativeBox(data),
      this._resourcesBox(data)
    ];
    const html = sections.join('');
    $('#cc-sidebar .cc-body, #cc-popout .cc-body').html(html);
    this._bindBoxes();
    this._bindFilters(data);
    this._bindInteractions(data);
  }

  static _actorCard(d) {
    const hpMaxTotal = d.hp.max + (d.hp.tempmax||0);
    const hpCurTotal = d.hp.current + (d.hp.temp||0);
    const pct = hpMaxTotal>0 ? Math.max(0,Math.min(100,(hpCurTotal/hpMaxTotal)*100)) : 0;
    const col = pct>50?'#10b981':pct>25?'#f59e0b':'#f43f5e';
    return this._wrap('Actor', `
      <div class="cc-actor"><img src="${d.img}" alt="" loading="lazy"><div>
        <strong>${d.name}</strong>
        <span class="cc-ac"><i class="fas fa-shield-halved"></i> ${d.ac} AC</span>
        <div class="cc-hp-bar"><div style="width:${pct}%;background:${col}"></div></div>
        <span class="cc-hp">${hpCurTotal} / ${hpMaxTotal} HP</span>
        ${d.hp.temp?`<span class="cc-temp">+${d.hp.temp} temp</span>`:''}
      </div></div>`);
  }

  static _actionEconomy(d) {
    return this._wrap('Actions', `
      <div class="cc-actions-row">
        <button class="cc-action-btn ${!d.actions.action?'spent':''}" data-type="action">⚔️ <span>${d.actions.action}</span></button>
        <button class="cc-action-btn ${!d.actions.bonus?'spent':''}" data-type="bonus">⚡ <span>${d.actions.bonus}</span></button>
        <button class="cc-action-btn ${!d.actions.reaction?'spent':''}" data-type="reaction">🛡️ <span>${d.actions.reaction}</span></button>
      </div>`);
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
      const s = w.system||{}; let atk=null;
      if (w.getAttackToHit) { try { const r=w.getAttackToHit(); if (typeof r==='number') atk=r; else if (r&&typeof r.value==='number') atk=r.value; else if (r&&typeof r.total==='number') atk=r.total; } catch(e){} }
      if (atk===null||atk===undefined) {
        atk = s.attack?.bonus ?? s.attackBonus ?? null;
        if ((atk===null||atk===undefined) && w.actor?.system) {
          const prof=w.actor.system.attributes?.prof??0;
          const ability=s.ability??'str';
          const abiMod=w.actor.system.abilities?.[ability]?.mod??0;
          const magic=typeof s.magicalBonus==='number'?s.magicalBonus:0;
          const profMult=typeof s.proficient==='object'?(s.proficient?.multiplier??0):s.proficient?1:0;
          atk = Math.round((prof*profMult)+abiMod+magic);
        }
      }
      atk = atk ?? 0;
      let dmg = null;
      if (w.labels?.damage) dmg=String(w.labels.damage);
      if (!dmg && s.damage?.formula) dmg=s.damage.formula;
      if (!dmg && s.formula) dmg=s.formula;
      if (!dmg && s.attack?.parts?.length) dmg=s.attack.parts.map(p=>Array.isArray(p)?p[0]:String(p)).filter(Boolean).join(' + ');
      if (!dmg && s.damage?.parts?.length) dmg=s.damage.parts.map(p=>Array.isArray(p)?p[0]:String(p)).filter(Boolean).join(' + ');
      if (!dmg && s.damage?.base) dmg=this._fmtDie(s.damage.base,w);
      if (!dmg && s.damage?.versatile) dmg=this._fmtDie(s.damage.versatile,w);
      if (!dmg && s.damage) {
        const flat=Object.values(foundry.utils.flattenObject(s.damage));
        for (const v of flat) { if (typeof v==='string'&&v.match(/\d+d\d+/)){dmg=v;break;} }
      }
      if (!dmg && s.damage?.base?.number&&(s.damage.base.faces||s.damage.base.denomination)) {
        dmg=`${s.damage.base.number}d${s.damage.base.faces||s.damage.base.denomination}`;
      }
      if (typeof dmg==='string' && dmg.match(/[@$][a-zA-Z_]/)) {
        try {
          const sourceData=(w.getRollData?w.getRollData():null)||(w.actor?.getRollData?w.actor.getRollData():null)||null;
          if (sourceData) {
            let resolved=dmg;
            const refs=dmg.match(/[@$][a-zA-Z_][\w.]*/g)||[];
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
      return `<button class="cc-item-btn" data-item-id="${s.id}" data-type="spell">
        <img src="${s.img||'icons/svg/mystery-man.svg'}" loading="lazy"><span>${s.name}</span><small>${label}</small>
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

  static _bindFilters(data) {
    $('.cc-filter').off('change.cc-filter').on('change.cc-filter', async function(){
      const type=$(this).data('filter');
      const val=$(this).val();
      try { await game.settings.set(MODULE_ID, type==='weapons'?'weaponFilter':'spellFilter', val); } catch(e){}
      CombatCompanion._renderAll(data);
    });
  }

  static _bindInteractions(data) {
    // Items
    $('.cc-item-btn').off('click.cc-item').on('click.cc-item', function(){
      const id=$(this).data('item-id');
      const actor=CombatCompanion.actor;
      if (!actor) return;
      const item=actor.items.get(id);
      if (!item) return;
      try { item.use?.(); } catch(e){ console.warn('[Combat Companion] item.use failed:',e); ui.notifications?.warn?.('Could not use item.'); }
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

    // Resources
    $('.cc-resource input').off('change.cc-res').on('change.cc-res', async function(){
      const actor=CombatCompanion.actor; if (!actor) return;
      const val=parseInt($(this).val())||0;
      const label=$(this).data('res-label');
      try { for (const [key,r] of Object.entries(actor.system?.resources||{})) { if (r && r.label===label){ await actor.update({[`system.resources.${key}.value`]:val}); return; } } } catch(e){}
      ui.notifications?.warn?.('Could not map resource.');
    });

    // Saving throws
    $('.cc-save-row').off('click.cc-save').on('click.cc-save', function(){
      const actor=CombatCompanion.actor; if (!actor) return;
      const key=$(this).data('save');
      const ability = key.toLowerCase();
      try {
        const abs = actor.system?.abilities || {};
        const a = abs[ability];
        if (!a) return;
        // Let dnd5e handle the actual roll — just request it
        if (actor.rollAbilitySave) {
          actor.rollAbilitySave(ability);
        } else {
          // Fallback: manual chat message
          const mod = a.mod ?? 0;
          const prof = a.proficient ?? 0;
          const profBonus = actor.system?.attributes?.prof ?? 0;
          const total = prof ? (mod + profBonus) : mod;
          const sign = total >= 0 ? '+' : '';
          ChatMessage.create({
            speaker: ChatMessage.getSpeaker({actor}),
            flavor: `${a.label || ability.toUpperCase()} Saving Throw`,
            content: `<p><strong>${a.label || ability.toUpperCase()} Save</strong>: 1d20 ${sign}${total}</p>`,
            rolls: [new Roll(`1d20 ${sign}${total}`, actor.getRollData()).evaluateSync()]
          });
        }
      } catch(e) { console.warn('[Combat Companion] save roll failed:',e); }
    });
  }
}

/* ─── Popout Application ───────────────────────────────────────────── */
class CombatCompanionPopout extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'cc-popout', title: 'Combat Companion', template: 'modules/combat-companion/sidebar.html',
      width: 420, height: 680, resizable: true
    });
  }
  async getData() { return {}; }
  activateListeners(html) {
    super.activateListeners(html);
    const $root=html instanceof HTMLElement?$(html):html;
    const pos=game.settings.get(MODULE_ID,'popoutPosition');
    const el=this.element instanceof HTMLElement?this.element:this.element[0];
    if (el && pos) { el.style.top=`${pos.top}px`; el.style.left=`${pos.left}px`; }
    setTimeout(()=>CombatCompanion.refresh(), 50);
  }
  async close(options={}) {
    try { await game.settings.set(MODULE_ID,'popoutOpen',false); } catch(e){}
    return super.close(options);
  }
}

window.CombatCompanion = CombatCompanion;
