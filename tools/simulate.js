#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════
   SIMULADOR DE BALANCEAMENTO — Reino do Chicletão

   Roda o script.js REAL do jogo (sem copiar regra nenhuma) dentro de um DOM falso,
   com tempo virtual (60 fps determinísticos) e RNG com seed. Bots de estratégias
   diferentes jogam partidas inteiras e o script mostra em que wave cada um morre.

   Uso:
     node tools/simulate.js                       # 30 partidas × 4 estratégias × 3 dificuldades
     node tools/simulate.js --games 10            # mais rápido (smoke test)
     node tools/simulate.js --diff normal --strategy balanced --trace
     node tools/simulate.js --json > resultado.json
     node tools/simulate.js --set difficulty.hard.hp=1.2 --set hp.quad=1.2   # testa números sem editar o jogo

   Não precisa instalar nada (só Node 18+).
   ════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');


// Geometria do palco 960×540, medida no navegador real (Chrome 1280×800).
const GEOM = { gridLeft: 334, gridTop: 78, gridSize: 384, cell: 76, cellX0: 374, cellY0: 118, rei: { x: 286, y: 271 } };

// ── args ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const GAMES   = parseInt(opt('games', 30), 10);
const DIFFS   = String(opt('diff', 'easy,normal,hard')).split(',');
const SEED0   = parseInt(opt('seed', 1000), 10);
const MAXWAVE = parseInt(opt('maxwave', 40), 10);
// --set caminho=valor (repetível) sobrescreve BALANCE só nesta simulação. Ex.: --set difficulty.hard.hp=1.2
const SETS = argv.reduce((a, x, i) => (x === '--set' && argv[i + 1] ? a.concat(argv[i + 1]) : a), []);
const SCRIPT_PATH = opt('script', path.join(__dirname, '..', 'script.js'));
const SCRIPT = new vm.Script(fs.readFileSync(SCRIPT_PATH, 'utf8'), { filename: 'script.js' });
const JSON_OUT = !!opt('json', false), TRACE = !!opt('trace', false);
const WORKERS = Math.max(1, parseInt(opt('workers', Math.min(os.cpus().length, 4)), 10));

// ── DOM falso ────────────────────────────────────────────────────────
class El {
  constructor(tag, id) {
    this.tagName = tag; this.id = id || ''; this.style = {}; this.dataset = {};
    this.children = []; this.parent = null; this._ih = ''; this.innerText = ''; this.textContent = '';
    this.className = ''; this.disabled = false; this.onclick = null; this.onerror = null; this._l = {}; this._q = {};
    this.offsetLeft = 0; this.offsetTop = 0; this.offsetWidth = 0; this.offsetHeight = 0;
    this.clientWidth = 0; this.clientHeight = 0; this.clientLeft = 0; this.clientTop = 0; this.offsetParent = null;
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  }
  get innerHTML() { return this._ih; }
  set innerHTML(v) { this._ih = v; this.children.forEach(c => c.parent = null); this.children = []; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); this.parent = null; } }
  replaceWith() {} setAttribute() {} removeEventListener() {}
  addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); }
  querySelector(sel) { return this._q[sel] || (this._q[sel] = new El('div')); }
  querySelectorAll(sel) {
    const cls = sel.split(',').map(s => s.trim().replace(/^\./, ''));
    return this.children.filter(c => cls.some(k => (' ' + c.className + ' ').includes(' ' + k + ' ')));
  }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
}

