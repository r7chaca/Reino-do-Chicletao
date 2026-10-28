// ═══════════════════════════════════════════
//  ESTADO GLOBAL — tudo declarado antes de qualquer uso
// ═══════════════════════════════════════════
const CELL = 76, COLS = 5, ROWS = 5;
const rei  = { hp:100, maxHp:100, cd:0 };
let units     = new Array(25).fill(null);
let buildings = new Array(25).fill(null);
let enemies=[], projs=[], floats=[], stickyPatches=[];
let hand=[], sel=null;
let wave=1, goma=9, gomaMax=20, state='prep';
let fabCount=0;
let spawnQueue=[], spawnClock=0, totalWave=0;
let upgrades = { dmg:0, spd:0, gomaWave:0, regen:0, synx2:false };
let handDirty=true;
let autoWaveTimer=null, awStartTime=0;
const AW_DELAY = 4000;
let totalKills=0, score=0, gameStarted=false;
let discardMode=false, discardCount=0;
let victoryDone=false, victoryWon=false;   // vitória: já mostrada nesta partida / partida foi vencida   // sistema de descarte (ver seção DESCARTE)

// localStorage pode lançar exceção (modo privado, dados corrompidos) — nunca derrubar o jogo por isso
function lsGet(k,def){ try{ const v=localStorage.getItem(k); return v===null?def:v; }catch(e){ return def; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function lsJSON(k,def){ try{ const v=JSON.parse(lsGet(k,'null')); return v===null||v===undefined?def:v; }catch(e){ return def; } }
function getHSScore(){ return parseInt(lsGet('chicletao_hs_score','0'),10)||0; }
function esc(t){ return String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
let killsByType = { normal:0, tank:0, fast:0, boss:0, healer:0, runner:0, armored:0 };

// ═══════════════════════════════════════════
//  BALANCEAMENTO — todos os números das waves ficam aqui.
//  Para testar mudanças sem jogar na mão:  node tools/simulate.js
// ═══════════════════════════════════════════
const BALANCE = {
  // nº de inimigos = base + wave×linear + wave²×quad   (depois × difficulty.count)
  enemyCount: { base:3, linear:1.8, quad:0.25 },
  // HP base = base + wave×perWave + wave²×quad   (depois × difficulty.hp; tank/boss/runner são multiplicadores)
  hp:    { base:100, perWave:18, quad:1.5, tank:3.0, boss:7.0, runner:0.7 },
  // dano = tipo×difficulty.dmg + floor(wave×perWave); boss = ×bossMult
  dmg:   { normal:6, tank:12, fast:5, healer:2, runner:8, armored:7, perWave:0.9, bossMult:2.0 },
  // velocidade em px/frame (acima de ~3 fica difícil de ver)
  speed: { normal:1.1, perWave:0.038, fastBase:2.1, fastPerWave:0.055, tank:0.5, boss:0.6, healer:0.75,
           runnerBase:1.4, runnerPerWave:0.04, armoredMult:0.9 },
  spawnIntervalMs: 180,
  difficulty: {
    // Ajustados com o simulador (tools/simulate.js). Antes: Fácil 0.6/0.6/0.75/0.7 (bots passavam da wave 35)
    // e Difícil 1.4/1.4/1.25/1.35 (todos os bots morriam na wave 1).
    // late = escala só o termo QUADRÁTICO (crescimento das waves finais) de nº de inimigos e HP; goma = goma extra por wave.
    easy:   { hp:.8,   dmg:.8,   spd:.9,   count:.85, late:.7,  goma:3 },
    normal: { hp:1,    dmg:1,    spd:1,    count:1,   late:.78, goma:0 },
    hard:   { hp:1.12, dmg:1.12, spd:1.06, count:1.1, late:.5,  goma:0 },
  },
  // Wave que precisa ser derrotada para VENCER (depois dá para continuar no modo infinito)
  victoryWave: { easy:15, normal:20, hard:25 },
};

const ACHIEVEMENTS = [
  { id:'first_wave',   title:'Primeira Onda',      desc:'Complete a wave 1',                icon:'🌊', check:()=>wave>1 },
  { id:'wave_10',      title:'Veterano',            desc:'Sobreviva até a wave 10',          icon:'⚔️', check:()=>wave>=10 },
  { id:'wave_20',      title:'Lendário',            desc:'Sobreviva até a wave 20',          icon:'🏆', check:()=>wave>=20 },
  { id:'kills_100',    title:'Caçador',             desc:'Elimine 100 inimigos',             icon:'💀', check:()=>totalKills>=100 },
  { id:'kills_500',    title:'Exterminador',        desc:'Elimine 500 inimigos',             icon:'☠️', check:()=>totalKills>=500 },
  { id:'first_legend', title:'Rei da Bala',         desc:'Coloque um lendário no grid',      icon:'🍮', check:()=>units.some(u=>u&&u.id==='lenda') },
  { id:'full_grid',    title:'Grid Completo',       desc:'Preencha todas as 25 células',     icon:'🟥', check:()=>units.filter(u=>u).length===25 },
  { id:'first_boss',   title:'Caçador de Chefes',  desc:'Derrote seu primeiro boss',        icon:'👹', check:()=>killsByType.boss>0 },
  { id:'combo_5',      title:'Combo Master',        desc:'Alcance combo x5',                 icon:'🔥', check:()=>comboCount>=5 },
  { id:'score_1k',     title:'Mil Pontos',          desc:'Alcance 1.000 de score',           icon:'⭐', check:()=>score>=1000 },
  { id:'score_10k',    title:'Dez Mil',             desc:'Alcance 10.000 de score',          icon:'🌟', check:()=>score>=10000 },
  { id:'victory',      title:'Rei Protegido',      desc:'Vença uma partida (qualquer dificuldade)', icon:'👑', check:()=>victoryWon },
  { id:'victory_hard', title:'Lenda do Chicletão', desc:'Vença no Difícil',                 icon:'🔥', check:()=>victoryWon && difficulty==='hard' },
  { id:'full_upgrade', title:'Max Power',           desc:'Leve qualquer tropa ao nível 3',   icon:'💥', check:()=>units.some(u=>u&&(u.lvl||1)>=3) },
];

const SHOP_ITEMS = [
  { id:'potion',   name:'Poção de Goma',   desc:'Restaura 25 HP do Rei',          cost:4,  icon:'🧪', fn:()=>{ const h=Math.min(25,rei.maxHp-rei.hp); rei.hp+=h; notify('🧪 +'+Math.round(h)+' HP!'); } },
  { id:'boost',    name:'Chiclete Turbo',  desc:'+5 dano permanente às tropas',    cost:5,  icon:'⚡', fn:()=>{ upgrades.dmg+=5; notify('⚡ +5 dano!'); } },
  { id:'cards',    name:'Saco de Cartas',  desc:'Compra 3 cartas aleatórias',      cost:3,  icon:'🃏', fn:()=>{ for(let i=0;i<3;i++) drawCard(); notify('🃏 +3 cartas!'); } },
  { id:'goma',     name:'Reservatório',    desc:'+8 goma máxima',                  cost:4,  icon:'💧', fn:()=>{ gomaMax+=8; notify('💧 Goma max +8!'); } },
  { id:'shield',   name:'Escudo Real',     desc:'+20 HP máximo do Rei',            cost:5,  icon:'🛡', fn:()=>{ rei.maxHp+=20; rei.hp=Math.min(rei.hp+20,rei.maxHp); notify('🛡 +20 HP máx!'); } },
  { id:'upgrade',  name:'Elixir de Força', desc:'Sobe 1 nível numa tropa aleatória',cost:6, icon:'🌟', fn:()=>{
    const u=levelUpRandomUnit();
    notify(u?'🌟 Tropa nível '+u.lvl+'!':'Nenhuma tropa para upar!');
  }},
];

const LVL_MULT={1:{hp:1,dmg:1},2:{hp:1.6,dmg:1.5},3:{hp:2.5,dmg:2.2}};
function applyLevel(u) {
  const base=DECK.find(c=>c.id===u.id); if(!base) return;
  const m=LVL_MULT[u.lvl]; u.maxHp=Math.round(base.hp*m.hp); u.hp=u.maxHp; u.dmg=Math.round(base.dmg*m.dmg);
}
// Sobe 1 nível numa tropa aleatória abaixo do nível 3. Retorna a tropa (ou null).
function levelUpRandomUnit() {
  const cand=units.filter(u=>u&&(u.lvl||1)<3); if(!cand.length) return null;
  const u=cand[Math.floor(Math.random()*cand.length)];
  u.lvl=Math.min(3,(u.lvl||1)+1); applyLevel(u); renderUnitEl(u.row*COLS+u.col); return u;
}
function refreshAllUnits() { units.forEach((u,i)=>{ if(u) renderUnitEl(i); }); }

let difficulty='normal'; // 'easy' | 'normal' | 'hard'
let gameSpeed=1, paused=false;
let comboCount=0, comboLeft=0;   // comboLeft em ms de jogo (respeita pausa e velocidade)
let lastTime=0, regenAcc=0, targetUpdateTimer=0;
let targetedCells = new Set();

// ═══════════════════════════════════════════
//  DOM REFS
// ═══════════════════════════════════════════
const arenaOuter = document.getElementById('arena');   // área visível (recebe o tremor de tela)
const arena      = document.getElementById('stage');   // palco 960×540 escalado: tudo do jogo vive aqui
const STAGE_W = 960, STAGE_H = 540;
const gridEl   = document.getElementById('grid');
const reiEl    = document.getElementById('rei-el');
const reiHPBar = document.getElementById('rei-hpbar');

// Escala o palco inteiro para caber na área visível (mantém proporção).
function fitStage() {
  const w=arenaOuter.clientWidth, h=arenaOuter.clientHeight; if(!w||!h) return;
  const s=Math.min(2, w/STAGE_W, h/STAGE_H);
  arena.style.transform='translate(-50%,-50%) scale('+s+')';
}
window.addEventListener('resize', fitStage);
window.addEventListener('orientationchange', fitStage);
if (window.ResizeObserver) new ResizeObserver(fitStage).observe(arenaOuter);
fitStage();

// Todas as coordenadas do jogo são do PALCO (px lógicos). offsetLeft/Top ignoram o scale do CSS,
// então não dependem do tamanho da janela — e ainda evitam getBoundingClientRect (reflow).
function offsetInStage(el) {
  let x=0, y=0;
  while (el && el!==arena) { x+=el.offsetLeft; y+=el.offsetTop; el=el.offsetParent; }
  return { x, y };
}
function gridBox() {
  const o=offsetInStage(gridEl);
  return { left:o.x, top:o.y, width:gridEl.offsetWidth, height:gridEl.offsetHeight };
}

// Posições das células e do Rei ficam em cache (recalculadas ao iniciar o jogo e cada wave).
let _cellCenters=null, _reiCenter=null;
function computeCellCenters() {
  const o=offsetInStage(gridEl), bx=o.x+gridEl.clientLeft, by=o.y+gridEl.clientTop;
  _cellCenters=[];
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++)
    _cellCenters.push({ x: bx+c*CELL+CELL/2, y: by+r*CELL+CELL/2 });
  const ro=offsetInStage(reiEl);
  _reiCenter={ x: ro.x+reiEl.offsetWidth/2, y: ro.y+reiEl.offsetHeight/2 };
}
function cellCenter(col,row) { if(!_cellCenters) computeCellCenters(); return _cellCenters[row*COLS+col]; }
function reiCenter()         { if(!_reiCenter)   computeCellCenters(); return _reiCenter; }

// ═══════════════════════════════════════════
//  ÁUDIO
// ═══════════════════════════════════════════
let audioCtx=null, muted=false;
function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  return audioCtx;
}
function playTone(freq,type,dur,vol=0.18) {
  if (muted) return;
  try {
    const ctx=getCtx(), o=ctx.createOscillator(), g=ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type=type; o.frequency.value=freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+dur);
    o.start(); o.stop(ctx.currentTime+dur);
  } catch(e) {}
}
function sfxPlace()   { playTone(440,'sine',0.08,0.15); }
function sfxUpgrade() { playTone(660,'sine',0.12,0.18); setTimeout(()=>playTone(880,'sine',0.1,0.18),80); }
function sfxHit()     { playTone(180,'sawtooth',0.06,0.1); }
function sfxKill()    { playTone(520,'square',0.07,0.09); }
function sfxWave()    { playTone(220,'sine',0.15,0.2); setTimeout(()=>playTone(330,'sine',0.12,0.2),120); }
function sfxBoss()    { playTone(110,'sawtooth',0.3,0.25); setTimeout(()=>playTone(80,'sawtooth',0.2,0.3),200); }
function sfxWin()     { [440,550,660,880].forEach((f,i)=>setTimeout(()=>playTone(f,'sine',0.18,0.22),i*90)); }
function sfxCard()    { playTone(300,'sine',0.05,0.08); }
function sfxDiscard() { playTone(260,'triangle',0.07,0.12); setTimeout(()=>playTone(520,'sine',0.08,0.12),60); }
function sfxError()   { playTone(160,'sawtooth',0.08,0.12); }
function sfxCombo()   { playTone(880,'sine',0.06,0.1); setTimeout(()=>playTone(1100,'sine',0.08,0.12),60); }
function sfxHealer()  { playTone(600,'sine',0.07,0.12); }
function sfxEvent()   { [440,550,660].forEach((f,i)=>setTimeout(()=>playTone(f,'sine',0.12,0.2),i*100)); }
function toggleMute() { muted=!muted; document.getElementById('btn-mute').textContent=muted?'🔇 Mudo':'🔊 Som'; }

