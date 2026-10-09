// Usage: node tools/simulate.js [games=400] [seedBase=1]  -> AI vs AI win rates for both decks
const E = require('../web/engine.js'); const AI = require('../web/ai.js');
const { CARD_DATA, DECK_DATA } = require('../web/data.js');
if (process.env.CARD_PATCH) { const P = JSON.parse(process.env.CARD_PATCH); for (const c of CARD_DATA) if (P[c.id]) Object.assign(c, P[c.id]); }
E.setCards(CARD_DATA);
const N = +process.argv[2] || 400, S0 = +process.argv[3] || 1;
if (process.env.DECK_PATCH) { const P = JSON.parse(process.env.DECK_PATCH); for (const k in P) for (const id in P[k]) { if (P[k][id] <= 0) delete DECK_DATA[k].main[id]; else DECK_DATA[k].main[id] = P[k][id]; } }
const names = Object.keys(DECK_DATA);
const mkDeck = (k) => ({ main: Object.entries(DECK_DATA[k].main).flatMap(([id, n]) => Array(n).fill(id)), extra: DECK_DATA[k].extra });
(async () => {
  const res = {}; names.forEach(a => res[a] = { w: 0, l: 0, d: 0, firstW: 0, firstG: 0, turns: 0, fail: 0 });
  const A = names[0], B = names[1];
  for (let i = 0; i < N; i++) {
    const first = i % 2; // alternate who goes first
    const seatA = i % 2 === 0 ? 0 : 1;      // deck A seat
    const decks = seatA === 0 ? [mkDeck(A), mkDeck(B)] : [mkDeck(B), mkDeck(A)];
    const g = E.newGame({ decks, seed: S0 + i, first: Math.floor(i / 2) % 2, controllers: [AI, AI], names: seatA === 0 ? [A, B] : [B, A] });
    try { await E.run(g); } catch (e) { console.error('CRASH seed', S0 + i, e.stack.split('\n').slice(0, 4).join('\n')); res[A].fail++; continue; }
    const deckOf = (pid) => (pid === seatA ? A : B);
    if (g.winner < 0) { res[A].d++; res[B].d++; }
    else { res[deckOf(g.winner)].w++; res[deckOf(1 - g.winner)].l++; if (g.winner === g.players[0].id && false) {} }
    res[A].turns += g.turn;
    // first-player stat
    const fp = Math.floor(i / 2) % 2;
    if (g.winner >= 0) { res[A].firstG++; if (g.winner === fp) res[A].firstW++; }
  }
  const n = N - res[A].fail;
  for (const k of names) console.log(k.padEnd(14), 'W', res[k].w, 'L', res[k].l, 'D', res[k].d, 'winrate', (100 * res[k].w / Math.max(1, res[k].w + res[k].l)).toFixed(1) + '%');
  console.log('avg turns', (res[A].turns / n).toFixed(1), '| first player wins', (100 * res[A].firstW / Math.max(1, res[A].firstG)).toFixed(1) + '%', '| crashes', res[A].fail);
})();