// ── uma partida ──────────────────────────────────────────────────────
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function makeGame(diff, seed) {
  // tempo virtual + timers
  let now = 0; const timers = []; let tid = 1;
  const addTimer = (fn, ms, every) => { const id = tid++; timers.push({ id, fn, at: now + ms, every: every ? ms : 0 }); return id; };
  const els = new Map(); const getEl = id => { if (!els.has(id)) els.set(id, new El('div', id)); return els.get(id); };
  const store = new Map();
  const sandbox = {
    console,
    document: { getElementById: getEl, createElement: t => new El(t), querySelector: () => null, querySelectorAll: () => [],
                addEventListener() {}, body: new El('body'), documentElement: new El('html') },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    performance: { now: () => now },
    setTimeout: (fn, ms) => addTimer(fn, ms || 0, false), setInterval: (fn, ms) => addTimer(fn, ms || 0, true),
    clearTimeout: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    requestAnimationFrame: () => 1,
    matchMedia: () => ({ matches: false }), addEventListener() {}, devicePixelRatio: 1,
    __rand: mulberry32(seed),
  };
  sandbox.clearInterval = sandbox.clearTimeout; sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  const run = code => vm.runInContext(code, ctx);
  SCRIPT.runInContext(ctx);
  run('Math.random = __rand; muted = true;');
  SETS.forEach(kv => { const [k, v] = kv.split('='); run(`BALANCE.${k} = ${Number(v)};`); });
  run(`difficulty = ${JSON.stringify(diff)};`);
  // layout fixo (o DOM falso não tem layout): mesmos números do navegador real
  run(`
    gridBox = function(){ return { left:${GEOM.gridLeft}, top:${GEOM.gridTop}, width:${GEOM.gridSize}, height:${GEOM.gridSize} }; };
    computeCellCenters = function(){
      _cellCenters=[]; for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) _cellCenters.push({x:${GEOM.cellX0}+c*CELL, y:${GEOM.cellY0}+r*CELL});
      _reiCenter={x:${GEOM.rei.x}, y:${GEOM.rei.y}};
    };
    computeCellCenters();`);
  getEl('btn-start')._l.click[0]();                   // "Jogar"

  const api = {
    snap:  run('(function(){ return {hand,units,buildings,goma,gomaMax,rei,wave,state,upgrades,totalKills,score}; })'),
    state: run('(function(){ return state; })'),
    loop:  run('loop'),
    selectCard: run('selectCard'), discardCard: (() => { try { return run('discardCard'); } catch (e) { return null; } })(), onCellClick: run('onCellClick'), startWave: run('startWave'), closeShop: run('closeShop'), won: run('(function(){ return victoryWon; })'),
    SHOP_ITEMS: run('SHOP_ITEMS'), enemiesLeft: run('(function(){ return enemies.length + spawnQueue.length; })'),
    getEl,
  };
  // avança 1 frame (60 fps) com timers virtuais
  api.step = () => {
    now += 1000 / 60;
    for (let i = 0; i < timers.length; i++) {
      const t = timers[i];
      if (t.at <= now) { if (t.every) t.at += t.every; else { timers.splice(i, 1); i--; } try { t.fn(); } catch (e) {} }
    }
    api.loop(now);
  };
  return api;
}