// ═══════════════════════════════════════════
//  LEGENDA
// ═══════════════════════════════════════════
function toggleLegend() {
  const p = document.getElementById('legend-panel');
  p.style.display = p.style.display==='block' ? 'none' : 'block';
}

// ═══════════════════════════════════════════
//  PASSIVAS DAS TROPAS
// ═══════════════════════════════════════════
const PASSIVES = {
  atirador: { tag:'★ Crítico 20%',  desc:'20% chance de dano duplo' },
  tanque:   { tag:'🛡 Taunt',        desc:'Inimigos priorizam o Blocão' },
  sticky:   { tag:'🟤 Rastro auto',  desc:'Cria gosma a cada ataque' },
  healer:   { tag:'💚 Cura aura',    desc:'Cura aliados a cada ciclo' },
  lenda:    { tag:'👑 Lendário',     desc:'Ignora sinergias (já é top)' },
  mascador: { tag:'💚 Aura de regen',  desc:'Regenera HP das tropas vizinhas' },
};
// Cada Chiclete Turbo = cooldown ×0.8 (= +25% de velocidade de ataque), mínimo 180ms
function unitCd(u) { return Math.max(180, u.spd*16*Math.pow(0.8, upgrades.spd)); }
function hasTaunt() { return units.some(u=>u&&u.id==='tanque'); }

