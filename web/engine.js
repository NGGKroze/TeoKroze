'use strict';
/* Riftbound prototype rules engine (YGO-style rules, original cards).
 * Works in Node and the browser. All decisions go through g.ctl[pid].decide(g, pid, req). */
(function (root) {
  class GameOver extends Error { constructor(w, why) { super('gameover'); this.winner = w; this.why = why; } }
  const E = { GameOver };
  let DEFS = {};
  E.setCards = (arr) => { DEFS = {}; arr.forEach((c) => (DEFS[c.id] = c)); return DEFS; };
  E.defs = () => DEFS;

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const opp = (p) => 1 - p;
  const FIELD_ZONES = ['unit', 'support', 'field'];
  const HAND_MAX = 6;

  // ------------------------------------------------------------------ setup
  E.newGame = function (o) {
    const seed = o.seed == null ? 1 : o.seed;
    const g = {
      seed, r: rng(seed), turn: 0, active: o.first == null ? 0 : o.first, phase: 'setup',
      over: false, winner: null, why: '', players: [], logs: [], used: [{}, {}], uid: 0,
      battle: null, ctl: o.controllers, onUpdate: o.onUpdate || null, onLog: o.onLog || null,
      maxTurns: o.maxTurns || 80, stats: { triggers: 0 },
    };
    for (let pid = 0; pid < 2; pid++) {
      const P = { id: pid, name: (o.names && o.names[pid]) || 'P' + pid, lp: 8000, deck: [], hand: [], gy: [], banish: [], extra: [],
        units: [null, null, null, null, null], support: [null, null, null, null, null], field: null,
        normalSummoned: false };
      g.players.push(P);
      o.decks[pid].main.forEach((id) => P.deck.push(mk(g, id, pid, 'deck')));
      (o.decks[pid].extra || []).forEach((id) => P.extra.push(mk(g, id, pid, 'extra')));
      shuffle(g, P.deck);
    }
    return g;
  };
  function mk(g, id, owner, zone) {
    if (!DEFS[id]) throw new Error('unknown card ' + id);
    return { uid: ++g.uid, id, def: DEFS[id], owner, ctl: owner, zone, pos: null, fd: false, setTurn: -1, summonTurn: -1,
      attacked: false, posChanged: false, equippedTo: null, equips: [], negated: false, negTurn: -1 };
  }
  function shuffle(g, a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(g.r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }
  function log(g, t) { g.logs.push(t); if (g.onLog) g.onLog(t); }
  E.log = log;
  const P = (g, pid) => g.players[pid];
  const unitsOf = (g, pid) => g.players[pid].units.filter(Boolean);
  const supportOf = (g, pid) => g.players[pid].support.filter(Boolean);

  // ------------------------------------------------------------------ matching / zones
  function matches(c, f, src) {
    if (!f) return true;
    const d = c.def;
    for (const k in f) {
      const v = f[k];
      switch (k) {
        case 'archetype': if (d.archetype !== v) return false; break;
        case 'type': if (!(Array.isArray(v) ? v : [v]).includes(d.type)) return false; break;
        case 'subtype': if (!(Array.isArray(v) ? v : [v]).includes(d.subtype)) return false; break;
        case 'race': if (d.race !== v) return false; break;
        case 'attribute': if (d.attribute !== v) return false; break;
        case 'level_max': if (!(d.level <= v)) return false; break;
        case 'level_min': if (!(d.level >= v)) return false; break;
        case 'id': if (!(Array.isArray(v) ? v : [v]).includes(c.id)) return false; break;
        case 'exclude_self': if (v && src && c === src) return false; break;
      }
    }
    return true;
  }
  function removeFrom(g, c) {
    const pl = g.players[FIELD_ZONES.includes(c.zone) ? c.ctl : c.owner];
    const rm = (a) => { const i = a.indexOf(c); if (i >= 0) a.splice(i, 1); };
    switch (c.zone) {
      case 'deck': rm(pl.deck); break;
      case 'hand': rm(pl.hand); break;
      case 'gy': rm(pl.gy); break;
      case 'banish': rm(pl.banish); break;
      case 'extra': rm(pl.extra); break;
      case 'unit': pl.units[pl.units.indexOf(c)] = null; break;
      case 'support': pl.support[pl.support.indexOf(c)] = null; break;
      case 'field': pl.field = null; break;
    }
  }
  function freeSlots(g, pid, kind) { return g.players[pid][kind].filter((x) => !x).length; }
  function place(g, c, zone, o) {
    o = o || {};
    const wasField = FIELD_ZONES.includes(c.zone);
    removeFrom(g, c);
    if (wasField) {
      for (const e of c.equips.slice()) { e.equippedTo = null; place(g, e, 'gy'); }
      c.equips = [];
      if (c.equippedTo) { c.equippedTo.equips = c.equippedTo.equips.filter((x) => x !== c); c.equippedTo = null; }
      c.negated = false; c.pos = null; c.fd = false;
    }
    c.zone = zone;
    const pl = g.players[c.owner];
    if (!FIELD_ZONES.includes(zone)) c.ctl = c.owner;
    switch (zone) {
      case 'deck': pl.deck.push(c); break;
      case 'hand': pl.hand.push(c); break;
      case 'gy': pl.gy.push(c); break;
      case 'banish': pl.banish.push(c); break;
      case 'extra': pl.extra.push(c); break;
      case 'unit': { c.ctl = o.ctl == null ? c.owner : o.ctl; const arr = g.players[c.ctl].units; arr[arr.indexOf(null)] = c;
        c.pos = o.pos || 'atk'; c.summonTurn = g.turn; c.attacked = false; c.posChanged = false; break; }
      case 'support': { c.ctl = o.ctl == null ? c.owner : o.ctl; const arr = g.players[c.ctl].support; arr[arr.indexOf(null)] = c;
        c.fd = !!o.fd; c.setTurn = g.turn; break; }
      case 'field': { c.ctl = o.ctl == null ? c.owner : o.ctl; const p2 = g.players[c.ctl];
        if (p2.field) place(g, p2.field, 'gy'); p2.field = c; break; }
    }
  }
  function fieldCards(g) {
    const out = [];
    for (const pl of g.players) {
      pl.units.forEach((c) => c && out.push(c));
      pl.support.forEach((c) => c && !c.fd && out.push(c));
      if (pl.field) out.push(pl.field);
    }
    return out;
  }
  function controls(g, pid, f) {
    return unitsOf(g, pid).some((c) => matches(c, f)) ||
      supportOf(g, pid).some((c) => !c.fd && matches(c, f)) || (g.players[pid].field && matches(g.players[pid].field, f));
  }
  function condOK(g, src, cond) {
    if (!cond) return true;
    if (cond === 'self_in_defense') return src.pos === 'def';
    if (cond === 'controller_has_no_units') return unitsOf(g, src.ctl).length === 0;
    if (cond === 'controller_controls') return true;
    if (typeof cond === 'object' && cond.you_control) return controls(g, src.ctl, cond.you_control);
    return true;
  }
  function stat(g, c, s) {
    let v = c.def[s];
    for (const src of fieldCards(g)) {
      if (src.negated) continue;
      for (const fx of src.def.effects) {
        if (fx.timing !== 'continuous' || !condOK(g, src, fx.condition)) continue;
        for (const op of fx.ops || []) {
          if (op.op !== 'modify_stat' || op.stat !== s) continue;
          let applies;
          if (fx.equip_filter) applies = src.equippedTo === c;
          else if (op.filter) applies = c.zone === 'unit' && matches(c, op.filter, src);
          else applies = src === c;
          if (!applies) continue;
          let amt = op.amount;
          if (op.per) amt *= unitsOf(g, src.ctl).filter((u) => u !== src && matches(u, op.per.filter)).length;
          v += amt;
        }
      }
    }
    return Math.max(0, v);
  }
  E.stat = stat;
  function kw(g, c, k) {
    if (c.zone !== 'unit') return false;
    for (const src of fieldCards(g)) {
      if (src.negated) continue;
      for (const fx of src.def.effects) {
        if (fx.timing !== 'continuous' || !condOK(g, src, fx.condition)) continue;
        if (fx.keyword === k && src === c) return true;
        for (const op of fx.ops || []) {
          if (op.op !== 'grant' || op.keyword !== k) continue;
          if (!op.filter) { if (src === c) return true; }
          else if (src.ctl === c.ctl && matches(c, op.filter, src)) return true;
        }
      }
    }
    return false;
  }
  E.kw = kw;
  function forcedTargets(g, attPid) {
    const out = [];
    for (const u of unitsOf(g, opp(attPid))) {
      if (u.negated) continue;
      for (const fx of u.def.effects) if (fx.timing === 'continuous' && condOK(g, u, fx.condition) && (fx.ops || []).some((o) => o.op === 'force_attack_target')) out.push(u);
    }
    return out;
  }
  function limitOK(g, c, i) { const fx = c.def.effects[i]; return !fx.limit || g.used[c.ctl][c.id + ':' + i] !== g.turn; }
  function useLimit(g, c, i) { if (c.def.effects[i].limit) g.used[c.ctl][c.id + ':' + i] = g.turn; }

  // ------------------------------------------------------------------ asking
  async function ask(g, pid, req) {
    req.pid = pid; g.pending = req;
    if (g.onUpdate) g.onUpdate(g);
    const res = await g.ctl[pid].decide(g, pid, req);
    g.pending = null;
    return res;
  }
  async function pick(g, pid, purpose, cards, o) {
    o = o || {};
    const min = o.min == null ? 1 : o.min, max = o.max == null ? 1 : o.max;
    if (!cards.length) return [];
    if (min >= cards.length && max >= cards.length) return cards.slice();
    return ask(g, pid, { kind: 'pick', purpose, cards, min, max, title: o.title || purpose, src: o.src });
  }

  // ------------------------------------------------------------------ primitives
  function checkLP(g) {
    const l0 = g.players[0].lp <= 0, l1 = g.players[1].lp <= 0;
    if (l0 && l1) throw new GameOver(-1, 'Двамата на 0 LP');
    if (l0) throw new GameOver(1, 'LP 0');
    if (l1) throw new GameOver(0, 'LP 0');
  }
  function damage(g, pid, amt, why) {
    if (amt <= 0) return;
    g.players[pid].lp -= amt; log(g, `${P(g, pid).name} губи ${amt} LP${why ? ' (' + why + ')' : ''} → ${Math.max(0, g.players[pid].lp)}`);
    checkLP(g);
  }
  function draw(g, pid, n, why) {
    for (let i = 0; i < n; i++) {
      const pl = P(g, pid);
      if (!pl.deck.length) throw new GameOver(opp(pid), 'Тестето свърши');
      place(g, pl.deck[0], 'hand');
    }
    log(g, `${P(g, pid).name} тегли ${n}${why ? ' (' + why + ')' : ''}`);
  }
  async function toGY(g, c, cause) {
    const wasUnit = c.zone === 'unit';
    place(g, c, 'gy');
    if (c.def.type === 'unit') {
      if (cause === 'discard') await fireSelf(g, c, 'discarded', {});
      await fireSelf(g, c, 'sent_to_graveyard', { wasUnit });
    }
  }
  // destroy; returns true if the card actually left the field
  async function destroy(g, c, o) {
    o = o || {};
    if (c.zone === 'unit' || FIELD_ZONES.includes(c.zone)) {
      if (o.by === 'effect' && kw(g, c, 'indestructible_by_effect')) {
        const i = c.def.effects.findIndex((fx) => fx.keyword === undefined && (fx.ops || []).some((x) => x.keyword === 'indestructible_by_effect'));
        if (i < 0 || limitOK(g, c, i)) { if (i >= 0) useLimit(g, c, i); log(g, `${c.def.name} не може да бъде унищожена от ефект`); return false; }
      }
      if (c.zone === 'unit' && !o.noReplace) {
        for (const w of unitsOf(g, c.ctl)) {
          if (w === c || w.negated) continue;
          const i = w.def.effects.findIndex((fx) => fx.timing === 'replacement');
          if (i < 0 || !limitOK(g, w, i) || !matches(c, w.def.effects[i].filter)) continue;
          const yes = await ask(g, w.ctl, { kind: 'yesno', title: `${w.def.name}: унищожи я вместо ${c.def.name}?`, src: w });
          if (yes) { useLimit(g, w, i); log(g, `${w.def.name} се жертва вместо ${c.def.name}`); await destroy(g, w, { by: o.by, noReplace: true }); return false; }
        }
      }
    }
    const wasUnit = c.zone === 'unit';
    place(g, c, 'gy');
    log(g, `${c.def.name} е унищожена`);
    if (c.def.type === 'unit') {
      if (o.by === 'battle') await fireSelf(g, c, 'destroyed_by_battle', {});
      await fireSelf(g, c, 'sent_to_graveyard', { wasUnit });
    }
    return true;
  }

  // ------------------------------------------------------------------ triggers & effects
  async function fireSelf(g, c, name, extra) {
    if (g.over) return;
    const fxs = c.def.effects;
    for (let i = 0; i < fxs.length; i++) {
      const fx = fxs[i];
      if (fx.timing !== 'trigger' || fx.trigger !== name) continue;
      const onField = c.zone === 'unit';
      const needField = ['normal_summoned', 'tribute_summoned', 'merge_summoned', 'destroyed_unit_by_battle', 'equipped'].includes(name);
      if (needField && !onField) continue;
      if (c.negated || !limitOK(g, c, i)) continue;
      await runEffect(g, c, i, extra || {});
    }
  }
  function targetCands(g, pid, c, fx) {
    const sp = fx.target;
    if (!sp) return null;
    const ctlOf = (z) => (sp.controller === 'opponent' ? [opp(pid)] : sp.controller === 'you' ? [pid] : [0, 1]);
    let out = [];
    if (sp.zone === 'units') for (const q of ctlOf()) out.push(...unitsOf(g, q));
    else if (sp.zone === 'support') for (const q of ctlOf()) { out.push(...supportOf(g, q)); if (g.players[q].field) out.push(g.players[q].field); }
    else if (sp.zone === 'graveyard') for (const q of ctlOf()) out.push(...g.players[q].gy);
    out = out.filter((x) => matches(x, sp.filter, c) && x !== c);
    if (sp.zone === 'units') out = out.filter((x) => x.ctl === pid || !kw(g, x, 'untargetable'));
    return out;
  }
  async function runEffect(g, c, i, extra) {
    const fx = c.def.effects[i];
    const pid = c.ctl;
    let chosen = [];
    if (fx.target) {
      const cands = targetCands(g, pid, c, fx);
      if (!cands.length) return false;
      chosen = await pick(g, pid, 'target:' + firstOp(fx), cands, { min: fx.target.count || 1, max: fx.target.count || 1, title: c.def.name, src: c });
    }
    if (fx.cost && !(await payCost(g, pid, c, fx.cost))) return false;
    useLimit(g, c, i);
    g.stats.triggers++;
    log(g, `${c.def.name}: ефект`);
    const ctx = Object.assign({ card: c, ctl: pid, chosen, fx }, extra);
    for (const op of fx.ops || []) { if (g.over) return true; await execOp(g, ctx, op); }
    return true;
  }
  const firstOp = (fx) => (fx.ops && fx.ops[0] && fx.ops[0].op) || '';
  function canPay(g, pid, cost) {
    for (const k of cost || []) if (k.discard && P(g, pid).hand.length < k.discard) return false;
    return true;
  }
  async function payCost(g, pid, c, cost) {
    if (!canPay(g, pid, cost)) return false;
    for (const k of cost) if (k.discard) {
      const sel = await pick(g, pid, 'discard', P(g, pid).hand.slice(), { min: k.discard, max: k.discard, title: 'Изхвърли ' + k.discard + ' за ' + c.def.name, src: c });
      for (const d of sel) { log(g, `${P(g, pid).name} изхвърля ${d.def.name}`); await toGY(g, d, 'discard'); }
    }
    return true;
  }
  function amountOf(g, ctx, a) {
    if (typeof a === 'number') return a;
    if (a.half_of === 'destroyed_unit_atk') return Math.floor((ctx.destroyedAtk || 0) / 2);
    if (a.if) return controls(g, ctx.ctl, a.if.you_control) ? a.then : a.else;
    return 0;
  }
  async function execOp(g, ctx, op) {
    const pid = ctx.ctl;
    const who = (t) => (t === 'opponent' ? opp(pid) : pid);
    switch (op.op) {
      case 'damage': damage(g, who(op.target), amountOf(g, ctx, op.amount), ctx.card.def.name); break;
      case 'gain_lp': { const q = who(op.player === 'opponent' ? 'opponent' : 'you'); P(g, q).lp += op.amount; log(g, `${P(g, q).name} печели ${op.amount} LP`); break; }
      case 'draw': draw(g, who(op.player), op.count, ctx.card.def.name); break;
      case 'discard': {
        const q = who(op.player);
        const sel = await pick(g, q, 'discard', P(g, q).hand.slice(), { min: Math.min(op.count, P(g, q).hand.length), max: op.count, title: 'Изхвърли ' + op.count, src: ctx.card });
        for (const d of sel) { log(g, `${P(g, q).name} изхвърля ${d.def.name}`); await toGY(g, d, 'discard'); }
        break;
      }
      case 'search': {
        const zones = [].concat(op.from);
        let cands = [];
        for (const z of zones) cands.push(...(z === 'deck' ? P(g, pid).deck : P(g, pid).gy).filter((x) => matches(x, op.filter, ctx.card)));
        const seen = {}; const uniq = cands.filter((x) => (seen[x.id] ? false : (seen[x.id] = true)));
        if (!uniq.length) { log(g, 'Няма какво да се търси'); break; }
        const sel = await pick(g, pid, 'search', uniq, { min: 1, max: 1, title: 'Намери карта', src: ctx.card });
        const t = cands.find((x) => x.id === sel[0].id);
        place(g, t, 'hand'); log(g, `${P(g, pid).name} добавя ${t.def.name} в ръката`);
        if (zones.includes('deck')) shuffle(g, P(g, pid).deck);
        break;
      }
      case 'add_to_hand': for (const t of ctx.chosen) place(g, t, 'hand'); break;
      case 'special_summon': {
        let c;
        if (op.target === 'self') c = ctx.card;
        else if (op.target === 'chosen') c = ctx.chosen[0];
        else {
          const pool = op.from === 'hand' ? P(g, pid).hand : P(g, pid).gy;
          const cands = pool.filter((x) => matches(x, op.filter, ctx.card));
          if (!cands.length) break;
          c = (await pick(g, pid, 'revive', cands, { title: 'Призови', src: ctx.card }))[0];
        }
        if (!c || !['hand', 'gy', 'banish'].includes(c.zone) || !freeSlots(g, pid, 'units')) break;
        place(g, c, 'unit', { ctl: pid, pos: op.position || 'atk' });
        if (op.negate_effects) { c.negated = true; c.negTurn = g.turn; }
        log(g, `${P(g, pid).name} призовава ${c.def.name} (special)`);
        break;
      }
      case 'destroy': {
        let t = [];
        if (op.target === 'chosen') t = ctx.chosen; else if (op.target === 'self') t = [ctx.card];
        else if (op.target === 'battle_opponent') t = [ctx.ev.destroyer]; else if (op.target === 'attacker') t = [ctx.ev.attacker];
        else if (op.target === 'summoned_unit') t = [ctx.ev.card]; else if (op.target === 'activated_card') t = [];
        for (const x of t) if (x && FIELD_ZONES.includes(x.zone)) await destroy(g, x, { by: 'effect', src: ctx.card });
        break;
      }
      case 'negate_attack': if (g.battle) { g.battle.negated = true; log(g, 'Атаката е отречена'); } break;
      case 'negate_summon': if (ctx.ev) { ctx.ev.negated = true; log(g, 'Призоваването е отречено'); } break;
      case 'negate_activation': if (ctx.link && ctx.link.below) { ctx.link.below.negated = true; log(g, 'Активацията е отречена'); } break;
      case 'set_position': if (ctx.ev && ctx.ev.target && ctx.ev.target.zone === 'unit') ctx.ev.target.pos = op.position; break;
      case 'equip_from': {
        const cands = P(g, pid).deck.filter((x) => matches(x, op.filter, ctx.card));
        if (!cands.length || !freeSlots(g, pid, 'support')) break;
        const seen = {}; const uniq = cands.filter((x) => (seen[x.id] ? false : (seen[x.id] = true)));
        const sel = (await pick(g, pid, 'search', uniq, { title: 'Екипирай', src: ctx.card }))[0];
        const e = cands.find((x) => x.id === sel.id);
        await attachEquip(g, e, ctx.card, pid); shuffle(g, P(g, pid).deck);
        break;
      }
      case 'merge_summon': await mergeSummon(g, pid, op); break;
      case 'modify_stat': case 'grant': case 'force_attack_target': break;
      default: log(g, `[прототип] неподдържан ефект: ${op.op}`);
    }
  }
  async function attachEquip(g, e, host, pid) {
    place(g, e, 'support', { ctl: pid, fd: false });
    e.equippedTo = host; host.equips.push(e);
    log(g, `${e.def.name} се екипира на ${host.def.name}`);
    await fireSelf(g, host, 'equipped', {});
  }

  // ------------------------------------------------------------------ merge
  function mergeAssign(pool, mats) {
    // backtracking assignment of distinct pool cards to material filters
    const used = new Set();
    const rec = (i, out) => {
      if (i === mats.length) return out;
      for (const c of pool) {
        if (used.has(c) || !matches(c, mats[i])) continue;
        used.add(c); const r = rec(i + 1, out.concat(c)); if (r) return r; used.delete(c);
      }
      return null;
    };
    return rec(0, []);
  }
  function mergePool(g, pid, zones) {
    const pl = P(g, pid); let pool = [];
    if (zones.includes('hand')) pool.push(...pl.hand.filter((c) => c.def.type === 'unit'));
    if (zones.includes('field')) pool.push(...unitsOf(g, pid));
    if (zones.includes('graveyard')) pool.push(...pl.gy.filter((c) => c.def.type === 'unit'));
    return pool;
  }
  function mergeOptions(g, pid, op) {
    const zones = (op && op.material_zones) || ['hand', 'field'];
    const pool = mergePool(g, pid, zones);
    const out = [];
    for (const m of P(g, pid).extra) {
      if (m.def.subtype !== 'merge' || (op && op.filter && !matches(m, op.filter))) continue;
      const a = mergeAssign(pool, m.def.materials);
      if (a) {
        // need room: materials from field free zones
        const fieldMats = a.filter((x) => x.zone === 'unit').length;
        if (freeSlots(g, pid, 'units') + fieldMats > 0) out.push(m);
      }
    }
    return out;
  }
  E.mergeOptions = mergeOptions;
  async function mergeSummon(g, pid, op) {
    const opts = mergeOptions(g, pid, op);
    if (!opts.length) return false;
    const m = (await pick(g, pid, 'merge', opts, { title: 'Merge Summon', src: null }))[0];
    const zones = op.material_zones || ['hand', 'field'];
    const pool = mergePool(g, pid, zones);
    // let player choose materials per slot
    const chosen = [];
    for (const f of m.def.materials) {
      const left = pool.filter((c) => !chosen.includes(c) && matches(c, f));
      // keep feasibility: only offer cards that still allow completion
      const feasible = left.filter((c) => mergeAssign(pool.filter((x) => !chosen.includes(x) && x !== c), m.def.materials.slice(chosen.length + 1)));
      const sel = (await pick(g, pid, 'merge_material', feasible, { title: 'Материал за ' + m.def.name, src: m }))[0];
      chosen.push(sel);
    }
    for (const c of chosen) {
      if (c.zone === 'gy') { place(g, c, 'banish'); continue; }
      await toGY(g, c, 'material');
      await fireSelf(g, c, 'used_as_merge_material', {});
    }
    place(g, m, 'unit', { ctl: pid, pos: 'atk' });
    log(g, `${P(g, pid).name} Merge Summon: ${m.def.name}`);
    const ev = { name: 'summon', card: m, negated: false, actor: pid };
    await eventWindow(g, opp(pid), ev);
    if (ev.negated) { if (m.zone === 'unit') await destroy(g, m, { by: 'effect', noReplace: true }); return true; }
    await fireSelf(g, m, 'merge_summoned', {});
    return true;
  }

  // ------------------------------------------------------------------ chain / snares
  function trigMatch(g, pid, fx, ev) {
    switch (fx.trigger) {
      case 'opponent_attack_declared':
        if (ev.name !== 'attack' || ev.attacker.ctl === pid) return false;
        if (fx.condition && fx.condition.attacker_atk_min && stat(g, ev.attacker, 'atk') < fx.condition.attacker_atk_min) return false;
        return true;
      case 'opponent_attack_declared_on_ally': return ev.name === 'attack' && ev.attacker.ctl !== pid && ev.target && ev.target.ctl === pid && matches(ev.target, fx.filter);
      case 'opponent_summons': return ev.name === 'summon' && ev.card.ctl !== pid;
      case 'opponent_activates_tactic': return ev.name === 'tactic' && ev.link.ctl !== pid;
      case 'ally_destroyed_by_battle': return ev.name === 'ally_destroyed' && ev.destroyed.owner === pid && matches(ev.destroyed, fx.filter);
    }
    return false;
  }
  function eligibleSnares(g, pid, ev, depth) {
    return supportOf(g, pid).filter((c) => c.fd && c.def.type === 'snare' && c.setTurn < g.turn &&
      (depth === 0 || c.def.subtype === 'counter') && trigMatch(g, pid, c.def.effects[0], ev));
  }
  // Responder may activate a set snare in reaction to ev; chain then alternates (counters only) and resolves LIFO
  async function eventWindow(g, pid, ev) {
    if (g.over) return;
    const opts = eligibleSnares(g, pid, ev, 0);
    if (!opts.length) return;
    const s = await ask(g, pid, { kind: 'respond', options: opts, ev, title: 'Активирай Snare?' });
    if (!s) return;
    const link = { card: s, ctl: pid, chosen: [], ev, negated: false, below: null };
    await runChain(g, link, 0);
  }
  async function runChain(g, first, depth) {
    first.card.fd = false;
    log(g, `${P(g, first.ctl).name} активира ${first.card.def.name}`);
    const chain = [first]; let last = first;
    for (let guard = 0; guard < 6; guard++) {
      const responder = opp(last.ctl);
      const ev = { name: last.card.def.type === 'tactic' ? 'tactic' : 'other', link: last };
      const opts = eligibleSnares(g, responder, ev, chain.length);
      if (!opts.length) break;
      const s = await ask(g, responder, { kind: 'respond', options: opts, ev, title: 'Counter срещу ' + last.card.def.name });
      if (!s) break;
      s.fd = false; log(g, `${P(g, responder).name} активира ${s.def.name}`);
      const l = { card: s, ctl: responder, chosen: [], ev, negated: false, below: last };
      chain.push(l); last = l;
    }
    for (let i = chain.length - 1; i >= 0 && !g.over; i--) await resolveLink(g, chain[i]);
  }
  async function resolveLink(g, link) {
    const c = link.card, d = c.def;
    if (link.negated) { log(g, `${d.name} е отречена`); await finishCard(g, c); return; }
    if (d.type === 'snare') {
      const fx = d.effects[0];
      const ctx = { card: c, ctl: link.ctl, chosen: link.chosen, ev: link.ev, link, fx };
      for (const op of fx.ops) { if (g.over) return; await execOp(g, ctx, op); }
      await finishCard(g, c);
      return;
    }
    // tactic
    if (['continuous', 'field', 'equip'].includes(d.subtype)) {
      if (d.subtype === 'equip') {
        const host = link.chosen[0];
        if (!host || host.zone !== 'unit' || !freeSlots(g, link.ctl, 'support')) { await finishCard(g, c); return; }
        await attachEquip(g, c, host, link.ctl);
      } else if (d.subtype === 'field') place(g, c, 'field', { ctl: link.ctl });
      else { if (!freeSlots(g, link.ctl, 'support')) { await finishCard(g, c); return; } place(g, c, 'support', { ctl: link.ctl, fd: false }); }
      return;
    }
    const fx = d.effects.find((e) => e.timing === 'on_resolve');
    const ctx = { card: c, ctl: link.ctl, chosen: link.chosen.filter((x) => x.zone !== 'limbo'), ev: link.ev, link, fx };
    for (const op of fx.ops) { if (g.over) return; await execOp(g, ctx, op); }
    await finishCard(g, c);
  }
  async function finishCard(g, c) { if (c.zone === 'limbo' || c.zone === 'support') place(g, c, 'gy'); }

  // ------------------------------------------------------------------ activation legality & actions
  const tribNeed = (lvl) => (lvl >= 7 ? 2 : lvl >= 5 ? 1 : 0);
  E.tribNeed = tribNeed;
  function tacticFx(c) { return c.def.effects.find((e) => e.timing === 'on_resolve') || c.def.effects[0]; }
  function tacticTargets(g, pid, c) {
    const d = c.def;
    if (d.subtype === 'equip') {
      const f = d.effects[0].equip_filter;
      return unitsOf(g, pid).filter((u) => matches(u, f));
    }
    const fx = tacticFx(c);
    if (fx && fx.target) return targetCands(g, pid, c, fx);
    return null;
  }
  function canActivateTactic(g, pid, c) {
    const d = c.def;
    const t = tacticTargets(g, pid, c);
    if (t && !t.length) return false;
    if (d.subtype === 'equip' || d.subtype === 'continuous') { if (!freeSlots(g, pid, 'support')) return false; }
    if (d.subtype === 'normal' || d.subtype === 'quick') {
      const fx = tacticFx(c);
      if ((fx.ops || []).some((o) => o.op === 'merge_summon') && !mergeOptions(g, pid, fx.ops[0]).length) return false;
      if ((fx.ops || []).some((o) => o.op === 'special_summon') && !freeSlots(g, pid, 'units')) return false;
    }
    return true;
  }
  E.canActivateTactic = canActivateTactic;
  function summonRuleOK(g, pid, c) {
    const i = c.def.effects.findIndex((e) => e.timing === 'summon_rule');
    if (i < 0 || !limitOK(g, c, i) || !freeSlots(g, pid, 'units')) return false;
    const fx = c.def.effects[i];
    if (fx.condition === 'controller_controls') return unitsOf(g, pid).some((u) => matches(u, fx.filter));
    return condOK(g, { ctl: pid, pos: null }, fx.condition);
  }
  function mainActions(g, pid) {
    const pl = P(g, pid), acts = [];
    const nUnits = unitsOf(g, pid).length;
    for (const c of pl.hand) {
      const d = c.def;
      if (d.type === 'unit') {
        const need = tribNeed(d.level);
        if (!pl.normalSummoned && nUnits >= need && (nUnits - need < 5)) acts.push({ type: 'summon', card: c, tributes: need });
        if (summonRuleOK(g, pid, c)) acts.push({ type: 'special_rule', card: c });
      } else if (d.type === 'tactic') { if (canActivateTactic(g, pid, c)) acts.push({ type: 'activate', card: c }); }
      else if (d.type === 'snare') { if (freeSlots(g, pid, 'support')) acts.push({ type: 'set', card: c }); }
    }
    for (const u of unitsOf(g, pid)) {
      if (u.negated) continue;
      u.def.effects.forEach((fx, i) => {
        if (fx.timing === 'ignition' && limitOK(g, u, i) && canPay(g, pid, fx.cost)) acts.push({ type: 'ignite', card: u, fx: i });
      });
      if (!u.posChanged && !u.attacked && u.summonTurn !== g.turn) acts.push({ type: 'position', card: u });
    }
    return acts;
  }
  E.mainActions = mainActions;

  async function doAction(g, pid, a) {
    const pl = P(g, pid), c = a.card, d = c.def;
    switch (a.type) {
      case 'summon': {
        let trib = [];
        if (a.tributes) trib = await pick(g, pid, 'tribute', unitsOf(g, pid), { min: a.tributes, max: a.tributes, title: 'Жертва (' + a.tributes + ')', src: c });
        const posReq = await ask(g, pid, { kind: 'menu', purpose: 'position', card: c, title: 'Позиция на ' + d.name, options: [{ id: 'atk', label: 'Атака' }, { id: 'def', label: 'Защита' }] });
        for (const t of trib) { log(g, `${t.def.name} е жертва`); await toGY(g, t, 'cost'); }
        pl.normalSummoned = true;
        place(g, c, 'unit', { ctl: pid, pos: posReq === 'def' ? 'def' : 'atk' });
        log(g, `${pl.name} призовава ${d.name}${a.tributes ? ' (tribute)' : ''} в ${c.pos === 'atk' ? 'атака' : 'защита'}`);
        const ev = { name: 'summon', card: c, negated: false, actor: pid };
        await eventWindow(g, opp(pid), ev);
        if (ev.negated) { if (c.zone === 'unit') await destroy(g, c, { by: 'effect', noReplace: true }); break; }
        if (c.zone === 'unit') await fireSelf(g, c, a.tributes ? 'tribute_summoned' : 'normal_summoned', {});
        break;
      }
      case 'special_rule': {
        const i = d.effects.findIndex((e) => e.timing === 'summon_rule');
        useLimit(g, Object.assign(c, { ctl: pid }), i);
        place(g, c, 'unit', { ctl: pid, pos: 'atk' });
        log(g, `${pl.name} призовава ${d.name} (special)`);
        break;
      }
      case 'set': place(g, c, 'support', { ctl: pid, fd: true }); log(g, `${pl.name} слага карта закрито`); break;
      case 'position': c.pos = c.pos === 'atk' ? 'def' : 'atk'; c.posChanged = true; log(g, `${d.name} → ${c.pos === 'atk' ? 'атака' : 'защита'}`); break;
      case 'ignite': await runEffect(g, c, a.fx, {}); break;
      case 'activate': {
        let chosen = [];
        const t = tacticTargets(g, pid, c);
        if (t) chosen = await pick(g, pid, d.subtype === 'equip' ? 'equip_host' : 'target:' + firstOp(tacticFx(c)), t,
          { min: (tacticFx(c).target && tacticFx(c).target.count) || 1, max: (tacticFx(c).target && tacticFx(c).target.count) || 1, title: d.name, src: c });
        removeFrom(g, c); c.zone = 'limbo';
        const link = { card: c, ctl: pid, chosen, ev: null, negated: false, below: null };
        link.ev = { name: 'tactic', link };
        await runChain(g, link, 0);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ battle
  function battleOptions(g, pid) {
    if (g.turn <= 1) return [];
    const out = [];
    const forced = forcedTargets(g, pid);
    const targets = unitsOf(g, opp(pid));
    for (const u of unitsOf(g, pid)) {
      if (u.attacked) continue;
      if (u.pos !== 'atk' && !kw(g, u, 'defense_attacker')) continue;
      let t = targets.length ? (forced.length ? forced : targets) : ['direct'];
      out.push({ card: u, targets: t });
    }
    return out;
  }
  E.battleOptions = battleOptions;
  async function doAttack(g, pid, att, tgt) {
    att.attacked = true;
    const target = tgt === 'direct' ? null : tgt;
    log(g, `${att.def.name} атакува ${target ? target.def.name : 'директно'}`);
    const ev = { name: 'attack', attacker: att, target, actor: pid };
    g.battle = { ev, negated: false };
    await eventWindow(g, opp(pid), ev);
    const b = g.battle; g.battle = null;
    if (g.over || b.negated || att.zone !== 'unit') return;
    if (target && target.zone !== 'unit') return;
    const aV = att.pos === 'def' ? stat(g, att, 'def') : stat(g, att, 'atk');
    if (!target) { damage(g, opp(pid), aV, 'директна атака'); return; }
    if (target.pos === 'atk') {
      const tA = stat(g, target, 'atk');
      if (aV > tA) { damage(g, target.ctl, aV - tA, 'битка'); await battleDestroy(g, target, att, tA); }
      else if (aV < tA) { damage(g, att.ctl, tA - aV, 'битка'); await battleDestroy(g, att, target, aV); }
      else { const t0 = target; await battleDestroy(g, att, t0, aV); await battleDestroy(g, t0, att, tA); }
    } else {
      const tD = stat(g, target, 'def');
      if (aV > tD) { if (kw(g, att, 'piercing')) damage(g, target.ctl, aV - tD, 'piercing'); await battleDestroy(g, target, att, tD); }
      else if (aV < tD) damage(g, att.ctl, tD - aV, 'битка');
    }
  }
  async function battleDestroy(g, victim, killer, victimAtk) {
    if (victim.zone !== 'unit') return;
    const va = stat(g, victim, 'atk');
    const ok = await destroy(g, victim, { by: 'battle', src: killer });
    if (!ok) return;
    if (killer.zone === 'unit') await fireSelf(g, killer, 'destroyed_unit_by_battle', { destroyedAtk: va });
    await eventWindow(g, victim.owner, { name: 'ally_destroyed', destroyed: victim, destroyer: killer });
  }

  // ------------------------------------------------------------------ turn loop
  async function takeTurn(g) {
    g.turn++;
    if (g.turn > g.maxTurns) throw new GameOver(-1, 'Лимит на ходовете');
    const pid = g.active, pl = P(g, pid);
    pl.normalSummoned = false;
    for (const q of g.players) for (const u of q.units) if (u) { if (q.id === pid) { u.attacked = false; u.posChanged = false; } if (u.negTurn >= 0 && u.negTurn < g.turn && u.negated) u.negated = false; }
    log(g, `── Ход ${g.turn}: ${pl.name} ──`);
    g.phase = 'draw';
    if (g.turn > 1) draw(g, pid, 1, 'ход');
    for (const phase of ['main', 'battle', 'main2']) {
      g.phase = phase;
      if (phase === 'battle') {
        for (let n = 0; n < 12 && !g.over; n++) {
          const opts = battleOptions(g, pid);
          if (!opts.length) break;
          const ch = await ask(g, pid, { kind: 'battle', options: opts, title: 'Битка' });
          if (!ch) break;
          await doAttack(g, pid, ch.attacker, ch.target);
        }
        continue;
      }
      for (let n = 0; n < 40; n++) {
        const acts = mainActions(g, pid);
        const ch = await ask(g, pid, { kind: 'main', actions: acts, phase, title: phase === 'main' ? 'Основна фаза' : 'Основна фаза 2' });
        if (!ch || ch === 'next') break;
        if (ch === 'end') { phase === 'main' && (g.skipToEnd = true); break; }
        await doAction(g, pid, ch);
      }
      if (g.skipToEnd) { g.skipToEnd = false; break; }
    }
    g.phase = 'end';
    while (pl.hand.length > HAND_MAX) {
      const sel = await pick(g, pid, 'discard', pl.hand.slice(), { title: 'Изхвърли до ' + HAND_MAX + ' карти' });
      log(g, `${pl.name} изхвърля ${sel[0].def.name}`); await toGY(g, sel[0], 'discard');
    }
    g.active = opp(pid);
  }
  E.run = async function (g) {
    try {
      for (let pid = 0; pid < 2; pid++) draw(g, pid, 5, 'начална ръка');
      while (!g.over) await takeTurn(g);
    } catch (e) {
      if (!(e instanceof GameOver)) throw e;
      g.over = true; g.winner = e.winner; g.why = e.why;
      log(g, e.winner < 0 ? `РАВЕНСТВО: ${e.why}` : `ПОБЕДА: ${P(g, e.winner).name} (${e.why})`);
    }
    if (g.onUpdate) g.onUpdate(g);
    return g;
  };
  E.tribNeed = tribNeed;
  E.units = unitsOf;
  E.matches = matches;
  E.canPay = canPay;
  E.eligibleSnares = eligibleSnares;

  if (typeof module !== 'undefined' && module.exports) module.exports = E; else root.Engine = E;
})(typeof window !== 'undefined' ? window : globalThis);