// ── estratégias (bots) ───────────────────────────────────────────────
const STRATS = {
  // iniciante: joga a 1ª carta que consegue pagar, na 1ª célula livre, sem usar cura nem loja e escolhendo o 1º power-up
  naive:    { naive: true, prefer: [], fabs: 0 },
  // joga o que der, o mais barato primeiro
  spam:     { prefer: ['mascador', 'acido', 'duplo', 'atirador', 'tanque', 'sticky', 'healer', 'lenda'], fabs: 0 },
  // mistura equilibrada, 1 fábrica no início
  balanced: { prefer: ['atirador', 'tanque', 'mascador', 'healer', 'lenda', 'sticky', 'duplo', 'acido'], fabs: 1 },
  // economia: 3 fábricas antes de tudo
  eco:      { prefer: ['atirador', 'mascador', 'tanque', 'healer', 'lenda', 'duplo', 'sticky', 'acido'], fabs: 3 },
  // parede de Blocão + cura
  tank:     { prefer: ['tanque', 'healer', 'mascador', 'atirador', 'lenda', 'duplo', 'acido', 'sticky'], fabs: 1 },
  // jogador casual (calibrado com o humano real: no Fácil original morria por volta da wave 15):
  // joga razoavelmente, mas escolhe sempre o 1º power-up e nunca usa a loja
  casual:   { prefer: ['mascador', 'acido', 'duplo', 'atirador', 'tanque', 'sticky', 'healer', 'lenda'], fabs: 0, firstUpgrade: true, skipShop: true },
  // casual que usa a loja e escolhe power-ups com critério (um pouco melhor)
  casual2:  { prefer: ['mascador', 'acido', 'duplo', 'atirador', 'tanque', 'sticky', 'healer', 'lenda'], fabs: 0, firstUpgrade: true },
  // balanced + DESCARTE: depois de jogar, mantém só as `keep` melhores cartas da mão e descarta o resto (+3 goma cada),
  // jogando de novo com a goma extra. Serve para medir o quanto o descarte mexe na dificuldade.
  balanced_d: { prefer: ['atirador', 'tanque', 'mascador', 'healer', 'lenda', 'sticky', 'duplo', 'acido'], fabs: 1, discard: true, keep: 3 },
  // versão agressiva (pior caso): fica só com 1 carta e descarta todo o resto toda wave
  balanced_d1: { prefer: ['atirador', 'tanque', 'mascador', 'healer', 'lenda', 'sticky', 'duplo', 'acido'], fabs: 1, discard: true, keep: 1 },
};
const UPGRADE_PRIORITY = ['Explosão de Goma', 'Goma Afiada', 'Chiclete Turbo', 'Sinergias x2', 'Upgrade Aleatório', 'Rei Blindado',
  'Regen de Chiclete', 'Mais Cartas', 'Fábrica ++', '+6 Goma/wave', 'Goma Inicial', 'Reserva de Goma'];
const SHOP_PRIORITY = ['boost', 'upgrade', 'shield', 'potion', 'cards', 'goma'];

const ROW_ORDER = [2, 1, 3, 0, 4];
function emptyCells(g, backCols) {
  const cells = [];
  const cols = backCols ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
  for (const c of cols) for (const r of ROW_ORDER) { const i = r * 5 + c; if (!g.units[i] && !g.buildings[i]) cells.push(i); }
  return cells;
}

function playPrepNaive(api) {
  for (let guard = 0; guard < 40; guard++) {
    const g = api.snap(); if (g.state !== 'prep') return;
    const i = g.hand.findIndex(c => g.goma >= c.cost && (c.type === 'unit' || c.type === 'building') && emptyCells(g, false).length);
    if (i < 0) return;
    api.selectCard(i); api.onCellClick(emptyCells(g, false)[0]);
  }
}

// bots com descarte: depois de jogar o que dá, descarta as piores cartas (fora da lista `prefer` primeiro) e joga de novo
function playPrep(api, S) {
  playPrepCore(api, S);
  if (!S.discard || api.state() !== 'prep') return;
  for (let guard = 0; guard < 20; guard++) {
    const g = api.snap(); if (g.hand.length <= S.keep) break;
    const val = c => { const p = S.prefer.indexOf(c.id); return p < 0 ? 99 : p; };
    let worst = 0; g.hand.forEach((c, i) => { if (val(c) > val(g.hand[worst])) worst = i; });
    api.discardCard(worst);
  }
  playPrepCore(api, S);
}

