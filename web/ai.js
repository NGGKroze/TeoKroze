'use strict';
/* Heuristic AI controller. Sees only what a player could see (own hand, public board). */
(function (root) {
  const E = typeof module !== 'undefined' && module.exports ? require('./engine.js') : root.Engine;
  const opp = (p) => 1 - p;
  const stat = (g, c, s) => E.stat(g, c, s);
  const best = (g, c) => Math.max(stat(g, c, 'atk'), stat(g, c, 'def'));

  function handValue(g, c) {
    const d = c.def;
    if (c.id === 'ember_imp') return -500;
    if (d.type === 'unit') return (d.atk + d.def) / 40 + (d.level >= 7 ? 15 : 0);
    if (d.type === 'snare') return 100;
    return 95;
  }
  function pickRandom(g, arr) { return arr[Math.floor(g.r() * arr.length)]; }

  function scoreAction(g, pid, a) {
    const pl = g.players[pid], me = E.units(g, pid), en = E.units(g, opp(pid));
    const c = a.card, id = c && c.id;
    const enBest = en.reduce((m, u) => Math.max(m, stat(g, u, 'atk')), 0);
    const meBest = me.reduce((m, u) => Math.max(m, stat(g, u, 'atk')), 0);
    switch (a.type) {
      case 'special_rule': return 95;
      case 'activate': {
        if (id === 'scholars_gambit' || id === 'forged_oath') return pl.deck.length > 6 ? 80 : 0;
        if (id === 'ember_spark') return g.players[opp(pid)].lp <= 1000 ? 120 : me.some((u) => u.def.archetype === 'emberclaw') ? 55 : 20;
        if (id === 'rekindle') return pl.gy.some((x) => x.def.type === 'unit' && x.def.archetype === 'emberclaw' && x.def.level >= 3) ? 70 : 0;
        if (id === 'grave_call') return pl.gy.some((x) => x.def.type === 'unit' && x.def.level <= 4) ? 65 : 0;
        if (id === 'shatter_strike') return en.length ? (enBest >= meBest || en.length > me.length ? 78 : 42) : 0;
        if (id === 'cleansing_gale') { const n = g.players[opp(pid)].support.filter((x) => x && x.fd).length; return n >= 1 ? 58 : 0; }
        if (c.def.subtype === 'field') return pl.field ? 0 : me.length ? 60 : 30;
        if (id === 'rune_plate') return 72;
        if (id === 'forge_of_unity') return 88;
        return 30;
      }
      case 'summon': {
        const d = c.def, need = a.tributes;
        if (!need) return 50 + d.atk / 100 + (id === 'emberclaw_scout' || id === 'rune_smith' ? 30 : 0) + (id === 'ironwatch_recruit' ? 20 : 0);
        const trib = me.slice().sort((x, y) => best(g, x) - best(g, y)).slice(0, need);
        const loss = trib.reduce((s, u) => s + stat(g, u, 'atk'), 0);
        const gain = d.atk - loss + (d.level >= 7 ? 600 : 0);
        return gain >= 300 ? 40 + gain / 100 : -1;
      }
      case 'ignite': return pl.hand.some((x) => x.id === 'ember_imp') ? 66 : pl.hand.length >= 4 && g.players[opp(pid)].lp <= 3000 ? 50 : g.players[opp(pid)].lp <= 600 ? 110 : 8;
      case 'set': return 45;
      case 'position': {
        const me2 = a.card;
        if (me2.pos === 'atk' && me2.def.def > me2.def.atk + 200 && enBest > stat(g, me2, 'atk')) return 25;
        if (me2.pos === 'def' && stat(g, me2, 'atk') >= enBest && me2.def.atk >= me2.def.def) return 20;
        return -1;
      }
    }
    return 0;
  }

  function decide(g, pid, req) {
    switch (req.kind) {
      case 'main': {
        let bestA = null, bs = 3;
        for (const a of req.actions) { const s = scoreAction(g, pid, a) + g.r() * 0.5; if (s > bs) { bs = s; bestA = a; } }
        if (bestA) return bestA;
        return req.phase === 'main' ? 'next' : 'end';
      }
      case 'battle': return decideBattle(g, pid, req);
      case 'respond': return decideRespond(g, pid, req);
      case 'yesno': return true;
      case 'menu': {
        if (req.purpose === 'position') {
          const d = req.card.def;
          if (req.card.id === 'ironclad_colossus') return 'def';
          return d.def >= d.atk + 500 ? 'def' : 'atk';
        }
        return req.options[0].id;
      }
      case 'pick': return decidePick(g, pid, req);
    }
    return null;
  }

  function decideBattle(g, pid, req) {
    const myLP = g.players[pid].lp;
    const enSet = g.players[opp(pid)].support.filter((x) => x && x.fd).length;
    let bestV = 0, choice = null;
    for (const o of req.options) {
      const att = o.card;
      const aV = att.pos === 'def' ? stat(g, att, 'def') : stat(g, att, 'atk');
      for (const t of o.targets) {
        let v = -1;
        if (t === 'direct') v = 100 + aV / 50;
        else if (t.pos === 'atk') {
          const tA = stat(g, t, 'atk');
          if (aV > tA) v = 30 + (aV - tA) / 40 + tA / 60;
          else if (aV === tA && att.def.level <= t.def.level && att.def.type === 'unit' && (att.def.archetype === 'emberclaw' || tA >= 1800)) v = 12;
        } else {
          const tD = stat(g, t, 'def');
          if (aV > tD) v = 25 + tD / 50 + (E.kw(g, att, 'piercing') ? (aV - tD) / 40 : 0);
        }
        if (v > bestV) { bestV = v; choice = { attacker: att, target: t }; }
      }
    }
    return choice;
  }

  function decideRespond(g, pid, req) {
    const ev = req.ev;
    for (const s of req.options) {
      const id = s.id;
      if (ev.name === 'attack') {
        const att = ev.attacker, t = ev.target;
        const aV = att.pos === 'def' ? stat(g, att, 'def') : stat(g, att, 'atk');
        const hurts = !t || (t.pos === 'atk' ? aV >= stat(g, t, 'atk') : aV > stat(g, t, 'def'));
        if (id === 'backdraft') return s;
        if (id === 'giants_fall') return s;
        if ((id === 'ash_veil' || id === 'hollow_ward' || id === 'bulwark_call') && hurts) return s;
      }
      if (ev.name === 'summon' && id === 'counterweight') {
        const u = ev.card;
        if (stat(g, u, 'atk') >= 1700 || u.def.level >= 5 || u.def.subtype === 'merge') return s;
      }
      if (ev.name === 'ally_destroyed' && id === 'iron_reprisal') return s;
    }
    return null;
  }

  function decidePick(g, pid, req) {
    const cards = req.cards, n = req.min;
    const take = (arr) => arr.slice(0, Math.max(req.min, Math.min(req.max, req.max)));
    const sortBy = (f, desc) => cards.slice().sort((a, b) => (desc ? f(b) - f(a) : f(a) - f(b)));
    const p = req.purpose || '';
    const pl = g.players[pid];
    if (p === 'tribute') return sortBy((c) => best(g, c) + (c.id === 'ember_imp' ? -9999 : 0)).slice(0, req.max);
    if (p === 'discard') return sortBy((c) => handValue(g, c)).slice(0, req.max);
    if (p === 'search') {
      const cnt = (c) => pl.hand.filter((x) => x.id === c.id).length;
      const val = (c) => {
        const d = c.def;
        if (c.id === 'rune_plate') return 100 - cnt(c) * 50;
        if (d.type === 'unit') return (d.atk + d.def) / 10 - cnt(c) * 40;
        if (d.type === 'snare') return 110 - cnt(c) * 40;
        return 90 - cnt(c) * 60;
      };
      return sortBy(val, true).slice(0, req.max);
    }
    if (p === 'equip_host') return sortBy((c) => stat(g, c, 'atk') + stat(g, c, 'def'), true).slice(0, req.max);
    if (p === 'revive' || p.startsWith('target:special_summon')) return sortBy((c) => c.def.atk + c.def.def, true).slice(0, req.max);
    if (p.startsWith('target:destroy')) {
      const mine = cards.filter((c) => c.ctl === pid);
      const theirs = cards.filter((c) => c.ctl !== pid);
      const pool = theirs.length ? theirs : mine;
      return pool.slice().sort((a, b) => (b.zone === 'unit' ? best(g, b) : 3000 + (b.fd ? 500 : 0)) - (a.zone === 'unit' ? best(g, a) : 3000 + (a.fd ? 500 : 0))).slice(0, req.max);
    }
    if (p === 'merge') return sortBy((c) => c.def.atk, true).slice(0, req.max);
    if (p === 'merge_material') return sortBy((c) => (c.zone === 'hand' ? 0 : 1000) + best(g, c)).slice(0, req.max);
    return cards.slice(0, req.max);
  }

  const AI = { decide };
  if (typeof module !== 'undefined' && module.exports) module.exports = AI; else root.AI = AI;
})(typeof window !== 'undefined' ? window : globalThis);