// ═══════════════════════════════════════════
//  PARTÍCULAS DE MORTE
// ═══════════════════════════════════════════
function spawnParticles(x, y, color, count=6) {
  // Remover partículas antigas se acima do limite
  const existing = document.querySelectorAll('.particle');
  if(existing.length > 40) existing.forEach((el,i)=>{ if(i<existing.length-30) el.remove(); });
  for (let i=0; i<count; i++) {
    const el = document.createElement('div');
    el.className = 'particle';
    const angle = (i/count)*Math.PI*2 + Math.random()*.5;
    const dist  = 24 + Math.random()*24;
    const dx    = Math.cos(angle)*dist;
    const dy    = Math.sin(angle)*dist;
    const size  = 4+Math.random()*5;
    const dur   = (0.35+Math.random()*.25).toFixed(2)+'s';
    el.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;`
      +`background:${color};--dx:${dx}px;--dy:${dy}px;--dur:${dur};`;
    arena.appendChild(el);
    setTimeout(()=>el.remove(), 650);
  }
}

// ═══════════════════════════════════════════
//  HIGH SCORE
// ═══════════════════════════════════════════
const HS_KEY = 'chicletao_hs';
function getHS() { return parseInt(lsGet(HS_KEY,'0'),10)||0; }
function setHS(v) { lsSet(HS_KEY,v); }
document.getElementById('hs-val').textContent = getHS();
(function() {
  const hs = getHS();
  const el = document.getElementById('title-hs');
  const hsScore = getHSScore();
  if (el) el.textContent = hs > 0 ? '🏆 Wave '+hs+(hsScore>0?' · '+hsScore.toLocaleString('pt-BR')+' pts':'') : '';
})();

// ═══════════════════════════════════════════
//  TELA DE TÍTULO — usa addEventListener, nunca onclick inline
// ═══════════════════════════════════════════
document.getElementById('btn-start').addEventListener('click', function() {
  document.getElementById('ov-title').style.display = 'none';
  if (!gameStarted) {
    gameStarted = true;
    for (let i=0; i<6; i++) hand.push(pickCard());
    // Mão inicial justa: garante pelo menos 3 tropas (antes dava para abrir só com cartas de utilidade e morrer na wave 1)
    for (let i=0; i<hand.length && hand.filter(c=>c.type==='unit').length<3; i++) {
      if (hand[i].type==='unit') continue;
      let c; do { c=pickCard(); } while (c.type!=='unit');
      hand[i]=c;
    }
    handDirty = true;
    tip('start');
  }
});

// ═══════════════════════════════════════════
//  VELOCIDADE
// ═══════════════════════════════════════════
function setSpeed(s) {
  gameSpeed = s;
  [1,2,3].forEach(v => {
    const b = document.getElementById('spd-'+v);
    if (b) b.classList.toggle('spd-active', v===s);
  });
}

// ═══════════════════════════════════════════
//  PAUSA
// ═══════════════════════════════════════════
function togglePause() {
  if (state==='dead'||state==='prep'||state==='upgrade') return;
  paused = !paused;
  const btn=document.getElementById('btn-pause'), ov=document.getElementById('ov-pause');
  if (paused) { if(btn) btn.textContent='▶ Resume'; if(ov) ov.style.display='flex'; }
  else        { if(btn) btn.textContent='⏸ Pausa';  if(ov) ov.style.display='none'; }
}
document.addEventListener('keydown', e => {
  if (e.key==='p'||e.key==='P'||e.key===' ') { e.preventDefault(); togglePause(); return; }
  if (!gameStarted || paused) return;
  if (e.key==='Enter' && state==='prep') { e.preventDefault(); startWave(); return; }
  if ((e.key==='d'||e.key==='D') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleDiscard(); return; }
  if (e.key==='Escape' && discardMode) { setDiscardMode(false); return; }
  if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const idx = e.key==='0'?9:Number(e.key)-1;   // 1–9 = cartas 1–9, 0 = carta 10
    if (discardMode) discardCard(idx); else selectCard(idx);
  }
});

// ═══════════════════════════════════════════
//  COMBO
// ═══════════════════════════════════════════
function registerKill() {
  totalKills++;
  score += wave * 10 * (comboCount >= 3 ? 2 : 1);
  const sel = document.getElementById('hv-score'); if(sel) sel.innerText = score;
  comboCount++; comboLeft=2000;
  if (comboCount >= 3) {
    const rc = reiCenter();
    const el = document.createElement('div');
    el.className = 'combo-float';
    el.style.left = rc.x+'px'; el.style.top = (rc.y-50)+'px';
    el.style.color = comboCount>=6?'#ff4400':comboCount>=4?'#ff8800':'#ffaa00';
    el.textContent = 'COMBO x'+comboCount+'! 🔥';
    arena.appendChild(el);
    setTimeout(()=>el.remove(), 750);
    sfxCombo();
  }
  checkAchievements();   // depois de atualizar combo/score, para as conquistas não atrasarem 1 kill
}

// ═══════════════════════════════════════════
//  DECK
// ═══════════════════════════════════════════
const DECK = [
  {id:'mascador', name:'Mascador',      icon:'./assets/chicleteMascador.webp', emoji:null,  desc:'Soldado fiel do Rei',           cost:2, type:'unit',     hp:75,  dmg:14, spd:46, color:'#ff88bb', rarity:'common',  weight:9},
  {id:'acido',    name:'Chicle Ácido',  icon:'./assets/chicleteAcido.webp',   emoji:'🍋',  desc:'Rápido, pouca resistência',     cost:2, type:'unit',     hp:40,  dmg:11, spd:22, color:'#aadd22', rarity:'common',  weight:9},
  {id:'tanque',   name:'Blocão',        icon:'./assets/chicleteTanque.webp',  emoji:null,  desc:'Parede viva de chiclete',       cost:4, type:'unit',     hp:500, dmg:12, spd:60, color:'#ff44aa', rarity:'rare',    weight:7},
  {id:'atirador', name:'Franqueiro',    icon:'./assets/Franqueiro.webp',              emoji:'🎯',  desc:'Alto dano, vida baixa',         cost:3, type:'unit',     hp:52,  dmg:32, spd:75, color:'#cc8844', rarity:'rare',    weight:6},
  {id:'duplo',    name:'Par de Goma',   icon:null,                            emoji:'🍡',  desc:'Equilibrado e barato',          cost:2, type:'unit',     hp:60,  dmg:13, spd:44, color:'#ff66cc', rarity:'common',  weight:9},
  {id:'lenda',    name:'Rei da Bala',   icon:null,                            emoji:'🍮',  desc:'Lendário. Ponto final.',        cost:4, type:'unit',     hp:250, dmg:42, spd:60, color:'#ffd700', rarity:'legend',  weight:2},
  {id:'sticky',   name:'Goma Grudenta', icon:null,                            emoji:'🟤',  desc:'Gosma que lentifica inimigos',  cost:5, type:'unit',     hp:78,  dmg:16, spd:80, color:'#aa6633', rarity:'rare',    weight:5},
  {id:'healer',   name:'Chicle Cura',   icon:null,                            emoji:'💚',  desc:'Cura tropas aliadas próximas',  cost:3, type:'unit',     hp:55,  dmg:5,  spd:90, color:'#44dd88', rarity:'rare',    weight:4},
  {id:'fab',      name:'Fábrica',       icon:null,                            emoji:'🏭',  desc:'Gera +goma por wave',           cost:3, type:'building',                          rarity:'rare',    weight:5},
  {id:'fusao',    name:'Derretimento',  icon:null,                            emoji:'🔥',  desc:'Sacrifica 1 tropa → +3 cartas', cost:2, type:'sacrifice',                         rarity:'common',  weight:3},
  {id:'cura',     name:'Xarope King',   icon:null,                            emoji:'🧪',  desc:'Cura o Rei em +30 HP',          cost:2, type:'heal',                              rarity:'rare',    weight:3},
  {id:'gomada',   name:'Puxada de Goma',icon:null,                            emoji:'💧',  desc:'+6 goma agora',                 cost:1, type:'goma',                              rarity:'rare',    weight:1},
];

function pickCard() {
  const pool = DECK.filter(c => c.rarity!=='legend' || Math.random()<0.07);
  const total = pool.reduce((s,c)=>s+c.weight, 0);
  let r = Math.random()*total;
  for (const c of pool) { r-=c.weight; if(r<=0) return c; }
  return pool[pool.length-1];
}
function drawCard() {
  if (hand.length<10) { hand.push(pickCard()); handDirty=true; sfxCard(); checkAutoWave(); }
}

// ═══════════════════════════════════════════
//  GRID
// ═══════════════════════════════════════════
function buildGrid() {
  gridEl.innerHTML = '';
  for (let r=0; r<ROWS; r++) {
    for (let c=0; c<COLS; c++) {
      const idx = r*COLS+c;
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.idx = idx;
      cell.addEventListener('click', ()=>onCellClick(idx));
      cell.addEventListener('mouseenter', ()=>showCellPreview(idx));
      cell.addEventListener('mouseleave', hideCellPreview);
      cell.addEventListener('touchstart', e=>{ e.preventDefault(); showCellPreview(idx); }, {passive:false});
      cell.addEventListener('touchend',   e=>{ e.preventDefault(); onCellClick(idx); hideCellPreview(); }, {passive:false});
      gridEl.appendChild(cell);
    }
  }
}
buildGrid();
function getCellEl(idx) { return gridEl.children[idx]; }

// PREVIEW DE DANO
let previewEl = null;
function showCellPreview(idx) {
  hideCellPreview();
  if (sel===null || state!=='prep') return;
  const card = hand[sel];
  if (card.type !== 'unit') return;
  let lvl=1, dmg=card.dmg, hp=card.hp;
  const eu = units[idx];
  if (eu && eu.id===card.id) {
    lvl = Math.min(3,(eu.lvl||1)+1);
    const m = LVL_MULT[lvl];
    dmg=Math.round(card.dmg*m.dmg); hp=Math.round(card.hp*m.hp);
  }
  const syn=synergy(), cell=getCellEl(idx), el=document.createElement('div');
  el.id = 'cell-preview';
  el.style.cssText = 'position:absolute;bottom:calc(100% + 4px);left:50%;transform:translateX(-50%);background:rgba(10,0,5,.95);border:1px solid #ff4466;border-radius:6px;padding:5px 8px;font-size:9px;color:#ffaacc;white-space:nowrap;z-index:20;pointer-events:none;text-align:center;';
  el.innerHTML = '<b>'+card.name+(lvl>1?' Nv.'+lvl:'')+'</b><br>❤️'+hp+' ⚔️'+(dmg+syn)+'<span style="color:#555"> (+'+syn+' sin)</span>';
  cell.style.position = 'relative';
  cell.appendChild(el);
  previewEl = el;
}
function hideCellPreview() { if (previewEl) { previewEl.remove(); previewEl=null; } }

// INDICADOR DE ALVO
function updateTargetIndicators() {
  targetedCells.forEach(i => { const c=getCellEl(i); if(c) c.classList.remove('targeted'); });
  targetedCells.clear();
  enemies.forEach(e => {
    let minD=Infinity, tIdx=-1;
    units.forEach((u,i) => {
      if (!u) return;
      const cc=cellCenter(u.col,u.row), d=dist(e.x,e.y,cc.x,cc.y);
      if (d<minD && d<260) { minD=d; tIdx=u.row*COLS+u.col; }
    });
    if (tIdx>=0) { targetedCells.add(tIdx); const c=getCellEl(tIdx); if(c) c.classList.add('targeted'); }
  });
}

function refreshGrid() {
  const card = sel!==null ? hand[sel] : null;
  for (let i=0; i<25; i++) {
    const cell = getCellEl(i);
    const wasTargeted = cell.classList.contains('targeted');
    cell.className = 'cell';
    if (wasTargeted) cell.classList.add('targeted');
    if (!card || state!=='prep') continue;
    if (!units[i]&&!buildings[i]&&(card.type==='unit'||card.type==='building')) cell.classList.add('highlight');
    if (units[i]&&card.type==='sacrifice') cell.classList.add('highlight');
    if (units[i]&&card.type==='unit'&&units[i].id===card.id&&(units[i].lvl||1)<3) cell.classList.add('upgradable');
    if (buildings[i]&&card.type==='building'&&buildings[i].id===card.id&&(buildings[i].lvl||1)<3) cell.classList.add('upgradable');
  }
}

// ═══════════════════════════════════════════
//  RENDER UNIDADE
// ═══════════════════════════════════════════
function makeUnitIcon(card) {
  if (card.icon) {
    const img = document.createElement('img');
    img.src = card.icon;
    img.onerror = () => { const sp=document.createElement('span'); sp.className='unit-emoji'; sp.textContent=card.emoji||'❓'; img.replaceWith(sp); };
    return img;
  }
  const sp = document.createElement('span');
  sp.className = 'unit-emoji'; sp.textContent = card.emoji||'❓';
  return sp;
}
function renderUnitEl(idx) {
  const cell = getCellEl(idx);
  cell.querySelectorAll('.unit-el,.fab-el').forEach(e=>e.remove());
  const u=units[idx], b=buildings[idx];
  if (u) {
    const lvl=u.lvl||1, el=document.createElement('div');
    el.className = 'unit-el'+(lvl===3?' lvl3':lvl===2?' lvl2':'');
    el.style.color = u.color;
    const hp=Math.max(0,u.hp/u.maxHp), hpColor=hp>.5?'#44cc88':hp>.25?'#ffcc00':'#ff2244';
    if (lvl>=2) {
      const s=document.createElement('span'); s.className='stars';
      s.style.color=lvl===3?'#ff44ff':'#ffd700'; s.textContent=lvl===3?'★★★':'★★';
      el.appendChild(s);
    }
    const bc = DECK.find(c=>c.id===u.id);
    el.appendChild(makeUnitIcon(bc||{icon:null,emoji:'❓'}));
    const hw=document.createElement('div'); hw.className='hp-wrap';
    hw.innerHTML = '<div class="hp-bar-bg"><div class="hp-bar" style="width:'+hp*100+'%;background:'+hpColor+'"></div></div>';
    el.appendChild(hw);
    // DPS indicator
    const dpsEl=document.createElement('div'); dpsEl.className='unit-dps';
    const syn=synergy(), cd=unitCd(u);
    dpsEl.textContent = '⚔️'+Math.round((u.dmg+upgrades.dmg+syn)/(cd/1000))+'/s';
    el.appendChild(dpsEl);
    u.el=el; cell.appendChild(el);
  }
  if (b) {
    const lvl=b.lvl||1, el=document.createElement('div'); el.className='fab-el';
    el.style.borderColor = lvl===3?'#ff8800':lvl===2?'#ffd700':'#bb8800';
    el.innerHTML = (lvl>=2?'<span class="fab-lv" style="color:'+(lvl===3?'#ff8800':'#ffd700')+'">'+(lvl===3?'★★★':'★★')+'</span>':'')
      +'<span style="font-size:24px">🏭</span><span class="fab-bonus">+'+fabGoma(lvl)+'/wave</span>';
    b.el=el; cell.appendChild(el);
  }
}
function fabGoma(lvl) { return 4+(lvl-1)*2; }
function fabBonus() {
  let t=0,rank=0;
  buildings.forEach(b=>{ if(b&&b.id==='fab'){ rank++; t+=fabGoma(b.lvl||1)*Math.max(0.5,1-rank*.1); } });
  return Math.floor(t);
}

// ═══════════════════════════════════════════
//  AUTO-WAVE
// ═══════════════════════════════════════════
function checkAutoWave() {
  if (state!=='prep') return;
  // só dispara com a mão quase vazia E sem nenhuma carta que dê para pagar (antes disparava mesmo com goma sobrando)
  if (hand.length<=2 && !hand.some(c=>c.cost<=goma)) {
    if (!autoWaveTimer) {
      awStartTime = performance.now();
      document.getElementById('auto-wave').style.display = 'block';
      autoWaveTimer = setInterval(()=>{
        const el = performance.now()-awStartTime;
        document.getElementById('aw-sec').innerText = Math.max(0,Math.ceil((AW_DELAY-el)/1000));
        document.getElementById('aw-fill').style.width = (el/AW_DELAY*100)+'%';
        if (el>=AW_DELAY) {
          clearInterval(autoWaveTimer); autoWaveTimer=null;
          document.getElementById('auto-wave').style.display='none';
          if (state==='prep') startWave();
        }
      }, 80);
    }
  } else {
    if (autoWaveTimer) { clearInterval(autoWaveTimer); autoWaveTimer=null; }
    document.getElementById('auto-wave').style.display='none';
  }
}

// ═══════════════════════════════════════════
//  RENDER MÃO
// ═══════════════════════════════════════════
function canUpgrade(card) {
  if (card.type==='building') return buildings.some(b=>b&&b.id===card.id&&(b.lvl||1)<3);
  if (card.type!=='unit') return false;
  return units.some(u=>u&&u.id===card.id&&(u.lvl||1)<3);
}
function cardIconHTML(c) {
  if (c.icon) {
    const img=document.createElement('img'); img.src=c.icon; img.className='ci';
    img.onerror=function(){ this.outerHTML='<span class="ci-emoji">'+(c.emoji||'❓')+'</span>'; };
    return img.outerHTML;
  }
  return '<span class="ci-emoji">'+(c.emoji||'❓')+'</span>';
}
function renderHand() {
  if (!handDirty) return; handDirty=false;
  const el=document.getElementById('hand'); el.innerHTML='';
  hand.forEach((c,i) => {
    const ok=goma>=c.cost&&state==='prep', up=canUpgrade(c);
    const div=document.createElement('div');
    // no modo descarte nenhuma carta fica "apagada": todas podem ser descartadas, mesmo as que não dá para pagar
    div.className = 'card'+(sel===i?' sel':'')+(up?' has-upgrade':'')+(discardMode?' discarding':(!ok?' dim':''));
    const statsHTML = c.type==='unit' ? '<div class="card-stats">⚔️'+c.dmg+' ❤️'+c.hp+'</div>' : '';
    const passHTML  = (c.type==='unit'&&PASSIVES[c.id]) ? '<div class="passive-tag">'+PASSIVES[c.id].tag+'</div>' : '';
    div.innerHTML = '<div class="cc">'+c.cost+'</div>'+cardIconHTML(c)
      +'<div class="cn">'+c.name+'</div>'+statsHTML+passHTML
      +'<div class="cd">'+c.desc+'</div><div class="cbar r-'+c.rarity+'"></div>';
    div.setAttribute('role','button'); div.setAttribute('tabindex','0');
    div.setAttribute('aria-label', c.name+', custo '+c.cost+(ok?'':' (goma insuficiente)')+' — tecla '+(i===9?0:i+1)+(discardMode?' — clique para descartar (+'+DISCARD_GOMA+' goma)':''));
    div.addEventListener('pointerdown', ev => { ev.stopPropagation(); if (discardMode) discardCard(i); else selectCard(i); });
    div.addEventListener('keydown', ev => { if (ev.key==='Enter') { ev.preventDefault(); ev.stopPropagation(); if (discardMode) discardCard(i); else selectCard(i); } });
    el.appendChild(div);
  });
  el.classList.toggle('discarding', discardMode);
  refreshGrid();
}

// ═══════════════════════════════════════════
//  HUD
// ═══════════════════════════════════════════
function updateHUD() {
  document.getElementById('hv-wave').innerText = wave;
  document.getElementById('hv-goma').innerText = goma;
  document.getElementById('hv-goma-max').innerText = gomaMax;
  document.getElementById('bfgoma').style.width = (goma/gomaMax*100)+'%';
  document.getElementById('hv-fab-info').innerText = fabCount>0?'🏭×'+fabCount+' +'+fabBonus()+'/wave':'';
  document.getElementById('hv-hp').innerText = Math.max(0,Math.ceil(rei.hp));
  document.getElementById('hv-hp-max').innerText = rei.maxHp;
  document.getElementById('bfhp').style.width = Math.max(0,rei.hp/rei.maxHp*100)+'%';
  document.getElementById('hv-state').innerText = paused?'PAUSA':state.toUpperCase();
  reiHPBar.style.width = Math.max(0,rei.hp/rei.maxHp*100)+'%';
  reiHPBar.style.background = rei.hp/rei.maxHp>.5?'#ff6688':rei.hp/rei.maxHp>.25?'#ffcc00':'#ff2244';
  if (totalWave>0)
    document.getElementById('bfwave').style.width = Math.max(0,(1-(spawnQueue.length+enemies.length)/totalWave)*100)+'%';
  const killEl = document.getElementById('hv-kills'); if(killEl) killEl.innerText=totalKills;
  // alerta visual: borda vermelha pulsando quando o Rei está com menos de 30% de HP
  arenaOuter.classList.toggle('danger', rei.hp>0 && rei.hp/rei.maxHp<.3 && state==='battle');
  // botão de descarte: só no preparo e com cartas na mão; "aceso" enquanto o modo descarte está ligado
  const db = document.getElementById('btn-discard');
  if (db) {
    db.disabled = !(gameStarted && state==='prep' && hand.length>0);
    db.classList.toggle('active', discardMode);
  }
  if (discardMode && (state!=='prep' || !hand.length)) setDiscardMode(false);
  // prévia da próxima wave (só no preparo)
  const pv = state==='prep' && gameStarted ? wavePreviewText() : '';
  if (pv!==_lastPreview) { _lastPreview=pv; const pe=document.getElementById('wave-preview'); if(pe) pe.innerText=pv; }
}
let _lastPreview='';

// DICAS DA PRIMEIRA PARTIDA — aparecem uma vez cada (salvas no localStorage), sem bloquear o jogo
const TIPS = {
  start:  '👆 Escolha uma carta da mão e clique numa célula do grid para posicionar a tropa',
  placed: '⬆️ Cartas iguais sobem de nível (até 3): selecione a carta e clique na tropa igual',
  wave:   '⌨️ Atalhos: 1–9 escolhem cartas · Enter invoca a horda · P pausa · D descarta',
  discard:'🗑 Carta que não vai usar? Descarte por +3 goma cada (botão 🗑 ou tecla D)',
};
const tipsSeen = new Set((()=>{ const a=lsJSON('chicletao_tips',[]); return Array.isArray(a)?a:[]; })());
let tipT=null;
function tip(key) {
  if (tipsSeen.has(key) || !TIPS[key]) return;
  tipsSeen.add(key); lsSet('chicletao_tips', JSON.stringify([...tipsSeen]));
  const el=document.getElementById('tip'); if(!el) return;
  el.innerText=TIPS[key]; el.style.opacity='1';
  clearTimeout(tipT); tipT=setTimeout(()=>el.style.opacity='0', 6000);
}

let notifT=null;
function notify(txt) {
  const n=document.getElementById('notif'); n.innerText=txt; n.style.opacity='1';
  clearTimeout(notifT); notifT=setTimeout(()=>n.style.opacity='0', 2200);
}
let badgeT=null;
function showBadge(txt) {
  const b=document.getElementById('wave-badge'); b.innerText=txt; b.style.opacity='1';
  clearTimeout(badgeT); badgeT=setTimeout(()=>b.style.opacity='0', 2500);
}
let eventT=null;
function showEvent(txt) {
  const b=document.getElementById('event-banner'); b.innerText=txt; b.style.opacity='1'; sfxEvent();
  clearTimeout(eventT); eventT=setTimeout(()=>b.style.opacity='0', 3000);
}
function spawnFloat(x,y,txt,color='#ff4466') {
  const el=document.createElement('div'); el.className='float-el';
  el.style.left=x+'px'; el.style.top=y+'px'; el.style.color=color;
  el.innerText=txt; arena.appendChild(el);
  // Limite de 30 floats simultâneos para evitar entupimento do DOM
  if(floats.length>=30){ floats[0].el.remove(); floats.shift(); }
  floats.push({el, y, vy:-1.2+(Math.random()-.5)*.4, life:1});
}
let shakeTimer=null;
function shakeScreen() {
  arenaOuter.classList.remove('shake'); void arenaOuter.offsetWidth; arenaOuter.classList.add('shake');
  clearTimeout(shakeTimer); shakeTimer=setTimeout(()=>arenaOuter.classList.remove('shake'),300);
}

// ═══════════════════════════════════════════
//  CRIAR INIMIGO DOM
// ═══════════════════════════════════════════
function createEnemyEl(e) {
  const wrap=document.createElement('div'); wrap.className='enemy-el spawning';
  wrap.style.left=e.x+'px'; wrap.style.top=e.y+'px';
  const sz=e.type==='boss'?56:e.type==='tank'?42:e.type==='fast'?22:e.type==='healer'?32:30;
  e.sz=sz;
  const body=document.createElement('div'); body.className='enemy-body '+e.type;
  body.style.width=sz+'px'; body.style.height=sz+'px'; body.style.fontSize=(sz*.48)+'px';
  body.innerText=e.type==='boss'?'👹':e.type==='tank'?'🛡️':e.type==='fast'?'💨':e.type==='healer'?'💊':e.type==='runner'?'🏃':e.type==='armored'?'🪖':'💀';
  if (e.type!=='normal') {
    const badge=document.createElement('div'); badge.className='enemy-badge';
    const colors={boss:'#6600ff',tank:'#ff6600',fast:'#00cc66',healer:'#009944',runner:'#cc00aa',armored:'#4488ff'};
    badge.style.background=colors[e.type]||'#880022'; badge.style.color='#fff';
    badge.innerText=e.type==='boss'?'BOSS':e.type==='tank'?'TANK':e.type==='fast'?'FAST':e.type==='runner'?'RUNNER':e.type==='armored'?'ARMADO':'CURADOR';
    wrap.appendChild(badge);
  }
  const hpBg=document.createElement('div'); hpBg.className='enemy-hp-bg'; hpBg.style.width=sz+'px';
  const hpBar=document.createElement('div');
  hpBar.className='enemy-hp '+(e.type==='boss'?'boss-hp':e.type==='healer'?'healer-hp':e.type==='armored'?'armored-hp':'normal-hp');
  hpBar.style.width='100%';
  hpBg.appendChild(hpBar); wrap.appendChild(body); wrap.appendChild(hpBg);
  if (e.type==='boss') {
    const lbl=document.createElement('div'); lbl.className='boss-label';
    lbl.innerText='☠️ VENOM '+Math.ceil(e.hp); wrap.appendChild(lbl); e.bossLabel=lbl;
  }
  e.el=wrap; e.bodyEl=body; e.hpEl=hpBar; arena.appendChild(wrap);
  setTimeout(()=>wrap.classList.remove('spawning'), 260);
}
function createProjEl(p) {
  const el=document.createElement('div'); el.className='proj-el';
  el.style.width=(p.r*2)+'px'; el.style.height=(p.r*2)+'px';
  el.style.background=p.color; el.style.boxShadow='0 0 6px '+p.color;
  el.style.left=p.x+'px'; el.style.top=p.y+'px';
  p.el=el; arena.appendChild(el);
}

// ═══════════════════════════════════════════
//  CLICK NA CÉLULA
// ═══════════════════════════════════════════
function onCellClick(idx) {
  if (state!=='prep' || sel===null) return;
  const card=hand[sel], col=idx%COLS, row=Math.floor(idx/COLS);

  // Derretimento: o jogador ESCOLHE qual tropa sacrificar (antes sacrificava sempre a primeira do grid)
  if (card.type==='sacrifice') {
    if (!units[idx])    { notify('🔥 Clique numa tropa para sacrificar'); sfxError(); return; }
    if (goma<card.cost) { notify('🍬 Goma insuficiente!'); sfxError(); return; }
    goma-=card.cost;
    const ac=cellCenter(col,row);
    spawnFloat(ac.x,ac.y-16,'💥 Sacrificado!','#ff4444');
    units[idx]=null; renderUnitEl(idx);
    for (let i=0;i<3;i++) drawCard();
    notify('🔥 Sacrifício! +3 cartas'); sfxPlace(); consume(); return;
  }

  // upgrade unidade
  if (units[idx] && card.type==='unit') {
    const u=units[idx];
    if (u.id!==card.id)  { notify('❌ Carta diferente!'); sfxError(); return; }
    if ((u.lvl||1)>=3)   { notify('⭐ Já no nível máximo!'); sfxError(); return; }
    if (goma<card.cost)  { notify('🍬 Goma insuficiente!'); sfxError(); return; }
    goma-=card.cost; u.lvl=(u.lvl||1)+1;
    applyLevel(u);
    renderUnitEl(idx);
    const cc=cellCenter(col,row);
    spawnFloat(cc.x,cc.y-20,'Nv.'+u.lvl+'! ⬆️', u.lvl===3?'#ff44ff':'#ffd700');
    notify('⬆️ '+card.name+' → Nível '+u.lvl+'!'); sfxUpgrade(); consume(); return;
  }
  // upgrade fábrica
  if (buildings[idx] && card.type==='building') {
    const b=buildings[idx];
    if (b.id!==card.id)  { notify('❌ Carta diferente!'); sfxError(); return; }
    if ((b.lvl||1)>=3)   { notify('⭐ Fábrica no máximo!'); sfxError(); return; }
    if (goma<card.cost)  { notify('🍬 Goma insuficiente!'); sfxError(); return; }
    goma-=card.cost; b.lvl=(b.lvl||1)+1; renderUnitEl(idx);
    const cc=cellCenter(col,row);
    spawnFloat(cc.x,cc.y-20,'Fábrica Nv.'+b.lvl,'#ffd700');
    notify('🏭 Fábrica → Nível '+b.lvl+'! (+'+fabGoma(b.lvl)+'/wave)'); sfxUpgrade(); consume(); return;
  }
  if (units[idx]||buildings[idx]) return;
  if (goma<card.cost) { notify('🍬 Goma insuficiente!'); sfxError(); return; }
  goma-=card.cost;

  if (card.type==='unit') {
    units[idx]={id:card.id,hp:card.hp,maxHp:card.hp,dmg:card.dmg,spd:card.spd,cd:0,color:card.color,lvl:1,col,row,el:null};
    renderUnitEl(idx); sfxPlace(); tip('placed');
  }
  if (card.type==='building') {
    buildings[idx]={id:card.id,lvl:1,col,row,el:null}; fabCount++;
    renderUnitEl(idx); sfxPlace(); notify('🏭 Fábrica nv.1! +'+fabBonus()+'/wave');
  }
  consume();
}
// Cartas de efeito imediato (cura do Rei, +goma): usadas ao clicar na carta, sem precisar de célula vazia.
function useInstantCard() {
  const card=hand[sel]; if(!card) return;
  if (goma<card.cost) { notify('🍬 Goma insuficiente!'); sfxError(); sel=null; return; }
  if (card.type==='heal') {
    if (rei.hp>=rei.maxHp) { notify('👑 O Rei já está com HP cheio!'); sfxError(); sel=null; handDirty=true; return; }
    goma-=card.cost;
    const h=Math.min(30,rei.maxHp-rei.hp); rei.hp+=h;
    spawnFloat(reiCenter().x,reiCenter().y-30,'+'+Math.round(h)+' HP','#ff88cc');
    notify('🧪 Rei curado! +'+Math.round(h)+' HP'); sfxUpgrade();
  } else if (card.type==='goma') {
    if (goma-card.cost>=gomaMax) { notify('🍬 Goma já está cheia!'); sfxError(); sel=null; handDirty=true; return; }
    goma=Math.min(gomaMax,goma-card.cost+6); notify('💧 +6 Gomas!'); sfxPlace();
  }
  consume();
}
function selectCard(i) {
  if (!gameStarted || state!=='prep') return;
  const c=hand[i]; if(!c) return;
  if (goma<c.cost) { sfxError(); return; }
  if (c.type==='heal'||c.type==='goma') { sel=i; useInstantCard(); return; }
  if (c.type==='sacrifice' && !units.some(u=>u)) { notify('Sem tropas para sacrificar!'); sfxError(); return; }
  sel=(sel===i?null:i); handDirty=true; refreshGrid(); hideCellPreview();
}
function consume() { hand.splice(sel,1); sel=null; handDirty=true; checkAutoWave(); }

// ═══════════════════════════════════════════
//  DESCARTE — qualquer carta da mão some e dá +DISCARD_GOMA de goma (independe da carta e do custo)
//  Uso: botão 🗑 (ou tecla D). Com uma carta selecionada, descarta ela na hora;
//  sem seleção, liga o "modo descarte" e cada carta clicada (ou tecla 1–0) é descartada.
//  Funciona até com cartas que o jogador não tem goma para pagar — é justamente quando mais serve.
// ═══════════════════════════════════════════
const DISCARD_GOMA = 3;
function setDiscardMode(on) {
  on = !!on && state==='prep' && hand.length>0;
  if (on!==discardMode) { discardMode=on; handDirty=true; }
  if (on) { sel=null; handDirty=true; refreshGrid(); hideCellPreview(); }
}
function toggleDiscard() {
  if (!gameStarted || state!=='prep' || paused) return;
  if (sel!==null && hand[sel]) { discardCard(sel); return; }
  if (!hand.length) { notify('🗑 Sem cartas para descartar'); sfxError(); return; }
  setDiscardMode(!discardMode);
  if (discardMode) notify('🗑 Clique numa carta para descartar (+'+DISCARD_GOMA+' 🍬)');
}
function discardCard(i) {
  if (!gameStarted || state!=='prep' || paused) return;
  const c=hand[i]; if(!c) return;
  const gain=Math.max(0, Math.min(DISCARD_GOMA, gomaMax-goma));   // nunca passa da goma máxima
  goma+=gain; discardCount++;
  hand.splice(i,1); sel=null; handDirty=true;
  if (!hand.length) discardMode=false;
  const rc=reiCenter();
  spawnFloat(rc.x, rc.y-30, gain>0?'+'+gain+' 🍬':'Goma cheia!', gain>0?'#44ddff':'#ffaa66');
  notify('🗑 '+c.name+' descartada! '+(gain>0?'+'+gain+' 🍬':'(goma já estava cheia)'));
  sfxDiscard(); refreshGrid(); hideCellPreview(); checkAutoWave();
}

// ═══════════════════════════════════════════
//  WAVE
// ═══════════════════════════════════════════
function startWave() {
  if (state!=='prep') return;
  if (autoWaveTimer) { clearInterval(autoWaveTimer); autoWaveTimer=null; }
  document.getElementById('auto-wave').style.display='none';
  state='battle'; tip('wave');
  setDiscardMode(false);
  document.getElementById('btn-wave').disabled=true;
  const pb=document.getElementById('btn-pause'); if(pb) pb.disabled=false;
  const isBoss=wave%5===0;
  if (isBoss) { notify('☠️ WAVE DO VENOM BOSS!'); sfxBoss(); } else sfxWave();
  showBadge(isBoss?'💀 WAVE '+wave+' — BOSS!':'⚔️ WAVE '+wave);
  checkSpecialEvent();
  buildSpawn();
}

// EVENTOS ESPECIAIS DE WAVE
function checkSpecialEvent() {
  if (wave%7===0 && wave>1) showEvent('🌊 HORDA DUPLA — inimigos em dobro!');
  else if (wave%6===0 && wave>1) showEvent('💨 HORDA VELOZ — todos rápidos!');
  else if (wave%4===0 && wave>3) showEvent('💊 CURADOR em campo — mate-o primeiro!');
}

// Nº de inimigos da wave (usado pelo spawn E pela prévia na tela, para nunca divergirem)
function waveCount(w) {
  const B=BALANCE, dm=B.difficulty[difficulty]||B.difficulty.normal;
  const late = dm.late==null ? 1 : dm.late;
  let count = Math.round(B.enemyCount.base + w*B.enemyCount.linear + w*w*B.enemyCount.quad*late);
  count = Math.round(count * dm.count);
  if (w%7===0 && w>1) count = Math.round(count*2);
  return count;
}
function waveEvent(w) {
  if (w%7===0 && w>1) return '🌊 Horda dupla';
  if (w%6===0 && w>1) return '💨 Horda veloz';
  if (w%4===0 && w>3) return '💊 Curador em campo';
  return '';
}
function wavePreviewText() {
  const tags=[]; if (wave%5===0) tags.push('👹 Boss'); const ev=waveEvent(wave); if (ev) tags.push(ev);
  return 'Wave '+wave+' · '+waveCount(wave)+' inimigos'+(tags.length?' · '+tags.join(' · '):'');
}

function buildSpawn() {
  computeCellCenters();   // layout pode ter mudado desde a última wave
  const B=BALANCE, dm=B.difficulty[difficulty]||B.difficulty.normal;
  // Nº de inimigos (com os valores atuais: wave 1→5 | 5→18 | 10→46 | 20→139 no Normal)
  const count = waveCount(wave);
  const isAllFast     = wave%6===0 && wave>1;
  const forceHealer   = wave%4===0 && wave>3;

  totalWave=count; spawnQueue=[]; spawnClock=0;
  const gr=gridBox(), ar={ left:0, width:STAGE_W, height:STAGE_H };
  const gridTop=gr.top, gridH=gr.height;

  for (let i=0; i<count; i++) {
    const r=Math.random();
    const isBoss   = wave%5===0 && i===0;
    const isHealer = forceHealer && i===1 && !isBoss;
    // Corredor: wave 6+, 12% de chance — ignora tropas, vai direto no Rei
    const isRunner  = !isBoss && !isHealer && r>0.55 && r<=0.67 && wave>=6;
    // Armado: wave 8+, 10% de chance — 1 hit quebra o escudo, depois morre normal
    const isArmored = !isBoss && !isHealer && !isRunner && r>0.45 && r<=0.55 && wave>=8;
    const isTank   = !isBoss && !isHealer && !isRunner && !isArmored && r<0.22 && wave>1 && !isAllFast;
    const isFast   = !isBoss && !isHealer && !isRunner && !isArmored && !isTank && (isAllFast||(r>0.72&&wave>=3));

    const lateHp = dm.late==null ? 1 : dm.late;
    const baseHp = (B.hp.base + wave*B.hp.perWave + wave*wave*B.hp.quad*lateHp) * dm.hp;
    const dmgType = isTank?B.dmg.tank : isFast?B.dmg.fast : isHealer?B.dmg.healer : isRunner?B.dmg.runner : isArmored?B.dmg.armored : B.dmg.normal;
    const dmgBase = ((dmgType*dm.dmg)|0) + Math.floor(wave*B.dmg.perWave);
    const hp = isBoss?baseHp*B.hp.boss : isTank?baseHp*B.hp.tank : isRunner?baseHp*B.hp.runner : baseHp;

    const S=B.speed;
    const speed = (isBoss?S.boss : isTank?S.tank : isFast?(S.fastBase+wave*S.fastPerWave) : isHealer?S.healer
                  : isRunner?(S.runnerBase+wave*S.runnerPerWave) : isArmored?(S.normal*S.armoredMult+wave*S.perWave)
                  : (S.normal+wave*S.perWave)) * dm.spd;

    spawnQueue.push({
      delay:   i*B.spawnIntervalMs, spawned:false,
      x:       (wave>=10 && i%5===0) ? (gr.left-ar.left + Math.random()*gr.width) : ar.width+60+Math.random()*100,
      y:       (wave>=10 && i%5===0) ? (i%10===0 ? -40 : ar.height+40) : gridTop+15+Math.random()*(gridH-30),
      hp, maxHp:hp, speed,
      dmg:     isBoss?Math.round(dmgBase*B.dmg.bossMult):dmgBase,
      healPower: isHealer?Math.round(8+wave*0.8):0,
      attackCd: 0,
      type:    isBoss?'boss':isTank?'tank':isFast?'fast':isHealer?'healer':isRunner?'runner':isArmored?'armored':'normal',
      shielded: isArmored,
      rageMode: false,
    });
  }
}

// ═══════════════════════════════════════════
//  UPGRADES PÓS-WAVE
// ═══════════════════════════════════════════
function showUpgrades() {
  checkAchievements(); sfxWin();
  const pb=document.getElementById('btn-pause'); if(pb) pb.disabled=true;
  const pool = [
    {icon:'⚔️',title:'Goma Afiada',      desc:'+8 dano para todas as tropas',      fn:()=>upgrades.dmg+=8},
    {icon:'⚡',title:'Chiclete Turbo',    desc:'Tropas atacam +25% mais rápido',    fn:()=>upgrades.spd+=1},
    {icon:'💧',title:'+6 Goma/wave',      desc:'Mais goma ao fim de cada wave',     fn:()=>upgrades.gomaWave+=6},
    {icon:'🏭',title:'Fábrica ++',        desc:'Cada fábrica sobe 1 nível',
      ok:()=>buildings.some(b=>b&&b.id==='fab'&&(b.lvl||1)<3),
      fn:()=>{buildings.forEach(b=>{if(b&&b.id==='fab'){b.lvl=Math.min(3,(b.lvl||1)+1);renderUnitEl(b.row*5+b.col);}});notify('🏭 Fábricas turbinadas!');}},
    {icon:'❤️',title:'Rei Blindado',      desc:'+35 HP máximo para o Rei',          fn:()=>{rei.maxHp+=35;rei.hp=Math.min(rei.hp+35,rei.maxHp);}},
    {icon:'🔄',title:'Regen de Chiclete', desc:'Rei recupera 2 HP/s',              fn:()=>upgrades.regen+=2},
    {icon:'🃏',title:'Mais Cartas',       desc:'Ganhe 4 cartas agora',              ok:()=>hand.length<=7, fn:()=>{for(let i=0;i<4;i++)drawCard();}},
    {icon:'💥',title:'Explosão de Goma',  desc:'+14 dano para todas as tropas',     fn:()=>upgrades.dmg+=14},
    {icon:'🫧',title:'Reserva de Goma',   desc:'Goma máxima +12',                   fn:()=>gomaMax+=12},
    {icon:'✌️',title:'Sinergias x2',      desc:'Bônus de sinergias dobrado',        fn:()=>upgrades.synx2=true},
    {icon:'🍬',title:'Goma Inicial',      desc:'+4 goma no início de cada preparo', fn:()=>upgrades.gomaWave+=4},
    {icon:'🌟',title:'Upgrade Aleatório', desc:'Sobe 1 nível em uma tropa aleatória em campo',
      ok:()=>units.some(u=>u&&(u.lvl||1)<3),
      fn:()=>{ const u=levelUpRandomUnit(); notify(u?'🌟 '+u.id+' subiu para Nv.'+u.lvl+'!':'Nenhuma tropa para upar!'); }},
  ];
  const avail=pool.filter(o=>!o.ok||o.ok());
  for (let i=avail.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [avail[i],avail[j]]=[avail[j],avail[i]]; }
  const opts=avail.slice(0,3);
  const wrap=document.getElementById('ov-up-cards'); wrap.innerHTML='';
  opts.forEach(u => {
    const d=document.createElement('div'); d.className='upc';
    d.innerHTML='<div class="upi">'+u.icon+'</div><div class="upt">'+u.title+'</div><div class="upd">'+u.desc+'</div>';
    d.onclick=()=>{
      u.fn(); refreshAllUnits(); sfxUpgrade();
      document.getElementById('ov-upgrade').style.display='none';
      const dmG=BALANCE.difficulty[difficulty]||BALANCE.difficulty.normal;
      const earned=Math.min(6+fabBonus()+upgrades.gomaWave+(dmG.goma||0), gomaMax);
      goma=Math.min(gomaMax,goma+earned);
      notify('+'+earned+' goma! 🍬');
      for (let i=0;i<3;i++) drawCard();
      state='prep'; document.getElementById('btn-wave').disabled=false;
      handDirty=true; checkAutoWave(); tip('discard');
    };
    wrap.appendChild(d);
  });
  document.getElementById('ov-upgrade').style.display='flex';
}

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════
function dist(ax,ay,bx,by) { return Math.hypot(bx-ax,by-ay); }
function toward(o,tx,ty,spd) {
  const d=dist(o.x,o.y,tx,ty); if(d<1) return;
  o.x+=(tx-o.x)/d*spd; o.y+=(ty-o.y)/d*spd;
}
function nearestEnemy(x,y) {
  let best=null,bd=Infinity;
  enemies.forEach(e=>{ const d=dist(x,y,e.x,e.y); if(d<bd){bd=d;best=e;} });
  return best;
}
function synergy() {
  const c=units.filter(u=>u).length;
  const b=c>=12?16:c>=8?10:c>=5?6:c>=3?3:0;
  return upgrades.synx2?b*2:b;
}

// ═══════════════════════════════════════════
//  LOOP PRINCIPAL
// ═══════════════════════════════════════════
function loop(ts) {
  const rawDt   = Math.min(ts-lastTime, 50); lastTime=ts;
  const dt      = paused ? 0 : rawDt*gameSpeed;
  const physSpd = paused ? 0 : (rawDt/16.667)*gameSpeed;

  if (state==='battle' && dt>0) {
    const rp=reiCenter(), syn=synergy();

    // SPAWN
    spawnClock+=dt;
    spawnQueue.forEach(q=>{
      if (!q.spawned && spawnClock>=q.delay) {
        q.spawned=true;
        const e={x:q.x,y:q.y,hp:q.hp,maxHp:q.maxHp,speed:q.speed,dmg:q.dmg,
          healPower:q.healPower||0,healCd:0,attackCd:0,type:q.type,rageMode:false,shielded:q.shielded||false};
        createEnemyEl(e); enemies.push(e);
      }
    });
    spawnQueue=spawnQueue.filter(q=>!q.spawned);

    // COMBO
    if (comboLeft>0) { comboLeft-=dt; if (comboLeft<=0) { comboLeft=0; comboCount=0; } }

    // REGEN REI
    regenAcc+=dt;
    if (regenAcc>=1000) { if(upgrades.regen>0) rei.hp=Math.min(rei.maxHp,rei.hp+upgrades.regen); regenAcc=0; }

    // REI ATACA
    rei.cd-=dt;
    if (enemies.length && rei.cd<=0) {
      const t=nearestEnemy(rp.x,rp.y);
      if (t) {
        const p={x:rp.x,y:rp.y,tgt:t,dmg:7+upgrades.dmg,color:'#ff88cc',spd:7,r:4};
        createProjEl(p); projs.push(p);
        rei.cd=850; reiEl.classList.add('atk');
        setTimeout(()=>reiEl.classList.remove('atk'),120);
      }
    }

    // TROPAS
    units.forEach(u=>{
      if (!u) return;
      u.cd=(u.cd||0)-dt;
      if (u.cd<=0 && enemies.length) {
        const cc=cellCenter(u.col,u.row);
        if (u.id==='healer') {
          units.forEach((ally,aidx)=>{
            if (!ally||ally===u) return;
            const acc=cellCenter(ally.col,ally.row);
            if (dist(cc.x,cc.y,acc.x,acc.y)<180 && ally.hp<ally.maxHp) {
              const h=Math.min(20,ally.maxHp-ally.hp); ally.hp+=h;
              spawnFloat(acc.x,acc.y-16,'+'+h,'#44ff88'); sfxHealer();
              const hpEl=getCellEl(aidx).querySelector('.hp-bar');
              if (hpEl){const pct=ally.hp/ally.maxHp;hpEl.style.width=pct*100+'%';hpEl.style.background=pct>.5?'#44cc88':pct>.25?'#ffcc00':'#ff2244';}
            }
          });
          u.cd=unitCd(u);
        } else if (u.id==='mascador') {
          // Passiva: regen +3 HP nas tropas vizinhas (célula adjacente)
          const adjacents=[-1,1,-COLS,COLS,-COLS-1,-COLS+1,COLS-1,COLS+1];
          const myIdx=u.row*COLS+u.col;
          let totalRegen=0;
          adjacents.forEach(delta=>{
            const ni=myIdx+delta; if(ni<0||ni>=25) return;
            const ally=units[ni]; if(!ally||ally===u||ally.hp>=ally.maxHp) return;
            const h=Math.min(3,ally.maxHp-ally.hp); ally.hp+=h; totalRegen+=h;
            const hpEl=getCellEl(ni).querySelector('.hp-bar');
            if(hpEl){const pct=ally.hp/ally.maxHp;hpEl.style.width=pct*100+'%';hpEl.style.background=pct>.5?'#44cc88':pct>.25?'#ffcc00':'#ff2244';}
          });
          // float único por ciclo, só se curou alguém
          if(totalRegen>0){const cc2=cellCenter(u.col,u.row);spawnFloat(cc2.x,cc2.y-18,'+'+totalRegen+'💚','#aaffcc');}
          const t=nearestEnemy(cellCenter(u.col,u.row).x,cellCenter(u.col,u.row).y);
          if(t){
            const dmg=u.dmg+upgrades.dmg+syn;
            const p={x:cellCenter(u.col,u.row).x,y:cellCenter(u.col,u.row).y,tgt:t,dmg,color:u.color,spd:5,r:3};
            createProjEl(p); projs.push(p);
          }
          u.cd=unitCd(u);
        } else {
          const t=nearestEnemy(cc.x,cc.y);
          if (t) {
            const isCrit = u.id==='atirador' && Math.random()<0.20;
            const baseDmg=u.dmg+upgrades.dmg+syn;
            const dmg = isCrit ? baseDmg*2 : baseDmg;
            const p={x:cc.x,y:cc.y,tgt:t,dmg,color:isCrit?'#ffdd00':u.color,spd:5,r:isCrit?5:3,isCrit};
            createProjEl(p); projs.push(p);
            if (u.id==='sticky') stickyPatches.push({x:t.x,y:t.y,life:5000,r:32,el:null});
            u.cd=unitCd(u);
          }
        }
      }
    });

    // INIMIGOS
    const taunter = units.find(u=>u&&u.id==='tanque') || null;   // 1x por frame, não por inimigo
    enemies.forEach(e=>{
      // RAGE MODE do boss
      if (e.type==='boss' && !e.rageMode && e.hp/e.maxHp<0.4) {
        e.rageMode=true; e.speed*=1.7; e.dmg=Math.round(e.dmg*1.5);
        e.bodyEl.classList.add('rage'); notify('☠️ VENOM EM FÚRIA!'); sfxBoss();
      }
      // curador inimigo
      if (e.type==='healer' && !e._dead) {
        e.healCd=(e.healCd||0)-dt;
        if (e.healCd<=0) {
          enemies.forEach(ally=>{
            if (ally===e||ally.type==='healer') return;
            if (dist(e.x,e.y,ally.x,ally.y)<90) {
              const h=Math.min(e.healPower||10,ally.maxHp-ally.hp);
              if (h>0){ally.hp+=h; spawnFloat(ally.x,ally.y-12,'+'+Math.round(h),'#44ff88');}
            }
          });
          e.healCd=1800;
        }
      }
      const onSticky=stickyPatches.some(p=>dist(e.x,e.y,p.x,p.y)<p.r);
      const moveSpd=e.speed*(onSticky?.4:1)*physSpd;
      let tgt=null,minD=Infinity;
      // Runner ignora tropas, fast ignora tropas; taunt: tanque é priorizado
      if (e.type!=='fast' && e.type!=='runner') {
        if (taunter) {
          const cc=cellCenter(taunter.col,taunter.row);
          tgt={u:taunter,cc}; minD=dist(e.x,e.y,cc.x,cc.y);
        } else {
          units.forEach(u=>{if(!u)return;const cc=cellCenter(u.col,u.row),d=dist(e.x,e.y,cc.x,cc.y);if(d<minD){minD=d;tgt={u,cc};}});
        }
      }
      if (tgt && minD<260) {
        toward(e,tgt.cc.x,tgt.cc.y,moveSpd); e.attackCd-=dt;
        if (minD<28 && e.attackCd<=0) {
          tgt.u.hp-=e.dmg; spawnFloat(tgt.cc.x,tgt.cc.y-16,'-'+e.dmg,'#ff4444'); sfxHit();
          if (tgt.u.el){tgt.u.el.classList.add('hit-flash');setTimeout(()=>tgt.u.el&&tgt.u.el.classList.remove('hit-flash'),200);}
          e.attackCd=e.type==='fast'?300:e.type==='boss'?420:520;
          const tidx=tgt.u.row*COLS+tgt.u.col, hp=Math.max(0,tgt.u.hp/tgt.u.maxHp);
          const hpEl=getCellEl(tidx).querySelector('.hp-bar');
          if (hpEl){hpEl.style.width=hp*100+'%';hpEl.style.background=hp>.5?'#44cc88':hp>.25?'#ffcc00':'#ff2244';}
        }
      } else {
        toward(e,rp.x,rp.y,moveSpd); e.attackCd-=dt;
        if (dist(e.x,e.y,rp.x,rp.y)<52 && e.attackCd<=0) {
          rei.hp-=e.dmg; spawnFloat(rp.x,rp.y-28,'-'+e.dmg,'#ff2244'); sfxHit(); shakeScreen();
          reiEl.classList.add('hit'); setTimeout(()=>reiEl.classList.remove('hit'),250);
          e.attackCd=e.type==='fast'?300:e.type==='boss'?420:520;
        }
      }
      e.el.style.left=e.x+'px'; e.el.style.top=e.y+'px';
      e.hpEl.style.width=Math.max(0,e.hp/e.maxHp*100)+'%';
      if (e.bossLabel) e.bossLabel.innerText='☠️ VENOM '+Math.ceil(e.hp);
    });

    // PROJÉTEIS
    projs.forEach(p=>{
      // Guarda referência local e valida antes de qualquer acesso
      const tgt=p.tgt;
      if (!tgt || tgt._dying || tgt.hp===undefined) { p.hit=true; return; }
      toward(p,tgt.x,tgt.y,p.spd*physSpd);
      if (p.el) { p.el.style.left=p.x+'px'; p.el.style.top=p.y+'px'; }
      if (dist(p.x,p.y,tgt.x,tgt.y)<14) {
        // Escudo: absorve hit sem dano
        if (tgt.shielded) {
          tgt.shielded=false;
          if (tgt.bodyEl) { tgt.bodyEl.style.opacity='0.75'; tgt.bodyEl.innerText='💀'; tgt.bodyEl.className='enemy-body normal'; }
          spawnFloat(tgt.x,tgt.y-20,'🛡 Escudo quebrado!','#4488ff');
          spawnParticles(tgt.x,tgt.y,'#4488ff',5);
          p.hit=true; return;
        }
        tgt.hp-=p.dmg;
        if (p.isCrit) {
          const cel=document.createElement('div'); cel.className='crit-float';
          cel.style.left=tgt.x+'px'; cel.style.top=(tgt.y-20)+'px';
          cel.textContent='★ CRÍTICO! '+p.dmg;
          arena.appendChild(cel); setTimeout(()=>cel.remove(),700);
        }
        if (tgt.hp<=0 && !tgt._dying) {
          tgt._dying=true;
          const type=tgt.type||'normal';
          const pColor=type==='boss'?'#aa44ff':type==='tank'?'#ff6600':type==='fast'?'#44ff88':type==='runner'?'#ff44cc':'#ff2244';
          spawnParticles(tgt.x,tgt.y,pColor,type==='boss'?12:6);
          registerKill();
          killsByType[type]=(killsByType[type]||0)+1;
          if (type==='boss') {
            for (let i=0;i<3;i++) {
              const ne={x:tgt.x+(Math.random()-.5)*40,y:tgt.y+(Math.random()-.5)*30,
                hp:tgt.maxHp*.18,maxHp:tgt.maxHp*.18,speed:tgt.speed*1.5,
                dmg:Math.ceil(tgt.dmg*.65),healPower:0,healCd:0,attackCd:0,type:'normal',rageMode:false,shielded:false};
              createEnemyEl(ne); enemies.push(ne);
            }
            notify('☠️ Venom se dividiu em 3!');
          }
          if (tgt.el) { tgt.el.classList.add('dying'); setTimeout(()=>{ if(tgt.el) tgt.el.remove(); },320); }
        }
        p.hit=true;
      }
    });

    // STICKY
    stickyPatches.forEach(p=>{
      p.life-=dt;
      if (!p.el&&p.life>0){const el=document.createElement('div');el.className='sticky-el';el.style.left=p.x+'px';el.style.top=p.y+'px';el.style.width=p.r*2+'px';el.style.height=p.r*1.2+'px';arena.appendChild(el);p.el=el;}
      if (p.el) p.el.style.opacity=Math.max(0,p.life/5000)*.5;
    });

    // FLOATS
    floats.forEach(f=>{ f.y+=f.vy*physSpd; f.life-=.02; f.el.style.top=f.y+'px'; f.el.style.opacity=f.life; });

    // INDICADORES DE ALVO (a cada 500ms)
    targetUpdateTimer-=dt;
    if (targetUpdateTimer<=0) { updateTargetIndicators(); targetUpdateTimer=500; }

    // LIMPEZA
    projs.filter(p=>p.hit).forEach(p=>{if(p.el)p.el.remove();}); projs=projs.filter(p=>!p.hit);
    enemies.filter(e=>e.hp<=0&&!e._dying).forEach(e=>{e._dying=true;setTimeout(()=>{if(e.el)e.el.remove();},320);});
    enemies=enemies.filter(e=>e.hp>0);
    units=units.map((u,idx)=>{
      if (u&&u.hp<=0){if(u.el&&!u._dying){u._dying=true;u.el.classList.add('dying');setTimeout(()=>renderUnitEl(idx),360);}return null;}
      return u;
    });
    floats.filter(f=>f.life<=0).forEach(f=>{if(f.el)f.el.remove();}); floats=floats.filter(f=>f.life>0);
    stickyPatches.filter(p=>p.life<=0).forEach(p=>{if(p.el)p.el.remove();}); stickyPatches=stickyPatches.filter(p=>p.life>0);

    // FIM DA WAVE
    if (spawnQueue.length===0 && enemies.length===0) {
      targetedCells.forEach(i=>{const c=getCellEl(i);if(c)c.classList.remove('targeted');}); targetedCells.clear();
      // Rei comemora
      goma = Math.min(gomaMax, goma + Math.min(wave, 8));
      spawnFloat(reiCenter().x, reiCenter().y - 40, '+'+Math.min(wave,8)+' goma bônus!', '#44ddff');
      reiEl.classList.add('celebrate');
      setTimeout(()=>reiEl.classList.remove('celebrate'), 1600);
      comboCount=0; comboLeft=0;
      wave++;
      if (!victoryDone && wave-1 === victoryWaveNow()) { state='victory'; showVictory(); }
      else if (wave > 2 && wave % 3 === 0) { state='shop'; showShop(); }
      else { state='upgrade'; showUpgrades(); }
    }
    // GAME OVER
    if (rei.hp<=0 && state==='battle') {
      rei.hp=0; sfxBoss(); state='dead';
      setTimeout(showPostGame, 800);   // recorde é salvo/comparado só em showPostGame
      const pb=document.getElementById('btn-pause'); if(pb) pb.disabled=true;
    }
  }

  updateHUD(); renderHand();
  requestAnimationFrame(loop);
}


// ═══════════════════════════════════════════
//  AVISO DE ORIENTAÇÃO
//  O palco escala sozinho (fitStage), então não precisa mais pedir zoom 100%.
//  Só sugere girar o celular quando está em pé (a arena fica pequena demais).
// ═══════════════════════════════════════════
let orientDismissed = false;
let orientPaused    = false;
const portraitMQ = window.matchMedia('(orientation: portrait) and (max-width: 700px)');

function checkOrientation() {
  if (orientDismissed) return;
  const ov = document.getElementById('ov-zoom'); if (!ov) return;
  if (portraitMQ.matches) {
    ov.style.display = 'flex';
    if (!orientPaused && state === 'battle' && !paused) {
      paused = true; orientPaused = true;
      const btn = document.getElementById('btn-pause'); if (btn) btn.textContent = '▶ Resume';
    }
  } else {
    ov.style.display = 'none';
    releaseOrientationPause();
  }
}
function releaseOrientationPause() {
  if (!orientPaused) return;
  paused = false; orientPaused = false;
  const btn = document.getElementById('btn-pause'); if (btn) btn.textContent = '⏸ Pausa';
}
function dismissOrientation() {
  orientDismissed = true;
  document.getElementById('ov-zoom').style.display = 'none';
  releaseOrientationPause();
}
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', checkOrientation);
checkOrientation();


// ═══════════════════════════════════════════
//  CONQUISTAS
// ═══════════════════════════════════════════
// ACHIEVEMENTS moved to top
let unlockedAchievements = new Set((()=>{ const a=lsJSON('chicletao_ach',[]); return Array.isArray(a)?a:[]; })());

function checkAchievements() {
  ACHIEVEMENTS.forEach(a => {
    if (unlockedAchievements.has(a.id)) return;
    if (a.check()) {
      unlockedAchievements.add(a.id);
      lsSet('chicletao_ach', JSON.stringify([...unlockedAchievements]));
      showAchievementToast(a);
    }
  });
}

function showAchievementToast(a) {
  const el = document.createElement('div');
  el.className = 'ach-toast';
  el.innerHTML = '<span class="ach-icon">'+a.icon+'</span>'
    +'<div><div class="ach-title">🏅 Conquista desbloqueada!</div>'
    +'<div class="ach-name">'+a.title+'</div>'
    +'<div class="ach-desc">'+a.desc+'</div></div>';
  document.body.appendChild(el);
  setTimeout(()=>el.classList.add('show'), 50);
  setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=>el.remove(), 400); }, 3500);
  sfxWin();
}

function renderAchievements() {
  const wrap = document.getElementById('ach-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  ACHIEVEMENTS.forEach(a => {
    const unlocked = unlockedAchievements.has(a.id);
    const el = document.createElement('div');
    el.className = 'ach-item'+(unlocked?'':' ach-locked');
    el.innerHTML = '<span class="ach-icon-sm">'+a.icon+'</span>'
      +'<div><div class="ach-item-title">'+a.title+'</div>'
      +'<div class="ach-item-desc">'+a.desc+'</div></div>'
      +(unlocked?'<span class="ach-check">✅</span>':'<span class="ach-check" style="opacity:.3">🔒</span>');
    wrap.appendChild(el);
  });
}

// ═══════════════════════════════════════════
//  LOJA ENTRE WAVES
// ═══════════════════════════════════════════
// SHOP_ITEMS moved to top
function showShop() {
  const ov = document.getElementById('ov-shop');
  const wrap = document.getElementById('shop-items');
  if (!ov||!wrap) return;
  wrap.innerHTML = '';
  const sg=document.getElementById('shop-goma'); if(sg) sg.textContent=goma;
  SHOP_ITEMS.forEach(item => {
    const canBuy = goma >= item.cost;
    const el = document.createElement('div');
    el.className = 'shop-item'+(canBuy?'':' shop-cant');
    el.innerHTML = '<span class="shop-icon">'+item.icon+'</span>'
      +'<div class="shop-info"><div class="shop-name">'+item.name+'</div>'
      +'<div class="shop-desc">'+item.desc+'</div></div>'
      +'<button class="shop-buy'+(canBuy?'':' shop-buy-off')+'" '+(canBuy?'':'disabled')+'>🍬'+item.cost+'</button>';
    if (canBuy) {
      el.querySelector('.shop-buy').addEventListener('click', ()=>{
        goma -= item.cost; item.fn(); refreshAllUnits();
        const sg=document.getElementById('shop-goma'); if(sg) sg.textContent=goma;
        showShop(); // refresh
      });
    }
    wrap.appendChild(el);
  });
  ov.style.display = 'flex';
}

function closeShop() {
  document.getElementById('ov-shop').style.display = 'none';
  state='upgrade'; showUpgrades();
}

// ═══════════════════════════════════════════
//  VITÓRIA — derrotar a wave BALANCE.victoryWave[dificuldade]; depois dá para continuar no infinito
// ═══════════════════════════════════════════
function victoryWaveNow() { return BALANCE.victoryWave[difficulty] || BALANCE.victoryWave.normal; }
function winsKey() { return 'chicletao_wins_'+difficulty; }
function showVictory() {
  victoryDone=true; victoryWon=true;
  lsSet(winsKey(), (parseInt(lsGet(winsKey(),'0'),10)||0)+1);
  const hs=getHS(); if (wave-1>hs) setHS(wave-1);   // vitória conta como recorde de waves
  if (score>getHSScore()) lsSet('chicletao_hs_score',score);
  checkAchievements(); sfxWin(); setTimeout(sfxWin,400);
  const pb=document.getElementById('btn-pause'); if(pb) pb.disabled=true;
  const set=(id,v)=>{ const e=document.getElementById(id); if(e) e.textContent=v; };
  set('vic-wave', victoryWaveNow()); set('vic-score', score.toLocaleString('pt-BR')); set('vic-kills', totalKills);
  set('vic-diff', difficulty); set('vic-hp', Math.max(0,Math.ceil(rei.hp))+'/'+rei.maxHp);
  set('vic-wins', lsGet(winsKey(),'1'));
  const ov=document.getElementById('ov-victory'); if(ov) ov.style.display='flex';
}
// "Continuar": segue para o fluxo normal pós-wave (loja/power-up) no modo infinito
function continueAfterVictory() {
  const ov=document.getElementById('ov-victory'); if(ov) ov.style.display='none';
  if (wave > 2 && wave % 3 === 0) { state='shop'; showShop(); }
  else { state='upgrade'; showUpgrades(); }
}

// ═══════════════════════════════════════════
//  HISTÓRICO DE RUNS
// ═══════════════════════════════════════════
function saveRun() {
  const runs = lsJSON('chicletao_runs',[]); if(!Array.isArray(runs)) return;
  runs.unshift({ wave, score, kills:totalKills, diff:difficulty, won:victoryWon, date:new Date().toLocaleDateString('pt-BR') });
  lsSet('chicletao_runs', JSON.stringify(runs.slice(0,5)));
}
function renderHistory() {
  const wrap = document.getElementById('run-history');
  if (!wrap) return;
  let runs = lsJSON('chicletao_runs',[]); if(!Array.isArray(runs)) runs=[];
  if (!runs.length) { wrap.innerHTML='<p style="color:#666;font-size:12px">Nenhuma partida ainda</p>'; return; }
  wrap.innerHTML = runs.map((r,i)=>{
    const diff=['easy','normal','hard'].includes(r.diff)?r.diff:'normal';
    return '<div class="run-row">'
      +'<span class="run-num">#'+(i+1)+'</span>'
      +'<span>'+(r.won?'🏆 ':'')+'Wave <b>'+(Number(r.wave)||0)+'</b></span>'
      +'<span><b>'+(Number(r.score)||0).toLocaleString('pt-BR')+'</b> pts</span>'
      +'<span>'+(Number(r.kills)||0)+' kills</span>'
      +'<span class="run-diff run-'+diff+'">'+diff+'</span>'
      +'<span class="run-date">'+esc(r.date)+'</span>'
      +'</div>';
  }).join('');
}

// ═══════════════════════════════════════════
//  STATS PÓS-PARTIDA
// ═══════════════════════════════════════════
// killsByType moved to top

function showPostGame() {
  saveRun();
  const hs=getHS(), newHS=wave>hs; if(newHS) setHS(wave);
  if(score>getHSScore()) lsSet('chicletao_hs_score',score);

  const h1=document.querySelector('#ov-postGame h1'); if(h1) h1.textContent = victoryWon ? '🏆 Venceu! Mas o Rei caiu no infinito' : '💀 Derrota!';
  document.getElementById('pg-wave').textContent    = wave;
  document.getElementById('pg-score').textContent   = score.toLocaleString('pt-BR');
  document.getElementById('pg-kills').textContent   = totalKills;
  document.getElementById('pg-hs').textContent      = newHS ? '🏆 Novo recorde de waves!' : 'Recorde: Wave '+hs;
  const pgd=document.getElementById('pg-diff'); if(pgd){pgd.textContent=difficulty; pgd.className='pg-val pg-diff pg-'+difficulty;}
  // kills por tipo
  const kl = document.getElementById('pg-kills-breakdown');
  if (kl) kl.innerHTML = Object.entries(killsByType)
    .filter(([,v])=>v>0)
    .map(([k,v])=>'<span class="pg-ktype">'+({'normal':'💀','tank':'🛡️','fast':'💨','boss':'👹','healer':'💊','runner':'🏃','armored':'🪖'}[k]||'❓')+' '+k+': <b>'+v+'</b></span>')
    .join('');

  renderHistory();
  renderAchievements();
  document.getElementById('ov-postGame').style.display='flex';
}

function setDifficulty(d) {
  if (!['easy','normal','hard'].includes(d)) d='normal';
  difficulty = d; lsSet('chicletao_diff', d);
  ['easy','normal','hard'].forEach(v=>{
    const b=document.getElementById('diff-'+v);
    if(b) b.classList.toggle('diff-active', v===d);
  });
}

setDifficulty(lsGet('chicletao_diff','normal'));
computeCellCenters();
requestAnimationFrame(loop);