function playPrepCore(api, S) {
  if (S.naive) return playPrepNaive(api);
  for (let guard = 0; guard < 40; guard++) {
    const g = api.snap(); if (g.state !== 'prep') return;
    const fabCount = g.buildings.filter(b => b && b.id === 'fab').length;
    let best = null;
    g.hand.forEach((c, i) => {
      if (g.goma < c.cost) return;
      let score = -1, cell = -1;
      if (c.type === 'heal')  { if (g.rei.hp <= g.rei.maxHp - 25) score = 100; }
      else if (c.type === 'goma') { if (g.goma + 5 <= g.gomaMax) score = 60; }
      else if (c.type === 'building') {
        const free = emptyCells(g, true);
        if (fabCount < S.fabs && free.length) { score = 90; cell = free[0]; }
        else {
          const up = g.buildings.findIndex(b => b && b.id === c.id && (b.lvl || 1) < 3);
          if (up >= 0 && S.fabs > 0) { score = 35; cell = up; }
        }
      } else if (c.type === 'unit') {
        const pref = S.prefer.indexOf(c.id), base = 70 - Math.max(0, pref) * 3;
        const free = emptyCells(g, c.id === 'tanque');
        if (free.length) { score = base; cell = free[0]; }
        else {
          const up = g.units.findIndex(u => u && u.id === c.id && (u.lvl || 1) < 3);
          if (up >= 0) { score = base - 20; cell = up; }
        }
        // prioriza a 1ª tropa de ataque antes da 2ª fábrica etc.
        if (!g.units.some(u => u) && c.id !== 'healer') score += 15;
      }
      if (score > (best ? best.score : -1)) best = { i, score, cell, type: c.type };
    });
    if (!best) return;
    api.selectCard(best.i);
    if (best.type === 'unit' || best.type === 'building') api.onCellClick(best.cell);
    if (api.snap().state !== 'prep') return;
  }
}

