'use strict';
(function () {
  const E = Engine;
  E.setCards(CARD_DATA);
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const params = new URLSearchParams(location.search);
  const AUTO = params.get('auto') === '1';          // let AI play both sides (testing)
  const SPEED = +(params.get('speed') || 450);
  let G = null, ME = 0, PEND = null, SEL = null, SURR = false, GID = 0;

  const ICON = { beast: '🐺', warrior: '⚔️', mage: '🔮', spirit: '👻', construct: '🗿', dragon: '🐉' };
  const TICON = { normal: '📜', quick: '⚡', continuous: '♾️', equip: '🛡️', field: '🏞️', counter: '🌀' };
  const TYPE_LABEL = { unit: 'Unit', tactic: 'Tactic', snare: 'Snare' };

  // ---------------------------------------------------------------- card rendering
  function cardHTML(c, o) {
    o = o || {};
    const d = c.def;
    if (o.back || (c.fd && c.zone === 'support' && c.ctl !== ME)) return '<div class="card back" data-uid="' + c.uid + '">◈</div>';
    const cls = ['card', d.type === 'unit' ? (d.subtype === 'merge' ? 'merge' : 'unit') : d.type, d.archetype];
    if (c.zone === 'unit' && c.pos === 'def') cls.push('def');
    if (o.cls) cls.push(o.cls);
    let inner = '<div class="hd">' + d.name + '</div>';
    if (d.type === 'unit') {
      let a = d.atk, df = d.def, ca = '', cd = '';
      if (c.zone === 'unit') {
        a = E.stat(G, c, 'atk'); df = E.stat(G, c, 'def');
        ca = a > d.atk ? 'up' : a < d.atk ? 'down' : ''; cd = df > d.def ? 'up' : df < d.def ? 'down' : '';
      }
      inner += '<div class="lv">' + '★'.repeat(d.level) + '</div><div class="art">' + (ICON[d.race] || '❖') + '</div>' +
        '<div class="st"><span class="' + ca + '">ATK ' + a + '</span><span class="' + cd + '">DEF ' + df + '</span></div>';
    } else {
      inner += '<div class="lv"></div><div class="art">' + (d.type === 'snare' ? (d.subtype === 'counter' ? '🌀' : '🪤') : (TICON[d.subtype] || '📜')) + '</div><div class="tp">' + TYPE_LABEL[d.type] + ' · ' + d.subtype + '</div>';
    }
    let extra = '';
    if (c.zone === 'unit' && c.pos === 'def') extra += '<span class="badge2">ЗАЩИТА</span>';
    if (c.negated) extra += '<span class="badge3">отречена</span>';
    if (c.zone === 'support' && c.fd) extra += '<span class="badge3">закрито</span>';
    return '<div class="' + cls.join(' ') + '" data-uid="' + c.uid + '">' + inner + extra + '</div>';
  }
  function effectText(d) { return d.text || '(без ефект)'; }
  function showDetail(c) {
    if (!c || (c.fd && c.ctl !== ME && c.zone === 'support')) { $('#detail').innerHTML = '<div class="meta">Закрита карта.</div>'; return; }
    const d = c.def;
    let meta = TYPE_LABEL[d.type] + ' · ' + d.subtype + ' · ' + d.rarity;
    if (d.type === 'unit') meta += ' · Lv' + d.level + ' · ' + d.attribute + ' · ' + d.race + (d.deck === 'extra' ? ' · Extra Deck' : '');
    let stats = '';
    if (d.type === 'unit') stats = 'ATK ' + (c.zone === 'unit' ? E.stat(G, c, 'atk') : d.atk) + ' / DEF ' + (c.zone === 'unit' ? E.stat(G, c, 'def') : d.def) + '\n';
    let mats = '';
    if (d.materials) mats = 'Материали: ' + d.materials.map((m) => Object.values(m).join(' ')).join(' + ') + '\n';
    const trib = d.type === 'unit' && d.subtype !== 'merge' ? (E.tribNeed(d.level) ? 'Tribute: ' + E.tribNeed(d.level) + '\n' : '') : '';
    $('#detail').innerHTML = '<h3>' + d.name + '</h3><div class="meta">' + meta + ' · ' + d.archetype + '</div><div class="txt">' + stats + trib + mats + effectText(d) + '</div><div class="art">Арт: ' + (d.art_brief || '—') + '</div>';
  }
  function bindHover(root) {
    root.querySelectorAll('.card[data-uid]').forEach((el) => {
      el.onmouseenter = () => showDetail(byUid(+el.dataset.uid));
    });
  }
  function allCards() {
    const out = [];
    G.players.forEach((p) => { ['deck', 'hand', 'gy', 'banish', 'extra'].forEach((z) => out.push(...p[z])); p.units.forEach((c) => c && out.push(c)); p.support.forEach((c) => c && out.push(c)); if (p.field) out.push(p.field); });
    return out;
  }
  const byUid = (u) => allCards().find((c) => c.uid === u) || (PEND && PEND.req.cards && PEND.req.cards.find((c) => c.uid === u));

  // ---------------------------------------------------------------- render
  function actionsFor() {
    const m = {};
    if (PEND && PEND.req.kind === 'main') PEND.req.actions.forEach((a) => { (m[a.card.uid] = m[a.card.uid] || []).push(a); });
    return m;
  }
  function sideHTML(pid) {
    const p = G.players[pid];
    const isMe = pid === ME;
    const acts = actionsFor();
    const bt = PEND && PEND.req.kind === 'battle' ? PEND.req.options : null;
    const attackable = {};
    if (bt) bt.forEach((o) => (attackable[o.card.uid] = o));
    const tgts = SEL && bt ? (SEL.targets || []) : [];
    const cell = (c, kind) => {
      if (!c) return '<div class="slot"></div>';
      let cls = '';
      if (isMe && acts[c.uid]) cls += ' can';
      if (isMe && attackable[c.uid]) cls += ' can';
      if (SEL && SEL.card === c) cls += ' sel';
      if (!isMe && tgts.includes(c)) cls += ' tgt';
      return cardHTML(c, { cls: cls.trim() });
    };
    let h = '<div class="bar"><div class="lp">' + (isMe ? 'Ти' : 'Противник') + ' · ' + Math.max(0, p.lp) + ' <small>LP</small></div>' +
      '<div class="lpbar"><i style="width:' + Math.max(0, Math.min(100, p.lp / 80)) + '%"></i></div>' +
      '<span class="badge">тесте ' + p.deck.length + '</span><span class="badge">ръка ' + p.hand.length + '</span><span class="badge">гробище ' + p.gy.length + '</span><span class="badge">изгонени ' + p.banish.length + '</span>' +
      (G.active === pid ? '<span class="badge" style="color:var(--acc);border-color:var(--acc)">на ход</span>' : '') + '</div>';
    const unitsRow = p.units.map((c) => '<div class="slot">' + (c ? cell(c) : '') + '</div>').join('');
    const supRow = p.support.map((c) => '<div class="slot">' + (c ? cell(c) : '') + '</div>').join('');
    const pile = (label, n, z) => '<div class="slot pile" data-pile="' + z + '" data-pid="' + pid + '" style="cursor:pointer">' + label + '<b>' + n + '</b></div>';
    const fld = '<div class="slot">' + (p.field ? cell(p.field) : 'Field') + '</div>';
    const unitsGrid = '<div class="rows">' + unitsRow + '<div class="spacer"></div>' + fld + pile('Гробище', p.gy.length, 'gy') + '</div>';
    const supGrid = '<div class="rows">' + supRow + '<div class="spacer"></div>' + pile('Extra', p.extra.length, 'extra') + pile('Изгонени', p.banish.length, 'banish') + '</div>';
    return h + (isMe ? unitsGrid + supGrid : supGrid + unitsGrid);
  }
  function render() {
    if (!G) return;
    $('#opp').innerHTML = sideHTML(1 - ME);
    $('#me').innerHTML = sideHTML(ME);
    // hand
    const acts = actionsFor();
    $('#hand').innerHTML = G.players[ME].hand.map((c) => cardHTML(c, { cls: acts[c.uid] ? 'can' : '' })).join('') || '<span style="color:var(--mut)">Празна ръка</span>';
    $('#turninfo').textContent = 'Ход ' + G.turn + ' · ' + (G.active === ME ? 'твой' : 'на противника') + ' · фаза: ' + G.phase;
    // log
    const lg = $('#log');
    lg.innerHTML = G.logs.slice(-70).map((l) => '<div class="' + (l.startsWith('──') ? 't' : '') + '">' + l + '</div>').join('');
    lg.scrollTop = lg.scrollHeight;
    // buttons + hint
    const b = $('#btns'); b.innerHTML = ''; let hint = '';
    if (G.over) hint = G.winner < 0 ? 'Равенство' : G.winner === ME ? 'ПОБЕДА! 🎉' : 'Загуба';
    else if (PEND && PEND.pid === ME) {
      const k = PEND.req.kind;
      if (k === 'main') {
        hint = 'Избери светеща карта';
        b.innerHTML = (PEND.req.phase === 'main' && G.turn > 1 ? '<button id="bBattle" class="pri">Към битка ▶</button> ' : '') + '<button id="bEnd">Край на хода</button>';
        const bb = $('#bBattle'); if (bb) bb.onclick = () => resolve('next');
        $('#bEnd').onclick = () => resolve('end');
      } else if (k === 'battle') {
        hint = SEL ? 'Избери цел за ' + SEL.card.def.name : 'Избери атакуващ';
        if (SEL && SEL.targets.includes('direct')) b.innerHTML += '<button id="bDirect" class="pri">Директна атака</button> ';
        b.innerHTML += (SEL ? '<button id="bCancel">Отказ</button> ' : '') + '<button id="bEndB">Край на битката</button>';
        const d = $('#bDirect'); if (d) d.onclick = () => { const s = SEL; SEL = null; resolve({ attacker: s.card, target: 'direct' }); };
        const c = $('#bCancel'); if (c) c.onclick = () => { SEL = null; render(); };
        $('#bEndB').onclick = () => { SEL = null; resolve(null); };
      }
    } else if (PEND) hint = 'Противникът мисли…';
    $('#hint').textContent = hint;
    bindHover($('#board'));
    bindClicks();
  }
  function bindClicks() {
    const acts = actionsFor();
    document.querySelectorAll('#board .card[data-uid]').forEach((el) => {
      const uid = +el.dataset.uid;
      el.onclick = () => {
        if (!PEND || PEND.pid !== ME) return;
        const k = PEND.req.kind, c = byUid(uid);
        if (k === 'main' && acts[uid] && c.ctl === ME) chooseAction(c, acts[uid]);
        else if (k === 'battle') {
          if (SEL && SEL.targets.includes(c)) { const s = SEL; SEL = null; resolve({ attacker: s.card, target: c }); return; }
          const o = PEND.req.options.find((x) => x.card === c);
          if (o) { SEL = { card: c, targets: o.targets }; render(); }
        }
      };
    });
    document.querySelectorAll('.slot.pile').forEach((el) => {
      el.onclick = () => {
        const p = G.players[+el.dataset.pid], z = el.dataset.pile;
        const cards = p[z]; if (!cards.length) return;
        modal('<h3>' + (+el.dataset.pid === ME ? 'Твоят' : 'Вражеският') + ' ' + z + '</h3><div class="mcards">' + cards.map((c) => cardHTML(c)).join('') + '</div><div class="mbtns"><button id="mClose">Затвори</button></div>', () => { $('#mClose').onclick = closeModal; });
      };
    });
  }
  function resolve(v) { const p = PEND; if (!p || !p.res || p.pid !== ME) return;
    const k = p.req.kind, okType = { main: (x) => x === 'next' || x === 'end' || (x && x.type), battle: (x) => x === null || (x && x.attacker), pick: Array.isArray, respond: (x) => x === null || (x && x.def), yesno: (x) => typeof x === 'boolean', menu: (x) => typeof x === 'string' }[k];
    if (okType && !okType(v)) { console.error('stale resolve for ' + k + ': ' + JSON.stringify(v && v.uid ? v.uid : v)); return; } PEND = null; SEL = null; closeModal(); p.res(v); }
  function actLabel(a) {
    switch (a.type) {
      case 'summon': return a.tributes ? 'Tribute Summon (жертви: ' + a.tributes + ')' : 'Нормално призоваване';
      case 'special_rule': return 'Специално призоваване';
      case 'activate': return 'Активирай';
      case 'set': return 'Сложи закрито';
      case 'position': return a.card.pos === 'atk' ? 'Смени в защита' : 'Смени в атака';
      case 'ignite': return 'Активирай ефект';
    }
    return a.type;
  }
  function chooseAction(c, list) {
    if (list.length === 1 && list[0].type !== 'position') { resolve(list[0]); return; }
    modal('<h3>' + c.def.name + '</h3><div class="mbtns">' + list.map((a, i) => '<button data-i="' + i + '" class="pri">' + actLabel(a) + '</button>').join('') + '<button id="mX">Отказ</button></div>', () => {
      document.querySelectorAll('#mbox [data-i]').forEach((b) => (b.onclick = () => resolve(list[+b.dataset.i])));
      $('#mX').onclick = closeModal;
    });
  }

  // ---------------------------------------------------------------- modal helpers
  function modal(html, bind) { $('#mbox').innerHTML = html; $('#modal').style.display = 'flex'; bindHover($('#mbox')); if (bind) bind(); }
  function closeModal() { $('#modal').style.display = 'none'; }
  function zoneTag(c) { return { hand: 'ръка', gy: 'гробище', deck: 'тесте', unit: c.ctl === ME ? 'твоя' : 'вражеска', support: c.ctl === ME ? 'твоя' : 'вражеска', field: 'Field', extra: 'extra', banish: 'изгонена' }[c.zone] || ''; }

  function humanDecide(g, pid, req) {
    return new Promise((res) => {
      PEND = { req, res, pid };
      render();
      switch (req.kind) {
        case 'pick': {
          const sel = new Set();
          const draw = () => {
            if (!PEND || PEND.req !== req) return;
            const ok = sel.size >= req.min && sel.size <= req.max;
            modal('<h3>' + (req.title || 'Избери') + ' <span class="badge">' + req.min + (req.max !== req.min ? '–' + req.max : '') + ' карти</span></h3><div class="mcards">' +
              req.cards.map((c) => '<div class="mcol">' + cardHTML(c, { cls: sel.has(c.uid) ? 'sel' : '' }) + '<div class="zonetag">' + zoneTag(c) + '</div></div>').join('') +
              '</div><div class="mbtns"><button id="mOk" class="pri" ' + (ok ? '' : 'disabled') + '>Потвърди</button></div>', () => {
              document.querySelectorAll('#mbox .card[data-uid]').forEach((el) => (el.onclick = () => {
                const u = +el.dataset.uid;
                if (sel.has(u)) sel.delete(u); else { if (req.max === 1) sel.clear(); if (sel.size < req.max) sel.add(u); }
                if (req.max === 1 && req.min === 1 && sel.size === 1) { resolve(req.cards.filter((c) => sel.has(c.uid))); return; }
                draw();
              }));
              $('#mOk').onclick = () => resolve(req.cards.filter((c) => sel.has(c.uid)));
            });
          };
          draw(); break;
        }
        case 'respond':
          modal('<h3>' + req.title + '</h3><div style="color:var(--mut);margin-bottom:8px">' + describeEv(req.ev) + '</div><div class="mcards">' +
            req.options.map((c) => cardHTML(c, { cls: 'can' })).join('') + '</div><div class="mbtns"><button id="mNo">Не активирай</button></div>', () => {
            document.querySelectorAll('#mbox .card[data-uid]').forEach((el) => (el.onclick = () => resolve(req.options.find((c) => c.uid === +el.dataset.uid))));
            $('#mNo').onclick = () => resolve(null);
          }); break;
        case 'yesno':
          modal('<h3>' + req.title + '</h3><div class="mbtns"><button id="mY" class="pri">Да</button><button id="mN">Не</button></div>', () => { $('#mY').onclick = () => resolve(true); $('#mN').onclick = () => resolve(false); }); break;
        case 'menu':
          modal('<h3>' + req.title + '</h3><div class="mbtns">' + req.options.map((o) => '<button class="pri" data-id="' + o.id + '">' + o.label + '</button>').join('') + '</div>', () => {
            document.querySelectorAll('#mbox [data-id]').forEach((b) => (b.onclick = () => resolve(b.dataset.id)));
          }); break;
      }
    });
  }
  function describeEv(ev) {
    if (!ev) return '';
    if (ev.name === 'attack') return ev.attacker.def.name + ' атакува ' + (ev.target ? ev.target.def.name : 'директно') + '.';
    if (ev.name === 'summon') return ev.card.def.name + ' се призовава.';
    if (ev.name === 'tactic') return 'Противникът активира ' + ev.link.card.def.name + '.';
    if (ev.name === 'ally_destroyed') return ev.destroyed.def.name + ' е унищожена в битка.';
    return '';
  }

  // ---------------------------------------------------------------- controllers
  const aiCtl = (delay, gid) => ({
    async decide(g, pid, req) {
      if (gid !== GID) throw new E.GameOver(-1, 'Прекратена');
      PEND = { req, res: null, pid };
      render();
      if (delay && (req.kind === 'main' || req.kind === 'battle')) await sleep(delay);
      const r = AI.decide(g, pid, req);
      PEND = null;
      return r;
    },
  });
  const humanCtl = (gid) => ({ decide: (g, pid, req) => (gid !== GID ? surrender(g, -1) : SURR ? surrender(g, pid) : humanDecide(g, pid, req)) });
  function surrender(g, pid) { throw new E.GameOver(pid < 0 ? -1 : 1 - pid, pid < 0 ? 'Прекратена' : 'Предаване'); }

  // ---------------------------------------------------------------- start / menu
  function mkDeck(k) { return { main: Object.entries(DECK_DATA[k].main).flatMap(([id, n]) => Array(n).fill(id)), extra: DECK_DATA[k].extra }; }
  function buildMenu() {
    $('#decks').innerHTML = Object.keys(DECK_DATA).map((k) => {
      const d = DECK_DATA[k];
      const names = Object.entries(d.main).map(([id, n]) => n + '× ' + CARD_DATA.find((c) => c.id === id).name);
      names.push('Extra: ' + d.extra.map((id) => CARD_DATA.find((c) => c.id === id).name).join(', '));
      return '<div class="deckcard" data-k="' + k + '"><h2>' + d.name + '</h2><div>' + d.blurb + '</div><ul>' + names.map((n) => '<li>' + n + '</li>').join('') + '</ul></div>';
    }).join('');
    document.querySelectorAll('.deckcard').forEach((el) => (el.onclick = () => start(el.dataset.k)));
  }
  async function start(k) {
    const keys = Object.keys(DECK_DATA), other = keys.find((x) => x !== k);
    $('#menu').style.display = 'none'; $('#game').style.display = 'grid'; SURR = false; const gid = ++GID;
    const first = Math.random() < 0.5 ? 0 : 1;
    const seed = Math.floor(Math.random() * 1e9);
    G = E.newGame({ decks: [mkDeck(k), mkDeck(other)], seed, first, names: ['Ти', 'Противник'],
      controllers: [AUTO ? aiCtl(SPEED, gid) : humanCtl(gid), aiCtl(SPEED, gid)], onUpdate: () => render() });
    E.log(G, 'Ти играеш с ' + DECK_DATA[k].name + ', противникът с ' + DECK_DATA[other].name + '. ' + (first === 0 ? 'Ти започваш.' : 'Противникът започва.'));
    window.G = G; window.__done = false;
    const mine = G;
    await E.run(G);
    if (gid !== GID) return;
    render(); window.__done = true;
    modal('<h3>' + (G.winner < 0 ? 'Равенство' : G.winner === ME ? 'Победа! 🎉' : 'Загуба') + '</h3><div style="color:var(--mut);margin-bottom:12px">' + G.why + ' · ходове: ' + G.turn + '</div><div class="mbtns"><button class="pri" id="mAgain">Играй пак</button><button id="mMenu">Меню</button></div>',
      () => { $('#mAgain').onclick = () => { closeModal(); start(k); }; $('#mMenu').onclick = () => { closeModal(); toMenu(); }; });
  }
  function toMenu() { GID++; $('#game').style.display = 'none'; $('#menu').style.display = 'block'; const p = PEND; PEND = null; closeModal(); p && p.res && p.res(null); }

  const RULES = '<h3>Правила на прототипа</h3><div style="max-width:700px;line-height:1.5">' +
    '<p><b>Цел:</b> доведи LP на противника до 0 (старт 8000) или му свърши тестето при теглене.</p>' +
    '<p><b>Ход:</b> теглене → основна фаза → битка → основна фаза 2 → край (ръка макс. 6). Първият играч не тегли и не атакува на първия ход.</p>' +
    '<p><b>Призоваване:</b> едно нормално на ход. Ниво 1–4 без жертва, 5–6 с 1 tribute, 7–8 с 2 tributes. Units могат да се призоват в атака или защита; позиция се сменя веднъж на ход (не в хода на призоваване, не след атака).</p>' +
    '<p><b>Битка:</b> атака срещу атака: по-слабият се унищожава и собственикът му губи разликата; равни — и двата. Атака срещу защита: ако ATK > DEF целта се унищожава (без щети, освен piercing); ако ATK < DEF губиш разликата. Директна атака само ако противникът няма Units.</p>' +
    '<p><b>Tactics</b> се играят в основната ти фаза. <b>Snares</b> се слагат закрито и могат да се активират от следващия ход в отговор на събитие (атака, призоваване, унищожаване); Counter Snares реагират и на Tactic.</p>' +
    '<p><b>Merge:</b> Merge Units живеят в Extra Deck и се призовават от Tactic „Forge of Unity“ с материали от ръка/поле.</p>' +
    '<p><b>Опростявания в прототипа:</b> тригерите на Units се активират автоматично; няма ръчно прекъсване на верига освен чрез Snares; няма face-down Units; Quick Tactics се играят само в твой ход.</p></div><div class="mbtns" style="margin-top:12px"><button id="mClose">Затвори</button></div>';
  $('#btnRules').onclick = $('#btnRules2').onclick = () => modal(RULES, () => { $('#mClose').onclick = closeModal; });
  $('#btnSurr').onclick = () => { if (G && !G.over && PEND && PEND.pid === ME) { SURR = true; resolve(null); } };
  $('#btnNew').onclick = toMenu;
  $('#modal').onclick = (e) => { if (e.target.id === 'modal' && !(PEND && PEND.req && ['pick', 'respond', 'yesno', 'menu'].includes(PEND.req.kind) && PEND.pid === ME)) closeModal(); };
  buildMenu();
  if (params.get('deck')) start(params.get('deck'));
})();