function playUpgrade(api, S) {
  const wrap = api.getEl('ov-up-cards');
  if (S.naive || S.firstUpgrade) return wrap.children[0].onclick();
  const opts = wrap.children.map(ch => ({ ch, title: (/class="upt">([^<]+)</.exec(ch.innerHTML) || [])[1] || '' }));
  opts.sort((a, b) => { const ia = UPGRADE_PRIORITY.indexOf(a.title), ib = UPGRADE_PRIORITY.indexOf(b.title); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
  opts[0].ch.onclick();
}

function playShop(api) {
  for (let guard = 0; guard < 10; guard++) {
    const items = api.getEl('shop-items').children;
    const g = api.snap();
    const cands = [];
    items.forEach((el, idx) => {
      const buy = el.querySelector('.shop-buy')._l.click;
      const item = api.SHOP_ITEMS[idx];
      if (!buy || !item) return;
      if (item.id === 'potion' && g.rei.hp > g.rei.maxHp * 0.6) return;
      cands.push({ buy: buy[0], pr: SHOP_PRIORITY.indexOf(item.id) });
    });
    if (!cands.length) break;
    cands.sort((a, b) => a.pr - b.pr); cands[0].buy();
  }
  api.closeShop();
}

function playGame(strategy, diff, seed) {
  const api = makeGame(diff, seed), S = STRATS[strategy];
  const trace = []; let steps = 0;
  const MAX_STEPS_PER_WAVE = 60 * 240;          // 4 min de jogo por wave = travou
  let guard = 0, stalled = false;
  while (guard++ < 5000) {
    const st = api.state();
    if (st === 'dead') break;
    if (st === 'victory') break;                       // vitória = fim da simulação (conta em r.won)
    const g = api.snap();
    if (g.wave > MAXWAVE) break;
    if (st === 'prep') {
      playPrep(api, S);
      if (api.state() === 'prep') api.startWave();
    } else if (st === 'battle') {
      let n = 0;
      while (api.state() === 'battle' && n++ < MAX_STEPS_PER_WAVE) api.step();
      steps += n;
      if (api.state() === 'battle') { stalled = true; break; }
      if (TRACE) { const s = api.snap(); trace.push({ wave: s.state === 'dead' ? s.wave : s.wave - 1, hp: Math.round(s.rei.hp) + '/' + s.rei.maxHp, tropas: s.units.filter(u => u).length, goma: s.goma, seg: Math.round(n / 60) }); }
    } else if (st === 'upgrade') playUpgrade(api, S);
    else if (st === 'shop') { if (S.naive || S.skipShop) api.closeShop(); else playShop(api); }
    else api.step();
  }
  const f = api.snap();
  return { won: api.won(), wave: f.wave, kills: f.totalKills, score: f.score, seconds: Math.round(steps / 60), stalled, trace };
}

// ── estatísticas ─────────────────────────────────────────────────────
const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const strategies = String(opt('strategy', Object.keys(STRATS).join(','))).split(',');

// cada "job" = 1 partida; workers pegam fatias da lista (as partidas são independentes e determinísticas)
if (!isMainThread) {
  parentPort.postMessage(workerData.jobs.map(j => ({ ...j, r: playGame(j.strat, j.diff, j.seed) })));
} else {
  const jobs = [];
  for (const diff of DIFFS) for (const strat of strategies) for (let k = 0; k < GAMES; k++) jobs.push({ diff, strat, seed: SEED0 + k, k });
  const t0 = Date.now();
  const slices = Array.from({ length: WORKERS }, (_, w) => jobs.filter((_, i) => i % WORKERS === w));
  Promise.all(slices.map(sl => new Promise((res, rej) => {
    const w = new Worker(__filename, { argv: process.argv.slice(2), workerData: { jobs: sl } });
    w.on('message', res); w.on('error', rej);
  }))).then(parts => report(parts.flat(), t0));
}

function report(done, t0) {
  const results = [];
  for (const diff of DIFFS) for (const strat of strategies) {
    const mine = done.filter(j => j.diff === diff && j.strat === strat).sort((a, b) => a.k - b.k);
    const waves = mine.map(j => j.r.wave);
    if (TRACE && mine[0]) { console.error(`\n[trace] ${diff}/${strat} seed ${SEED0}`); console.error(mine[0].r.trace); }
    results.push({
      diff, strat, n: GAMES, median: pct(waves, 0.5), mean: +mean(waves).toFixed(1), p10: pct(waves, 0.1), p90: pct(waves, 0.9),
      ge10: Math.round(100 * waves.filter(w => w >= 10).length / GAMES), ge15: Math.round(100 * waves.filter(w => w >= 15).length / GAMES),
      ge20: Math.round(100 * waves.filter(w => w >= 20).length / GAMES), win: Math.round(100 * mine.filter(j => j.r.won).length / GAMES), stalled: mine.filter(j => j.r.stalled).length,
    });
  }
  if (JSON_OUT) { console.log(JSON.stringify(results, null, 2)); return; }
  console.log(`\nWave em que a partida terminou (a wave que matou o Rei). ${GAMES} partidas por linha, seed ${SEED0}+. (${((Date.now() - t0) / 1000).toFixed(0)}s, ${WORKERS} workers)\n`);
  console.log('dificuldade  estratégia   mediana  média   p10  p90   ≥w10   ≥w15   ≥w20   VENCE  travou');
  console.log('-----------  -----------  -------  -----  ----  ----  -----  -----  -----  -----  ------');
  for (const r of results)
    console.log(`${r.diff.padEnd(11)}  ${r.strat.padEnd(11)}  ${String(r.median).padStart(7)}  ${String(r.mean).padStart(5)}  ${String(r.p10).padStart(4)}  ${String(r.p90).padStart(4)}  ${String(r.ge10 + '%').padStart(5)}  ${String(r.ge15 + '%').padStart(5)}  ${String(r.ge20 + '%').padStart(5)}  ${String(r.win + '%').padStart(5)}  ${String(r.stalled).padStart(6)}`);
  const byDiff = {};
  results.forEach(r => (byDiff[r.diff] = byDiff[r.diff] || []).push(r.median));
  console.log('\nMediana entre estratégias: ' + Object.entries(byDiff).map(([d, m]) => `${d} ${pct(m, 0.5)}`).join(' | '));
}
