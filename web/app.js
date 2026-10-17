import { loadData } from '../engine/data.js';
import { Game } from '../engine/engine.js';
const $ = (s) => document.querySelector(s);

/* ==================== 数字格式 ====================
   原版 main.js.src:6007 `ZV(e, defaultNumberFormat, bigNumberFormat)`：
     e > 9999999 → bigFormat(round(e/1e6*10)/10) + "M"
     e > 99999   → bigFormat(round(e/1e3*10)/10) + "K"
     否则        → defaultFormat.format(e)（千分位）
   三个 Intl.NumberFormat 见 main.js.src:64208：
     defaultNumberFormat = new Intl.NumberFormat()
     bigNumberFormat     = { minimumFractionDigits: 1 }
     twoNumberFormat     = { minimumFractionDigits: 2, maximumFractionDigits: 2 }
   原版调用点全部先 Math.floor（源码 63050 等），这里保持一致。 */
const NF = new Intl.NumberFormat();
const NF_BIG = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1 });
const NF_TWO = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n) => {
  n = Number(n);
  if (!Number.isFinite(n)) return '0';
  n = Math.floor(n);
  return n > 9999999 ? NF_BIG.format(Math.round((n / 1e6) * 10) / 10) + 'M'
    : n > 99999 ? NF_BIG.format(Math.round((n / 1e3) * 10) / 10) + 'K'
      : NF.format(n);
};
const fmt2 = (n) => NF_TWO.format(Math.round(100 * Number(n)) / 100);
// 原版 zeroNumberFormat（main.js.src:64216）：无小数（缺口数量用它显示）
const NF0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
// 原版 fU（main.js.src:6118-6142）：秒 → "12s" / "2m 23s" / "1h 5m" / "3d 4h"；≤0/NaN/∞ → ∞
const fmtEta = (sec) => {
  if (sec === Infinity || Number.isNaN(sec) || sec <= 0) return '∞';
  if (sec < 60) return `${Math.ceil(sec)}s`;
  if (sec < 3600) { const m = Math.floor(sec / 60), s = Math.ceil(sec % 60); return s > 0 ? `${m}m ${s}s` : `${m}m`; }
  if (sec < 86400) { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return m > 0 ? `${h}h ${m}m` : `${h}h`; }
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
};
window.__fmt = fmt; window.__fmt2 = fmt2; window.__fmtEta = fmtEta;
// 顶栏资源条的每秒速率：<10 留 2 位、10~99 留 1 位、≥100 取整（≥1000 走 fmt 的 K/M 口径）；0 就显示 0
const fmtRate = (n) => {
  const a = Math.abs(Number(n));
  if (!Number.isFinite(a) || a < 0.005) return '0';
  const body = a >= 1000 ? fmt(a) : a >= 100 ? String(Math.round(a)) : a >= 10 ? a.toFixed(1) : a.toFixed(2);
  return (n > 0 ? '+' : '-') + body;
};

const resName = (id) => game.data.name('res_', id);
// i18n 查表（对应原版 pe.v：缺 key 返回 "UNDEFINED_"+key，1:1 保留）
const T = (k) => (game.data.names[k] !== undefined ? game.data.names[k] : 'UNDEFINED_' + k);

/* 原版主导航（main.js.src:71463 sa.render）：按解锁条件逐个出现，角标见下 */
const TABS = [
  { id: 'build', k: 'build' },
  { id: 'tech', k: 'research', badge: () => visibleTechs().length },
  { id: 'pop', k: 'population', badge: () => game.populationTotal('unemployed') },
  { id: 'magic', k: 'magic', badge: () => visiblePrayers().length },
  { id: 'army', k: 'army' },
  { id: 'dip', k: 'diplomacy' },
  { id: 'market', k: 'bui_marketplace' },
];
let tab = 'build';
let buildTab = 1;          // 建造页子页：1 城市 / 2 定居点 / 3 深渊
let techTab = 'research';  // 研究页子页：research 待研究 / completed 已完成
// 军队页子页（原版分包 918：军队 / 探索 / 间谍（需间谍科技）/ 攻击 / 驻军，带计数）
let armyTab = 'army';
let queueOpen = false;
let showDifficulty = false;   // 原版 MainStore.showDifficulty（难度选择面板，不可关闭）
// 资源面板：收起=小字网格（名称+数量/上限），展开=逐行「名称/数量上限/速率」；状态记在 localStorage
let resPanelOpen = (() => { try { return JSON.parse(localStorage.getItem('resPanelOpen')) === true; } catch { return false; } })();
let game;
let lastFrame = performance.now();
let lastViewRender = 0;
const selectedLegacies = new Set();
// 原版 QueueStore.strictOrder（localStorage key "queueStrictOrder"，默认 true）
let strictOrder = (() => { try { const v = JSON.parse(localStorage.getItem('queueStrictOrder')); return v === null ? true : !!v; } catch { return true; } })();

/* ---------- 启动 ---------- */
const data = await loadData('../data/');
let save = null;
try { const raw = localStorage.getItem('theresmore-replica'); if (raw) save = JSON.parse(raw); } catch {}
// 随机种子：支持 ?seed=NNN 固定（自动化测试可复现），默认按时间取种
const seedParam = Number(new URLSearchParams(location.search).get('seed'));
try { game = new Game({ data, save, seed: Number.isFinite(seedParam) && seedParam > 0 ? seedParam : (Date.now() % 100000) + 1 }); }
catch (e) { window.__bootErr = (e.stack || e.message); throw e; }
window.__game = game; // 便于自动化测试/调试
/* 原版离线机制（main.js.src:64764 _initOfflineProgress）：
     离开页面时 beforeunload 写 localStorage['last'] = Date.now()；
     下次打开时把 (now - last) 的**秒数**加进 `offline` 资源（资源上限 28800 = 8 小时）。
   注意：原版**不补算产量**——离线时间只记成 `offline` 资源（法术消耗用），这里照抄。 */
try {
  const lastTs = Number(JSON.parse(localStorage.getItem('last'))) || 0;
  if (lastTs > 0) game.applyOffline((Date.now() - lastTs) / 1000);
} catch {}

/* ==================== 可见性口径（原版各 Store getter） ==================== */
const DF = () => game.run.dfc;
// 难度模式名 / 难度面板卡片（顺序与原版 66600-67090 一致：99, 0, 1, 2, 3；
// 每张卡的子项顺序也照抄原版 JSX：99→2,3,4 / 0→3,2 / 1→4,2,3 / 2→4,2,3 / 3→4,2,3,5）
const DIFF = { 99: 'difficulty_99', 0: 'difficulty_0', 1: 'difficulty_1', 2: 'difficulty_2', 3: 'difficulty_3' };
const DIFF_CARDS = [
  { m: 99, cls: 'd-green', items: [2, 3, 4] },
  { m: 0, cls: '', items: [3, 2] },
  { m: 1, cls: 'd-orange', items: [4, 2, 3] },
  { m: 2, cls: 'd-red', items: [4, 2, 3] },
  { m: 3, cls: 'd-purple', items: [4, 2, 3, 5] },
];
// TechsStore.visibleTechs / ownedTechs（main.js.src:63918/63943）
// 「oracle_t 仅在 MainStore.showOracle 时可见」= 源码 63920/63931/63945 的 `oracle_t && !showOracle`；
// showOracle 由难度决定（dfc 0/99 → true，1/2/3 → false，源码 64674）。
const visibleTechs = () => game.data.techs.filter((t) => {
  if (t.id === 'oracle_t' && !game.showOracle) return false;
  if (t.id === 'favor_gods' && DF() !== 3) return false;
  return !game.reqgen.checkOwned('tech', t.id, 1) && game.reqgen.checkReq('tech', t.id, t, false);
});
const ownedTechs = () => game.data.techs.filter((t) => {
  if (t.id === 'oracle_t' && !game.showOracle) return false;
  if (t.id === 'favor_gods' && DF() !== 3) return false;
  return !!game.reqgen.checkOwned('tech', t.id, 1);
});
const buildableTechs = () => game.data.techs.filter((t) => !game.reqgen.checkOwned('tech', t.id, 1)
  && game.reqgen.checkReq('tech', t.id, t));
// BuildingsStore.buildings / buildableBuildings / buildableCapBuildings（main.js.src:49920-49938）
// 「oracle_b 仅在 showOracle 时可见」= 源码 49920/49929/49938 的 `oracle_b && !showOracle`。
const visibleBuildings = (tabId) => game.data.buildings.filter((b) => !(b.id === 'oracle_b' && !game.showOracle)
  && (b.id !== 'glory_gods' || DF() === 3) && (tabId === undefined || b.tab === tabId)
  && game.reqgen.checkReq('building', b.id, b, false));
const buildableBuildings = () => game.data.buildings.filter((b) => !(b.id === 'oracle_b' && !game.showOracle)
  && (b.id !== 'glory_gods' || DF() === 3) && game.reqgen.checkReq('building', b.id, b));
const buildableCapBuildings = () => game.data.buildings.filter((b) => !(b.id === 'oracle_b' && !game.showOracle)
  && (b.id !== 'glory_gods' || DF() === 3) && game.reqgen.checkReq('building', b.id, b, true, false, false, true));
// 原版类别顺序 je（main.js.src:49869）
const CAT_ORDER = ['living_quarters', 'resource', 'wonders', 'commercial_area', 'science', 'defense', 'faith', 'warehouse'];
// ArmyStore.visibleArmy（main.js.src:42419）
const visibleArmy = () => game.data.units.filter((u) => u.type !== 'enemy' && u.type !== 'settlement'
  && game.reqgen.checkReq('army', u.id, u, false));
// MagicStore.visiblePrayers（分包 673：!owned && checkReq(...,false)）
const visiblePrayers = () => (game.data.prayers || []).filter((p) => !game.reqgen.checkOwned('prayer', p.id, 1)
  && game.reqgen.checkReq('prayer', p.id, p, false));
// DiplomacyStore.visibleDiplomacy（main.js.src:50101）：非 hidden 且已出现在 run.diplomacy
const visibleDiplomacy = () => (game.data.diplomacy || []).filter((d) => d.hidden !== true
  && (game.run.diplomacy || []).some((x) => x.id === d.id));
const runDip = (id) => (game.run.diplomacy || []).find((x) => x.id === id) || {};
// MarketStore.showMarket = 拥有市场建筑；MagicStore.showMagic = 拥有宗教科技
const showMarket = () => !!game.reqgen.checkOwned('building', 'marketplace', 1);
const showMagic = () => !!game.reqgen.checkOwned('tech', 'religion', 1);
// PopulationStore.population（main.js.src:56947）
const visibleJobs = () => game.data.jobs.filter((j) => game.reqgen.checkReq('population', j.id, j));
// QueueStore.enabledQueue（main.js.src:57090）：主管科技 或 队列大师传承
const queueEnabled = () => !!game.reqgen.checkOwned('tech', 'supervisor', 1) || !!game.reqgen.checkOwned('legacy', 'queue_master', 1);
const qtyBuilding = (id) => { const i = game.idxs.buildings?.[id]; return i === undefined ? 0 : (game.run.buildings[i]?.value || 0); };
const qtyUnit = (id) => { const r = (game.run.army || []).find((a) => a.id === id); return r ? { owned: r.value, away: r.away } : { owned: 0, away: 0 }; };

/* ==================== 渲染：顶栏 ==================== */
/* 每秒产量指纹：只按"资源数值/上限"做签名时，资源顶到上限（或被断粮掐停）后数值不再变化，
   于是派工/撤工、建造产出建筑造成的速率变化永远刷不出来（用户实测："加了工匠，工具还是 0/秒"）。
   这里把各资源速率也纳入签名；perSecond 会遍历 modifier，所以 250ms 缓存一次。 */
let _rateAt = 0, _rateSig = '';
function rateSig(now) {
  if (now - _rateAt < 250) return _rateSig;
  _rateAt = now;
  _rateSig = (game.run.resources || []).map((r) => (game.perSecond(r.id) || 0).toFixed(2)).join(',');
  return _rateSig;
}
function renderTop(force = false) {
  // 节流：数值签名未变且距上次渲染 <250ms 就跳过（避免 60fps 全量重绘）
  const sig = (game.run.resources || []).map((r) => Math.floor(r.value) + ':' + Math.round(game.capOf(r.id))).join('|')
    + '|' + (game.run.queue || []).length + '|' + Math.round(game.resourceValue('offline') || 0)
    + '|' + (game.attackInProgress ? Math.round(game.attackInProgress.attack) : '') + '|' + game.clock.scale
    + '|' + game.run.ancestors + '|r' + rateSig(performance.now());
  const now = Date.now();
  if (!force && sig === window.__topSig && now - (window.__topAt || 0) < 250) return;
  window.__topSig = sig; window.__topAt = now;
  try { renderTopInner(); } catch (e) { (window.__viewErrs ||= []).push('top: ' + e.message); } }
function renderTopInner() {
  const order = ['food', 'wood', 'stone', 'research', 'gold', 'copper', 'iron', 'tools'];
  const visible = game.visibleResources().map((d) => d.id);
  const ids = [...order.filter((id) => visible.includes(id)), ...visible.filter((id) => !order.includes(id))];
  // 全部已解锁资源放进"一块面板"：收起时小字显示 名称 + 数量/上限；点面板展开后逐行显示速率
  const strip = $('#resstrip');
  // 原版规则：食物为 0 时除食物外全部停产（getTimerValue 开头 `if (0 === food && 'food' !== id) return 0`）。
  // 界面给个视觉提示，免得玩家以为"派了工匠却不产工具"。
  const starving = game.resourceValue('food') <= 0;
  if (strip.classList.contains('starving') !== starving) strip.classList.toggle('starving', starving);
  const stripKey = (resPanelOpen ? 'open|' : 'closed|') + ids.join(',');
  if (strip.dataset.key !== stripKey) {   // 资源集合或形态变化时才重建骨架，避免每 250ms 整块 innerHTML
    strip.dataset.key = stripKey;
    strip.className = 'res-strip' + (resPanelOpen ? ' open' : '');
    strip.innerHTML = ids.map(() => (resPanelOpen
      ? '<div class="res-row"><span class="n"></span><span class="v"></span><span class="r"></span></div>'
      : '<span class="res-item"><span class="n"></span><span class="v"></span></span>')).join('');
    const tg = $('#restoggle');
    if (tg) tg.textContent = resPanelOpen ? '▴' : '▾';
  }
  ids.forEach((id, i) => {
    const el = strip.children[i];
    if (!el) return;
    const v = game.resourceValue(id), cap = game.capOf(id), rate = game.perSecond(id);
    const cls = (resPanelOpen ? 'res-row' : 'res-item')
      + (cap > 0 && v >= cap ? ' full' : cap > 0 && v < cap * 0.1 ? ' warn' : '')
      + (starving && id === 'food' ? ' starve' : '');
    if (el.className !== cls) el.className = cls;
    const nEl = el.children[0], vEl = el.children[1];
    const name = resName(id);
    if (nEl.textContent !== name) nEl.textContent = name;
    const vHtml = fmt(v) + (cap > 0 ? `<span class="cap">/${fmt(cap)}</span>` : '');
    if (vEl.innerHTML !== vHtml) vEl.innerHTML = vHtml;
    if (resPanelOpen) {
      const rEl = el.children[2];
      const rTxt = fmtRate(rate) + '/秒';
      if (rEl.textContent !== rTxt) rEl.textContent = rTxt;
      const rCls = 'r' + (rate > 0.005 ? ' up' : rate < -0.005 ? ' down' : '');
      if (rEl.className !== rCls) rEl.className = rCls;
    }
  });
  const q = game.run.queue?.length || 0;
  const inc = game.attackInProgress;
  // 手动采集面板（原版：封建制度研究前常驻侧栏）
  const showManual = !game.reqgen.checkOwned('tech', 'feudalism', 1);
  $('#gatherbar').hidden = !showManual;
  if (showManual) $('#gatherbar').innerHTML = ['food', 'wood', 'stone'].map((id) => `<button class="btn btn-sm btn-primary" data-gather="${id}">${resName(id)}</button>`).join('');
  const gear = $('#gear'); if (gear) gear.textContent = game.data.name('', 'settings');
  // 祖先名 + 配色（原版 header 的 .text-ancestor 元素 + _updateAncestorColor 写的 --ancestor-color）
  const anc = game.run.ancestors;
  let ancChip = '';
  if (anc) {
    const def = (game.data.ancestors || []).find((a) => a.id === anc);
    const color = def?.color || '#9aa0a6';
    document.documentElement.style.setProperty('--ancestor-color', color);
    ancChip = `<div class="ancestor-chip"><span class="dot"></span><span>${game.data.name('', anc)}</span></div>`;
  } else {
    document.documentElement.style.setProperty('--ancestor-color', '#9aa0a6');
  }
  $('#statusline').innerHTML = ancChip
    + `<span>${game.data.name('', 'difficulty')}：${game.data.name('', DIFF[game.run.dfc] ?? 'difficulty_0')}</span>`
    + `<span>${game.data.name('', 'queue')}：${q}</span>`
    + (inc ? `<span style="color:#e05252">${game.data.name('dip_', inc.id)} ${inc.attack.toFixed(0)}%</span>` : '');
}

/* ==================== 渲染：视图 ==================== */
function renderView() {
  const v = $('#view');
  lastViewRender = performance.now();
  const start = needAncestor();
  document.body.classList.toggle('start-mode', start);
  if (start) {
    try { v.innerHTML = renderStart(); } catch (e) { (window.__viewErrs ||= []).push('start: ' + e.message); }
    return;
  }
  try { renderViewInner(v); } catch (e) { (window.__viewErrs ||= []).push(tab + ': ' + e.message); v.innerHTML = ''; }
}
function renderViewInner(v) {
  let body;
  if (tab === 'build') body = viewBuildings();
  else if (tab === 'tech') body = viewTechs();
  else if (tab === 'pop') body = viewPopulation();
  else if (tab === 'magic') body = viewMagic();
  else if (tab === 'army') body = viewArmy();
  else if (tab === 'dip') body = viewDiplomacy();
  else if (tab === 'market') body = marketBlock();
  else if (tab === 'ach') body = viewAchievements();
  else body = viewMore();
  // 原版移动端布局顺序：队列组件 order-1（主区之上）→ 主区 order-2 → 日志面板 order-3（主区之下）
  v.innerHTML = (tab === 'ach' ? '' : queueWidget()) + body + logBlock();
}

/* ---------- 队列组件（原版 QueueStore 侧栏 + 分包 51 的侧滑面板） ---------- */
const queueItemName = (it) => game.data.name(it.cat === 'building' ? 'bui_' : it.cat === 'tech' ? 'tec_' : 'fai_', it.id);
function queueWidget() {
  const q = game.run.queue || [];
  if (!queueEnabled() && !q.length) return '';
  const used = q.length, slots = Math.max(0, game.resourceValue('queue_slot'));
  const free = slots - used;
  const first = q[0] ? `<span class="pill">${queueItemName(q[0])}</span>` : '';
  return `<div class="qwidget">
    <button class="btn btn-sm ${used ? 'btn-primary' : ''}" data-queue-open="1">${game.data.name('', 'queue')}（<span class="${free > 0 ? '' : 'no'}">${used}/${slots}</span>）</button>
    ${first}</div>`;
}
function renderQueuePanel() {
  const el = $('#queuepanel');
  if (!queueOpen) { el.hidden = true; return; }
  el.hidden = false;
  const q = game.run.queue || [];
  const slots = Math.max(0, game.resourceValue('queue_slot'));
  const empty = Math.max(0, slots - q.length);
  $('#queue-title').textContent = game.data.name('', 'queue');
  $('#queue-strict-label').textContent = game.data.name('', 'queue_strict_order');
  const sw = $('#queue-strict');
  sw.classList.toggle('on', !!strictOrder);
  sw.setAttribute('aria-checked', strictOrder ? 'true' : 'false');
  $('#queue-body').innerHTML =
    (q.length ? q.map((it) => `<div class="qpanel-item">
      <div class="grow"><div class="t">${queueItemName(it)}</div>
      <div class="s" style="font-size:12px;color:var(--dim)">${game.data.name('', it.cat === 'building' ? 'build' : 'research')}</div></div>
      <button class="btn btn-sm" data-unqueue="${it.id}">✕</button></div>`).join('') : '')
    + Array.from({ length: empty }).map(() => `<div class="qpanel-slot">${game.data.name('', 'queue_empty_slot')}</div>`).join('');
}
function openQueue() { queueOpen = true; renderQueuePanel(); }

/* ---------- 日志面板（原版 Nr 组件：无标题，逐行 [HH:MM] 文本 + 颜色） ---------- */
function logBlock() {
  const logs = (game.logs || []).slice(-12).reverse();
  if (!logs.length) return '';
  return `<div class="logcard">${logs.map((l) => {
    const cls = /red/.test(l.color) ? 'red' : /green/.test(l.color) ? 'green' : '';
    const tm = new Date(l.at).toLocaleString([], { hour: '2-digit', minute: '2-digit' });   // 原版 addLog 口径
    return l.lines.map((x) => `<p class="logline ${cls}">[${tm}] ${x}</p>`).join('');
  }).join('')}</div>`;
}

/* ---------- 建造页（原版 BuildingsStore + 分包 455 的 Qr 组件） ---------- */
const viewBuildings = () => {
  const list = visibleBuildings(buildTab);
  if (!list.length) return `<div class="empty">${game.data.name('', 'build_empty')}</div>`;
  const cats = CAT_ORDER.filter((c) => list.some((b) => b.cat === c));
  const canBuild = buildableBuildings(), canCap = buildableCapBuildings();
  const sub = [];
  if (game.reqgen.checkOwned('tech', 'the_journey', 1)) sub.push([2, 'colony']);
  if (game.reqgen.checkOwned('tech', 'the_portal_t', 1)) sub.push([3, 'abyss']);
  const tabsRow = sub.length ? `<div class="subtabs">
    ${[[1, 'main_build'], ...sub].map(([id, k]) => `<button class="btn btn-sm ${buildTab === id ? 'btn-primary' : ''}" data-btab="${id}">${game.data.name('', k)}</button>`).join('')}
  </div>` : '';
  return tabsRow + cats.map((cat) => {
    const items = list.filter((b) => b.cat === cat);
    return `<div class="sec-title">${game.data.name('cat_', cat)}</div>
    <div class="card">${items.map((b) => {
      const qty = qtyBuilding(b.id);
      const can = canBuild.some((x) => x.id === b.id), canC = canCap.some((x) => x.id === b.id);
      const atCap = b.cap !== undefined && qty >= b.cap;
      // 原版建筑按钮上的角标就是数量（qty>0 且（未满上限 或 qty>1）时显示）
      const badge = qty > 0 && (!atCap || qty > 1) ? `<span class="pill">${qty}</span>` : '';
      const qr = queueState(), queued = qr.ids.has(b.id);
      const canQueue = queueReady() && !queued && !qr.full && !atCap;
      return `<div class="row tap" data-detail="bui:${b.id}">
        <div class="grow"><div class="t">${game.data.name('bui_', b.id)} ${badge}</div>
        <div class="s">${reqLine(b.req, game.reqgen.checkOwned('building', b.id))}</div></div>
        <button class="btn btn-sm ${can ? 'btn-accent' : ''}" data-build="${b.id}" ${can || canQueue ? '' : 'disabled'}>${game.data.name('bui_', b.id)}</button>
      </div>`;
    }).join('')}</div>`;
  }).join('');
};

/* ---------- 研究页（原版 TechsStore + 分包 455 的 ea 组件：研究 / 已完成 两个子页） ---------- */
const techRow = (t, owned) => {
  const can = buildableTechs().some((x) => x.id === t.id);
  const qr = queueState(), queued = qr.ids.has(t.id);
  const canQueue = queueReady() && !owned && !t.confirm && !queued && !qr.full;
  return `<div class="row tap" data-detail="tec:${t.id}">
    <div class="grow"><div class="t">${game.data.name('tec_', t.id)}</div>
    <div class="s">${reqLine(t.req, game.reqgen.checkOwned('tech', t.id))}</div></div>
    <button class="btn btn-sm ${can && !owned ? 'btn-accent' : ''}" data-research="${t.id}" ${owned || can || canQueue ? '' : 'disabled'}>${game.data.name('tec_', t.id)}</button>
  </div>`;
};
const viewTechs = () => {
  const list = techTab === 'completed' ? ownedTechs() : visibleTechs();
  const tabsRow = `<div class="subtabs">
    <button class="btn btn-sm ${techTab === 'research' ? 'btn-primary' : ''}" data-ttab="research">${game.data.name('', 'research')}</button>
    <button class="btn btn-sm ${techTab === 'completed' ? 'btn-primary' : ''}" data-ttab="completed">${game.data.name('', 'completed')}</button>
  </div>`;
  if (!list.length) {
    const emptyKey = techTab === 'completed' ? 'log_village_empty' : 'tech_empty';
    return tabsRow + `<div class="empty">${game.data.name('', emptyKey)}</div>`;
  }
  return tabsRow + `<div class="sec-title">${game.data.name('', 'research')}（${ownedTechs().length}/${game.data.techs.length}）</div>
  <div class="card">${list.map((t) => techRow(t, techTab === 'completed')).join('')}</div>`;
};

/* ---------- 任务进度（原版 ArmyStore progressScout/Attack/Spy 的进度条） ---------- */
const missionBar = (kind, cls) => {
  const m = game.missionInfo(kind);
  if (!m.active) return '';
  const pct = Math.max(0, Math.min(100, m.progress));
  return `<div class="missionbar ${cls}"><div style="width:${pct}%"></div></div><div class="s">${Math.round(pct)}%</div>`;
};
/* 原版 ArmyStore.enemiesOptions（main.js.src:42551）：未占领的据点 + 已宣战未占领的王国，最后 reverse */
const enemyOptions = () => {
  const out = [];
  for (const e of game.run.enemies || []) {
    if (e.owned) continue;
    const def = game.data.byId.expedition.get(e.id);
    out.push({ value: e.id, label: T('ene_' + e.id + '_description'), level: def?.level || 0, log: e.log || '' });
  }
  for (const d of game.run.diplomacy || []) {
    if (d.war !== 1 || d.owned) continue;
    const def = game.data.byId.diplomacy.get(d.id);
    if (!def || def.hidden === true) continue;
    out.push({ value: d.id, label: T('dip_' + d.id + '_description'), level: def.level || 0, flag: 1, log: d.log || '' });
  }
  return out.reverse();
};
/* 目标选择弹层（原版分包 918 的 selectEnemy 模态） */
function openPick(title, items) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = items.map((it) => `<button class="pickrow" data-spy-target="${it.value}">
    <span class="t">${it.flag === 1 ? T('dip_' + it.value) : T('ene_' + it.value)}</span>
    ${it.log ? `<span class="s">${it.log}</span>` : ''}</button>`).join('');
  $('#sheet').hidden = false;
}

/* ---------- 军队页 ---------- */
const unitCosts = (type) => {
  const cost = {};
  for (const a of game.run.army || []) {
    const u = game.data.byId.unit.get(a.id);
    if (u?.type === type && a.away > 0) for (const r of (u.reqAttack || [])) cost[r.id] = (cost[r.id] || 0) + r.value * a.away;
  }
  return cost;
};
const viewArmy = () => {
  const list = visibleArmy().filter((u) => ['army', 'recon', 'spy'].includes(u.type));
  const order = game.run.armyOrder || { away: [], defense: [] };
  const scouts = (game.run.army || []).filter((a) => a.value > 0 && game.data.byId.unit.get(a.id)?.type === 'recon');
  const scoutCosts = unitCosts('recon');
  const scoutM = game.missionInfo('scout');
  // 原版 checkScout（main.js.src:42487）：非进行中 + 侦察兵成本凑得齐
  const canScout = scouts.length > 0 && !scoutM.active && Object.entries(scoutCosts).every(([id, v]) => game.resourceValue(id) >= v);
  // 侦察段：原版只有 scoutCount === 0 时才显示 scout_empty（分包 918 D 组件 w>0 判断）
  const scoutBlock = scouts.length
    ? `<div class="sec-title">${game.data.name('', 'cat_scouting')}</div>
      <div class="card">${scouts.map((a) => {
      const u = game.data.byId.unit.get(a.id);
      return `<div class="row"><div class="grow"><div class="t">${game.data.name('uni_', a.id)}</div>
        <div class="s">${a.away} / ${a.value}</div></div></div>`;
    }).join('')}
      ${Object.keys(scoutCosts).length ? `<div class="row"><div class="grow"><div class="s">${Object.entries(scoutCosts).map(([id, v]) => `${resName(id)} ${Math.round(v)}`).join('　')}</div></div></div>` : ''}
      <div class="row"><div class="grow">${scoutM.active ? missionBar('scout', 'blue') : `<div class="s">${game.data.name('', 'explore')}</div>`}</div>
        ${scoutM.active ? '' : `<button class="btn btn-sm ${canScout ? 'btn-accent' : ''}" data-scout="1" ${canScout ? '' : 'disabled'}>${game.data.name('', 'send_to_explore')}</button>`}</div>
      </div>`
    : `<div class="sec-title">${game.data.name('', 'cat_scouting')}</div>
      <div class="card"><div class="row"><div class="grow"><div class="t">${game.data.name('', 'explore')}</div><div class="s">${game.data.name('', 'scout_empty')}</div></div></div></div>`;
  // 间谍段（原版分包 918：visibleEspionage 才出现；目标选择 select_spy / no_spy_enemy + send_to_spy）
  let spyBlock = '';
  if (game.visibleEspionage) {
    const opts = enemyOptions();
    const sel = game.spyOption;
    const spyM = game.missionInfo('spy');
    const canSpy = opts.length > 0 && sel.value !== '' && game.spyStore.check();
    const selLabel = sel.label !== '' ? sel.label : (opts.length > 0 ? T('select_spy') : T('no_spy_enemy'));
    const spyRows = (game.run.army || []).filter((a) => a.value > 0 && game.data.byId.unit.get(a.id)?.type === 'spy')
      .map((a) => `<div class="row"><div class="grow"><div class="t">${game.data.name('uni_', a.id)}</div>
        <div class="s">${a.away} / ${a.value}</div></div></div>`).join('');
    spyBlock = `<div class="sec-title">${T('spy')}</div>
    <div class="card">${spyRows}
      <div class="row"><div class="grow">
        <button class="btn btn-sm ${sel.value !== '' ? 'btn-primary' : ''}" data-spy-pick="1" ${opts.length === 0 || spyM.active ? 'disabled' : ''}>${selLabel}</button>
        ${spyM.active ? missionBar('spy', 'violet') : ''}
      </div>
      ${spyM.active ? '' : `<button class="btn btn-sm ${canSpy ? 'btn-primary' : ''}" data-spy-start="1" ${canSpy ? '' : 'disabled'}>${T('send_to_spy')}</button>`}
      </div>
      ${Object.keys(game.costsSpy).length ? `<div class="row"><div class="grow"><div class="s">${Object.entries(game.costsSpy).map(([id, v]) => `${resName(id)} ${Math.round(v)}`).join('　')}</div></div></div>` : ''}
    </div>`;
  }
  // 原版军队子页（分包 918 的 ArmyPanel）直接 map `visibleArmy`：army/recon/spy 都在这里，点单位名 = 招募。
  const rows = list.map((u) => {
    const { owned, away } = qtyUnit(u.id);
    const idx = (order.away || []).indexOf(u.id);
    const canRecruit = owned < (u.cap ?? Infinity) && game.armyOwned() < game.armyCap();
    return `<div class="row unit">
      <div class="grow tap" data-detail="uni:${u.id}"><div class="t">${game.data.name('uni_', u.id)}${u.cap ? ` <span class="pill">${game.data.name('', 'cap')} ${u.cap}</span>` : ''}</div>
      <div class="s">${game.data.name('', 'attack')} ${u.attack}　${game.data.name('', 'defense')} ${u.defense}　${away} / ${owned}${idx >= 0 ? `　${idx + 1}` : ''}</div></div>
      <div class="acts">
        <button class="btn btn-sm btn-primary" data-recruit="${u.id}" data-n="1" ${canRecruit ? '' : 'disabled'}>+1</button>
        <button class="btn btn-sm btn-primary" data-recruit="${u.id}" data-n="10" ${canRecruit ? '' : 'disabled'}>+10</button>
        <button class="btn btn-sm" data-away="${u.id}" data-delta="-1" ${away > 0 ? '' : 'disabled'}>−</button>
        <button class="btn btn-sm" data-away="${u.id}" data-delta="1" ${away < owned ? '' : 'disabled'}>+</button>
        <button class="btn btn-sm" data-order="${u.id}" data-dir="-1">↑</button>
        <button class="btn btn-sm" data-order="${u.id}" data-dir="1">↓</button>
        <button class="btn btn-sm" data-dismiss="${u.id}" title="${game.data.name('', 'dismiss')}">${game.data.name('', 'dismiss')}</button>
      </div>
    </div>`;
  }).join('');
  // 出征/据点（原版分包 918 的 B(type='attack')）：可攻击据点列表 + 进度条 + 神谕 + 出征成本
  const atkM = game.missionInfo('attack');
  const oracleM = game.missionInfo('oracle');
  const oracle = game.showOracle && !!game.reqgen.checkOwned('building', 'oracle_b', 1);
  const busy = atkM.active || oracleM.active;   // 出征/神谕互斥（源码 42526/42531）
  // 原版神谕按钮 disabled = !checkAttack；复刻是逐行按钮，目标由点哪一行决定，这里只按"买得起"预判
  const canOracle = (() => {
    const c = game.costsAttack, ks = Object.keys(c);
    return ks.length > 0 && ks.every((id) => game.resourceValue(id) >= c[id]);
  })();
  const enemyBlock = `<div class="sec-title">${game.data.name('', 'enemies')}</div>
  ${atkM.active ? `<div class="card"><div class="row"><div class="grow">${missionBar('attack', 'red')}</div></div></div>` : ''}
  ${oracleM.active ? `<div class="card"><div class="row"><div class="grow">${T('oracle')} ${missionBar('oracle', 'indigo')}</div></div></div>` : ''}
  <div class="card">${(game.run.enemies || []).length ? game.run.enemies.map((e) => `
    <div class="row tap" data-detail="ene:${e.id}">
      <div class="grow"><div class="t">${game.data.name('ene_', e.id)}</div><div class="s">${e.owned ? game.data.name('', 'dip_owned') : game.data.name('', 'enemies_empty')}</div></div>
      ${oracle ? `<button class="btn btn-sm" data-oracle="${e.id}" ${busy || e.owned || !canOracle ? 'disabled' : ''}>${T('oracle_button')}</button>` : ''}
      <button class="btn btn-sm btn-accent" data-attack="${e.id}" ${busy || e.owned ? 'disabled' : ''}>${game.data.name('', 'send_to_attack')}</button>
    </div>`).join('') : `<div class="empty">${game.data.name('', 'no_attackable_enemy')}</div>`}</div>`;
  const attackCosts = unitCosts('army');
  const attackBlock = `${enemyBlock}${Object.keys(attackCosts).length ? `<div class="sec-title">${T('attack')}</div>
  <div class="card"><div class="row"><div class="grow"><div class="s">${Object.entries(attackCosts).map(([id, v]) => `${resName(id)} ${Math.round(v)}`).join('　')}</div></div></div></div>` : ''}`;
  // 驻军页（原版"驻军"子页）：来犯敌袭 + 城市的防御 + 各兵种留守数
  const homeRows = (game.run.army || []).filter((a) => a.value > 0 && a.id !== 'settlement_defenses');
  const homeOf = (a) => Math.max(0, a.value - (a.away || 0));
  const defTotal = homeRows.reduce((sum, a) => {
    const d = game.data.byId.unit.get(a.id); if (!d) return sum;
    const m = game.armyMods(a.id);
    return sum + homeOf(a) * (d.defense + (m[1] || 0));
  }, 0);
  const inc = game.attackInProgress;
  const garrisonBlock = `<div class="sec-title">${T('garrison')}</div>
  ${inc ? `<div class="card"><div class="row"><div class="grow"><div class="t">${T('not_attack_incoming')}</div>
    <div class="s">${game.data.name('dip_', inc.id)}　${Math.round(inc.attack)}%</div>
    <div class="atkbar"><div style="width:${Math.max(0, Math.min(100, inc.attack))}%"></div></div></div>
    <button class="btn btn-sm btn-accent" data-defend="${inc.id}">${T('garrison')}</button></div></div>` : ''}
  <div class="card">
    <div class="row"><div class="grow"><div class="t">${T('uni_settlement_defenses_description')}</div><div class="s">${fmt(defTotal)}</div></div></div>
    ${homeRows.length ? homeRows.map((a) => `<div class="row"><div class="grow"><div class="t">${game.data.name('uni_', a.id)}</div>
      <div class="s">${fmt(homeOf(a))} / ${fmt(a.value)}</div></div></div>`).join('') : `<div class="empty">${game.data.name('', 'army_empty')}</div>`}
  </div>`;
  // 军队页子页签（原版 918：军队 / 探索 / 间谍 / 攻击 / 驻军），计数口径按原版实测：
  //   军队 = ownedCount/cap；探索·间谍 = away/总；攻击 = army away/总；驻军 = (总−away)/总
  const unitSum = (type, f) => (game.run.army || [])
    .filter((a) => game.data.byId.unit.get(a.id)?.type === type).reduce((sum, a) => sum + (f(a) || 0), 0);
  const ownedAll = game.armyOwned();
  const awayAll = (game.run.army || []).filter((a) => a.id !== 'settlement_defenses').reduce((sum, a) => sum + (a.away || 0), 0);
  const ARMY_TABS = [
    ['army', T('army'), ownedAll, game.armyCap()],
    ['explore', T('explore'), unitSum('recon', (a) => a.away), unitSum('recon', (a) => a.value)],
    ...(game.visibleEspionage ? [['spy', T('spy'), unitSum('spy', (a) => a.away), unitSum('spy', (a) => a.value)]] : []),
    ['attack', T('attack'), unitSum('army', (a) => a.away), unitSum('army', (a) => a.value)],
    ['garrison', T('garrison'), ownedAll - awayAll, ownedAll],
  ];
  const active = ARMY_TABS.some(([k]) => k === armyTab) ? armyTab : 'army';
  armyTab = active;
  const tabRow = `<div class="subtabs">${ARMY_TABS.map(([k, label, n, d]) =>
    `<button class="btn btn-sm ${active === k ? 'btn-primary' : ''}" data-atab="${k}">${label} ${fmt(n)} / ${fmt(d)}</button>`).join('')}</div>`;
  const panel = (k, html) => `<div class="apanel" data-apanel="${k}"${active === k ? '' : ' hidden'}>${html}</div>`;
  const armyBlock = `<div class="sec-title">${game.data.name('', 'army')}（${fmt(ownedAll)}/${fmt(game.armyCap())}）</div>
  <div class="card">
    <div class="row"><div class="grow"><div class="s">${game.armyPresetInfo().text}</div></div>
      <button class="btn btn-sm" data-army="save-preset">${game.data.name('', 'army_preset_save')}</button>
      <button class="btn btn-sm btn-primary" data-army="build-preset">${game.data.name('', 'army_preset_build')}</button>
    </div>
    <div class="row"><div class="grow"><div class="s">${game.data.name('', 'army')}：${fmt(ownedAll)}/${fmt(game.armyCap())}</div></div>
      <button class="btn btn-sm" data-army="add-all">${game.data.name('', 'add_all')}</button>
      <button class="btn btn-sm" data-army="remove-all">${game.data.name('', 'remove_all')}</button>
    </div>
    <div class="row"><div class="grow"><div class="s">${game.data.name('', game.orderByBattleOrder ? 'sort_by_battle_order' : 'sort_by_battle_order_disable')}</div></div>
      <button class="btn btn-sm ${game.orderByBattleOrder ? 'btn-primary' : ''}" data-army="sort-toggle">${game.data.name('', 'sort_by_battle_order')}</button>
    </div>
  </div>
  <div class="card">${rows || `<div class="empty">${game.data.name('', 'army_empty')}</div>`}</div>`;
  return `${tabRow}${panel('army', armyBlock)}${panel('explore', scoutBlock)}`
    + `${game.visibleEspionage ? panel('spy', spyBlock) : ''}${panel('attack', attackBlock)}${panel('garrison', garrisonBlock)}`;
};

/* ---------- 人口页（原版分包 180：forceMax = 失业 0 → + 键禁用；minReached = 当前 0 → − 键禁用） ---------- */
const viewPopulation = () => {
  const jobs = visibleJobs().filter((j) => j.id !== 'unemployed');
  const un = game.populationTotal('unemployed');
  const unCap = game.capOf('unemployed');
  return `
  <div class="sec-title">${game.data.name('', 'population')}（${game.data.name('', 'pop_unemployed')} ${un} / ${unCap}）</div>
  <div class="card">${jobs.length ? jobs.map((j) => {
    const cur = game.populationTotal(j.id), cap = game.capOf(j.id);
    const gen = (j.gen || []).map((g) => `${game.data.name('res_', g.id)} ${g.value > 0 ? '+' : ''}${g.value}/秒`).join('、');
    const canDec = cur > 0, canInc = cur < cap && un > 0;
    return `<div class="row">
      <div class="grow"><div class="t">${game.data.name('pop_', j.id)}</div><div class="s">${gen ? gen + '　' : ''}${cur} / ${cap}</div></div>
      <button class="btn btn-sm" data-job="${j.id}" data-delta="-10" ${canDec ? '' : 'disabled'}>−10</button>
      <button class="btn btn-sm" data-job="${j.id}" data-delta="-1" ${canDec ? '' : 'disabled'}>−</button>
      <button class="btn btn-sm btn-primary" data-job="${j.id}" data-delta="1" ${canInc ? '' : 'disabled'}>+</button>
      <button class="btn btn-sm btn-primary" data-job="${j.id}" data-delta="10" ${canInc ? '' : 'disabled'}>+10</button>
    </div>`;
  }).join('') : `<div class="empty">${game.data.name('', 'population_empty')}</div>`}</div>`;
};

/* ---------- 魔法页（分包 673：咒语/祈祷两个列表，各自为空时显示空态） ---------- */
const prayerRow = (p) => {
  const on = game.magic.activeSpell(p.id);
  const known = (game.run.prayers || []).some((x) => x.id === p.id && x.value > 0);
  const isSpell = p.type === 'spell';
  const canBuy = !!game.reqgen.checkReq('prayer', p.id, p);   // 祈祷：资源/前置是否够（不够则引擎自动入队）
  const disabled = !isSpell && !known && !canBuy && !(queueReady() && !queueState().full);
  return `<div class="row tap" data-detail="pra:${p.id}">
    <div class="grow"><div class="t">${game.data.name('fai_', p.id)}</div>
    <div class="s">${reqLine(p.req, game.reqgen.checkOwned('prayer', p.id)).replace(/　/g, '、')}</div></div>
    <button class="btn btn-sm ${on ? 'btn-primary' : ''}" data-prayer="${p.id}" ${disabled ? 'disabled' : ''}>${game.data.name('', on || known ? 'fai_spell_cancel' : 'fai_spell_accept')}</button>
  </div>`;
};
let spellFilter = (() => { try { const v = JSON.parse(localStorage.getItem('filterSpells')); return v || 'all'; } catch { return 'all'; } })();   // 原版 MagicStore.filterSpells（默认 "all"）
const SPELL_CATS = ['army', 'defense', 'resource', 'time'];   // 原版 He = ["army","defense","resource","time"]
const viewMagic = () => {
  const list = visiblePrayers();
  const spells = list.filter((p) => p.type === 'spell');
  const prayers = list.filter((p) => p.type !== 'spell');
  const shown = spellFilter === 'all' ? spells : spells.filter((p) => (p.cat || '') === spellFilter);
  // 咒语段：原版是一个列表 + 分类筛选（spells_all / spells_army / spells_defense / spells_resource / spells_time），
  // 空列表时给出 spells_empty 空态（不再出现"只有标题没有内容"的段）
  const filters = spells.length ? `<div class="subtabs">${['all', ...SPELL_CATS].map((c) => `<button class="btn btn-sm ${spellFilter === c ? 'btn-primary' : ''}" data-spellfilter="${c}">${game.data.name('spells_', c)}</button>`).join('')}</div>` : '';
  return `<div class="sec-title">${T('prayers')}</div>
  <div class="card">${prayers.length ? prayers.map(prayerRow).join('') : `<div class="empty">${T('prayer_empty')}</div>`}</div>
  <div class="sec-title">${T('spells')}</div>
  <div class="card">${filters}${shown.length ? shown.map(prayerRow).join('') : `<div class="empty">${T('spells_empty')}</div>`}</div>`;
};

/* ---------- 外交页（原版分包 648：关系卡 + 联盟/改善/侮辱/宣战 + 贸易协定 + 代表团） ---------- */
const NEG = 50, POS = 90;   // main.js.src:50077 negativeRelationship / positiveRelationship
const viewDiplomacy = () => {
  const cards = visibleDiplomacy().map((d) => {
    const row = runDip(d.id);
    const rel = row.relationship || 0;
    const relText = rel === 0 ? 'dip_relationship_unknown' : rel < NEG ? 'dip_relationship_negative'
      : rel > POS ? 'dip_relationship_positive' : 'dip_relationship_neutral';
    let body = '';
    if (row.alliance === 1) {
      body = `<div class="row"><div class="grow"><div class="t" style="color:#7cb342">${game.data.name('', 'dip_alliance')}</div>
        <div class="s">${game.data.name('', 'dip_alliance_description')}</div></div></div>`;
    } else if (row.owned === 1) {
      body = `<div class="row"><div class="grow"><div class="t" style="color:#7cb342">${game.data.name('', 'dip_owned')}</div>
        <div class="s">${game.data.name('', 'dip_owned_description')}</div></div></div>`;
    } else if (row.war === 1) {
      body = `<div class="row"><div class="grow"><div class="s">${game.data.name('', 'dip_war_declaration')}</div></div>
        ${row.attack > 0 ? `<button class="btn btn-sm btn-accent" data-defend="${d.id}">${T('garrison')}</button>` : ''}</div>`;
    } else if (rel === 0) {
      body = `<div class="row"><div class="grow"><div class="t">${game.data.name('', 'dip_send_delegation')}</div>
        <div class="s">${game.data.name('', 'dip_send_delegation_description')}</div></div>
        <button class="btn btn-sm btn-accent" data-delegation="${d.id}">${game.data.name('', 'dip_send_delegation')}</button></div>`;
    } else {
      const canImprove = rel <= POS && game.reqgen.checkReq('diplomacy', d.id, { id: d.id, req: d.reqImproveRelationship });
      body = `<div class="row"><div class="grow"><div class="t">${game.data.name('', 'dip_relationships')}</div>
        <div class="s">${game.data.name('', relText)} ${rel}</div></div>
        ${rel > POS
          ? `<button class="btn btn-sm btn-primary" data-dip="${d.id}:alliance">${game.data.name('', 'dip_alliance')}</button>`
          : `<button class="btn btn-sm btn-primary" data-dip="${d.id}:improve" ${canImprove ? '' : 'disabled'}>${game.data.name('', 'dip_improve_relationships')}</button>`}
        ${rel < NEG
          ? `<button class="btn btn-sm" data-war="${d.id}">${game.data.name('', 'dip_war')}</button>`
          : `<button class="btn btn-sm" data-dip="${d.id}:insult">${game.data.name('', 'dip_insult')}</button>`}
      </div>`;
      if (rel >= NEG) {
        const trade = (d.commercial || []).map((g) => `${resName(g.id)} ${g.value > 0 ? '+' : ''}${g.value}/秒`).join('　');
        body += `<div class="row"><div class="grow"><div class="t">${game.data.name('', 'dip_trade_agreements')}</div>
          <div class="s">${trade}</div></div>
          <button class="btn btn-sm ${row.trade === 1 ? '' : 'btn-primary'}" data-dip="${d.id}:trade">${game.data.name('', row.trade === 1 ? 'dip_trade_cancel' : 'dip_trade_accept')}</button>
        </div>`;
      }
    }
    return `<div class="sec-title">${game.data.name('dip_', d.id)}</div><div class="card">${body}</div>`;
  }).join('');
  // 来犯中的敌袭（原版 DiplomacyStore.showAttackProgress / percAttackInProgress）
  const inc = game.attackInProgress;
  const attackBlock = inc ? `<div class="sec-title">${T('not_attack_incoming_title')}</div>
  <div class="card"><div class="row"><div class="grow"><div class="t">${T('not_attack_incoming')}</div>
    <div class="s">${game.data.name('dip_', inc.id)}　${Math.round(inc.attack)}%</div>
    <div class="atkbar"><div style="width:${Math.max(0, Math.min(100, inc.attack))}%"></div></div></div>
    <button class="btn btn-sm btn-accent" data-defend="${inc.id}">${T('garrison')}</button></div></div>` : '';
  return `${attackBlock}
  <div class="sec-title">${game.data.name('', 'diplomacy')}</div>
  ${cards || `<div class="card"><div class="empty">${game.data.name('', 'dip_relationship_neutral')}</div></div>`}`;
};

/* ---------- 市场（分包 321：出售/购买各 10/100/1000，价格用 twoNumberFormat，持有量在提示里） ---------- */
const marketBlock = () => {
  if (!game.market || !showMarket()) {
    return `<div class="sec-title">${game.data.name('bui_', 'marketplace')}</div>
      <div class="card"><div class="row"><div class="grow"><div class="s">${reqLine(game.data.byId.building.get('marketplace')?.req)}</div></div></div></div>`;
  }
  const rows = game.market.stocks.map((st) => {
    const i = game.market.idx(st.id);
    const owned = game.resourceValue(st.id), gold = game.resourceValue('gold');
    const btn = (kind, n) => {
      const enough = kind === 'buy' ? gold >= st.buy_value * n : owned >= n;
      return `<button class="btn btn-sm ${enough ? (kind === 'buy' ? 'btn-primary' : 'btn-accent') : ''}" data-mkt="${kind}:${st.id}:${n}" ${enough ? '' : 'disabled'}>${n}</button>`;
    };
    return `<div class="row"><div class="grow"><div class="t">${resName(st.id)}</div>
      <div class="s">${resName(st.id)}: ${fmt(owned)}　${resName('gold')}: ${fmt(gold)}</div>
      <div class="s">${game.data.name('', 'sell')} ${resName('gold')} ${fmt2(st.sell_value)}　${game.data.name('', 'buy')} ${resName('gold')} ${fmt2(st.buy_value)}</div></div>
      <div class="mkt-btns">${btn('sell', 10)}${btn('sell', 100)}${btn('sell', 1000)}${btn('buy', 10)}${btn('buy', 100)}${btn('buy', 1000)}</div></div>`;
  }).join('');
  return `<div class="sec-title">${game.data.name('', 'sell')}/${game.data.name('', 'buy')}</div><div class="card">${rows}</div>`;
};

/* ---------- 设置/更多 ---------- */
const viewMore = () => {
  // 原版 LegacyStore 侧栏的"转生"入口（分包 51 的按钮集与可见性，main.js.src:52859）
  const prestigeBtns = [
    game.reqgen.checkOwned('tech', 'glorious_retirement', 1) ? `<button class="btn btn-sm" data-softreset-open="tec_glorious_retirement">${game.data.name('', 'tec_glorious_retirement')}</button>` : '',
    game.reqgen.checkOwned('building', 'reactivate_portal', 1) ? `<button class="btn btn-sm" data-softreset2="1">${game.data.name('', game.run.flag === 0 ? 'light_portal_of_the_dead' : 'tec_portal_of_the_dead')}</button>` : '',
    game.reqgen.checkOwned('tech', 'theresmore_richest_nation', 1) ? `<button class="btn btn-sm" data-softreset-open="tec_theresmore_richest_nation">${game.data.name('', 'theresmore_richest_nation')}</button>` : '',
    (game.run.donation || 0) >= 1e6 ? `<button class="btn btn-sm" data-softreset-open="ascension">${game.data.name('', 'ascension')}</button>` : '',
  ].filter(Boolean).join(' ');
  return `
  <div class="sec-title">${game.data.name('', 'settings')}</div>
  <div class="card">
    <div class="row"><div class="grow"><div class="t">${game.data.name('', 'load_from_textarea')}</div><div class="s"></div></div>
      <button class="btn btn-sm" data-act="export">${game.data.name('', 'save_to_clipboard')}</button><button class="btn btn-sm" data-act="import">${game.data.name('', 'load_from_textarea')}</button></div>
    <div class="row"><div class="grow"><div class="t">${game.data.name('', 'hard_reset')}</div><div class="s"></div></div>
      <button class="btn btn-sm" data-act="reset">${game.data.name('', 'hard_reset')}</button></div>
    ${game.run.ancestors !== '' ? `<div class="row"><div class="grow"><div class="t">${T('difficulty')}</div>
      <div class="s">${T(DIFF[game.run.dfc] ?? 'difficulty_0')}</div></div>
      <button class="btn btn-sm" data-act="change-difficulty" ${game.run.flagd === 2 ? 'disabled' : ''}>${T('difficulty')}-${T(DIFF[game.run.dfc] ?? 'difficulty_0')}</button></div>` : ''}
  </div>
  <div class="sec-title">${game.data.name('', 'prestige')}（${game.data.name('', 'legacy_points')} ${fmt(game.legacyPoints)}）</div>
  <div class="card">
    ${prestigeBtns ? `<div class="row"><div class="grow"><div class="t">${game.data.name('', 'prestige')}</div>
      <div class="s">${game.data.name('', 'soft_reset_confirm_1')}</div></div><div class="acts">${prestigeBtns}</div></div>` : ''}
    <div class="row"><div class="grow"><div class="t">${game.data.name('', 'new_game_plus')}</div><div class="s">${game.data.name('', 'new_game_plus_description')}</div></div>
      <button class="btn btn-sm ${game.visibleNewGamePlus ? 'btn-primary' : ''}" data-act="reset-ng" ${game.visibleNewGamePlus ? '' : 'disabled'}>${game.data.name('', 'new_game_plus')}</button></div>
    <div class="row"><div class="grow"><div class="t">${game.data.name('', 'prestige')}</div>
      <div class="s">${['res_relic', 'res_coin', 'res_tome_wisdom', 'res_gem', 'res_titan_gift', 'res_light'].map((k) => `${game.data.name('', k)} ${Math.round(game.resourceValue(k.replace('res_', '')))}`).join('　')}</div></div></div>
    <div class="row"><div class="grow"><div class="t">${game.data.name('', 'combat_reports')}</div>
      <div class="s">${(game.save.combatReports || []).length ? (game.save.combatReports || []).slice(0, 3).map((r) => `${game.data.name('ene_', r.enemyId) || game.data.name('dip_', r.enemyId)} ${r.victory ? game.data.name('', 'victory') : ''}`).join('　') : ''}</div></div></div>
    ${game.visibleNewGamePlus ? `<div class="row"><div class="grow"><div class="t">${game.data.name('', 'new_game_plus_title')}</div>
      <div class="s">${game.data.name('', 'new_game_plus_current_bonuses')} ${game.stats.ngResetBonus} → ${game.data.name('', 'new_game_plus_new_bonuses')} ${game.stats.ngResetBonus + (game.save.leg || []).length}</div></div></div>` : ''}
  </div>
  ${marketBlock()}
  ${mausoleumBlock()}
  <div class="sec-title">${game.data.name('', 'res_legacy')}</div>
  <div class="card">${(game.data.legacies || []).filter((l) => !game.save.leg.some((x) => x.id === l.id)
    && game.reqgen.checkReq('legacy', l.id, l, false)).slice(0, 20).map((l) => {
    const cost = game.legacyCost(l.id);
    const can = game.reqgen.checkReq('legacy', l.id, l);
    return `<div class="row"><div class="grow"><div class="t">${game.data.name('leg_', l.id)}</div><div class="s">${cost}</div></div>
      <button class="btn btn-sm ${can ? 'btn-primary' : ''}" data-legacy="${l.id}">${game.data.name('', 'buy')}</button></div>`;
  }).join('') || `<div class="empty">${game.data.name('', 'res_legacy')}</div>`}</div>
  <div class="sec-title">${game.data.name('', 'achievements')}</div>
  <div class="card"><div class="row tap" data-tab="ach"><div class="grow"><div class="t">${game.data.name('', 'achievements')}</div><div class="s">${(game.save.ach || []).length} / ${(game.data.achievements || []).reduce((a, g) => a + (g.ach || []).length, 0)}</div></div><div class="r">▸</div></div></div>`;
};

/* ---------- 开局"选择祖先"整屏（原版 main.js.src:72573 Sa / 条件 72592） ---------- */
const needAncestor = () => game.run.ancestors === '' || game.run.flag === 2 || game.run.flagb === 2;
function renderStart() {
  const list = (game.data.ancestors || []).filter((a) => game.reqgen.checkReq('ancestor', a.id, a));
  return `
  <div class="start-screen">
    <h1 class="start-title">Theresmore</h1>
    <p class="start-sub">${game.data.name('', 'runstart_subtitle')}</p>
    <div class="start-rule"></div>
    <h2 class="start-h2">${game.data.name('', 'runstart_choose_path')}</h2>
    <p class="start-p">${game.data.name('', 'runstart_begin_journey')}</p>
    <div class="start-grid">
      ${list.map((a) => `
      <div class="anc-card" style="border-color:${a.color}">
        <div class="anc-name" style="color:${a.color}">${game.data.name('', a.id)}</div>
        <p class="anc-desc">${game.data.name('', a.id + '_description')}</p>
        ${(a.gen || []).map((g) => `<div class="anc-gen" style="background:${a.color}20">${
          g.type === 'resource' ? `+${g.value}${g.perc ? '% ' : ' '}${game.data.name('res_', g.id)}`
            : g.type === 'cap' ? `+${g.value} ${game.data.name('', g.id)}${game.data.name('', 'cap')}` : ''}</div>`).join('')}
        <button class="anc-btn" style="background:${a.color}" data-ancestor="${a.id}">${game.data.name('', 'start_game')}</button>
      </div>`).join('')}
    </div>
  </div>`;
}

const RARITY = { legendary: '#e8a33d', epic: '#a855f7', rare: '#3b82f6', common: '#9aa0a6' };
const RANK = { legendary: 0, epic: 1, rare: 2, common: 3 };
const mausoleumBlock = () => {
  if (!game.showMausoleum) return '';
  const total = game.run.donation || 0;
  const pct = Math.floor((100 * total) / 1e6);
  return `<div class="sec-title">${game.data.name('', 'bui_mausoleum_gods')}（${pct}%）</div>
  <div class="card">
    <div class="row"><div class="grow"><div class="s">${game.data.name('', 'mausoleum_description')}</div></div></div>
    <div class="row"><div class="grow"><div class="s">${game.data.name('', 'mausoleum_donation_total')}：${fmt(total)} / 1000000</div></div></div>
    ${game.mausoleumResources.map((r) => `<div class="row"><div class="grow"><div class="t">${resName(r.id)}</div>
      <div class="s">${game.data.name('', 'mausoleum_donation_value')} ${r.value}</div></div>
      <button class="btn btn-sm" data-donate="${r.id}:1">${game.data.name('', 'donate')}</button>
      <button class="btn btn-sm btn-primary" data-donate="${r.id}:all">${game.data.name('', 'donate_all')}</button></div>`).join('')}
  </div>`;
};
const ACH_ORDER = ['legendary', 'epic', 'rare', 'common'];
// 原版稀有度只用颜色表达，不显示文字

const NAME_OF = {
  resource: (id) => resName(id), cap: (id) => resName(id), population: (id) => game.data.name('pop_', id),
  tech: (id) => game.data.name('tec_', id), building: (id) => game.data.name('bui_', id),
  army: (id) => game.data.name('uni_', id), enemy: (id) => game.data.name('ene_', id),
  diplomacy: (id) => game.data.name('dip_', id), prayer: (id) => game.data.name('fai_', id),
  legacy: (id) => game.data.name('leg_', id), ancestor: (id) => game.data.name('', id),
  stat: (id) => game.data.name('stat_', id),
};
const nm = (type, id) => (NAME_OF[type] ? NAME_OF[type](id) : id);
// modifier 类 gen 的 id 指的是"被加成的目标"，要用 type_id 判断它属于哪张表
const nmGen = (g) => {
  if (g.type === 'modifier') {
    const t = g.type_id === 'army' ? 'army' : g.type_id === 'population' ? 'population' : g.type_id === 'resource' ? 'resource' : null;
    return t ? nm(t, g.id) : nm(g.type_gen, g.id);
  }
  return nm(g.type, g.id);
};
// 资源/上限类直接写名字（"木材 +3%"），其余带类型前缀（"科技 箭术"）
const fmtGen = (g) => {
  const amount = g.type === 'cap' ? `+${g.value}`
    : `${g.value > 0 ? '+' : ''}${g.value}${g.perc ? '%' : ''}${g.perc || g.type === 'resource' ? '/秒' : ''}`;
  return `${nmGen(g)} ${amount}`.trim();
};
const fmtReq = (r) => `${nm(r.type, r.id)} ${r.value}`.trim();
/* 需求项渲染：满足=绿、不满足=红。
   口径与引擎 checkReq 一致：req.multi 要按"已拥有数量"膨胀（重复建造的成本递增），资源类 floor 后比较。
   （原版把需求放在 tooltip 里：红底 + "-缺额"；复刻版直接标在行内，所以顺手标成绿/红） */
const reqChip = (r, ownedCount = 0, withEta = false) => {
  const need = Math.floor(r.multi && ownedCount > 0 ? r.value * r.multi ** ownedCount : r.value);
  const ok = !!game.reqgen.checkOwned(r.type, r.id, need);
  let extra = '';
  if (withEta && !ok && r.type === 'resource') {
    // 缺口 = 需求 − 持有；再按产量估"还要多久"（原版 63062-63090）：
    //   资源上限不足以装下需求、或当前已顶到上限 → ∞；产量为 0 → ∞；否则 deficit / 每秒产量
    const have = Math.floor(game.resourceValue(r.id));
    const d = need - have;
    const cap = game.capOf(r.id), rate = game.perSecond(r.id);
    const SPECIAL = new Set(['legacy', 'fame', 'relic', 'coin', 'tome_wisdom', 'luck', 'gem', 'titan_gift', 'light']);
    let eta = '';
    if (!SPECIAL.has(r.id)) {
      const stuck = (cap > 0 && cap < need) || (cap > 0 && have >= cap);
      eta = stuck || !(rate > 0) ? '∞' : fmtEta(d / rate);
    }
    // 文案口径照原版 reqTooltipData：`[-缺口]` + 时长（原版在时长前还有个图标，这里直接用文字）
    extra = `<span class="req-eta"> [-${NF0.format(d)}]${eta ? ` ${eta}` : ''}</span>`;
  }
  return `<span class="req ${ok ? 'ok' : 'no'}">${nm(r.type, r.id)} ${need}${extra}</span>`;
};
const reqLine = (reqs, ownedCount = 0, withEta = false, sep = '　') => (reqs || []).length
  ? reqs.map((r) => reqChip(r, ownedCount, withEta)).join(sep) : '—';
/* 队列状态：能不能入队只看**空槽位**（原版 QueueStore.addQueue 的 freeSlots 判定 57123；
   queue_slot 本身来自主管科技/队列大师的 gen，所以没解锁时槽位为 0，自然入不了队）。
   注意：原版**没有**单独的"加入队列"按钮——买不起时点建造/研究按钮本身就等于入队（addBuilding/addTech
   失败 → addQueue，57158/63964/49990）。所以这里只保留一个动作按钮：
     · 买得起 → 直接建造/研究
     · 买不起但队列可用 → 点击后自动入队并弹出队列面板（doBuild/doResearch）
     · 队列不可用（无主管科技/队列大师，或没有空槽位）→ 按钮禁用，避免"点了没反应" */
const queueReady = () => game.queue.slots > 0;
const queueState = () => {
  const q = game.run.queue || [];
  return { used: q.length, full: q.length >= game.queue.slots, ids: new Set(q.map((x) => x.id)) };
};
// 原版成就画廊没有搜索框（无任何 <input>），这里只保留"我的/一览 + 只显示未获得"
const viewAchievements = () => {
  const groups = game.data.achievements || [];
  const owned = new Map((game.save.ach || []).map((a) => [a.id || a, a]));
  // 原版行为：标题 key 缺失（UNDEFINED_）的成就不进画廊列表
  const all = groups.flatMap((g) => (g.ach || []).map((a) => ({ ...a, parent: g.id })))
    .filter((a) => game.data.names['not_' + a.id + '_title'] !== undefined);
  const total = all.length;
  const byRarity = { legendary: 0, epic: 0, rare: 0, common: 0 };
  for (const a of all) if (owned.has(a.id)) byRarity[a.rarity || 'common']++;
  const tab = game._achTab || 'all';
  const missingOnly = !!game._showMissingAch;
  const titleOf = (a) => game.data.name('not_', a.id + '_title');
  const descOf = (a) => game.data.name('not_', a.id);
  const sortAch = (a, b) => {
    const ra = RANK[a.rarity] ?? 9, rb = RANK[b.rarity] ?? 9;
    if (ra !== rb) return ra - rb;
    const na = parseInt(String(titleOf(a)).replace(/[^0-9]/g, ''), 10), nb = parseInt(String(titleOf(b)).replace(/[^0-9]/g, ''), 10);
    const va = Number.isFinite(na) ? na : 9999, vb = Number.isFinite(nb) ? nb : 9999;
    if (va !== vb) return va - vb;
    return String(descOf(a)).localeCompare(String(descOf(b)));
  };
  // 总进度：百分比 floor，进度条宽度 ceil，顺序 legendary→epic→rare→common
  const pct = (r) => Math.floor((byRarity[r] / Math.max(1, total)) * 100);
  const bars = ACH_ORDER.map((r) => {
    const w = Math.ceil((byRarity[r] / Math.max(1, total)) * 100);
    return `<div class="row"><div class="grow">
      <div class="s">${byRarity[r]} / ${all.filter((a) => (a.rarity || 'common') === r).length}　${pct(r)}%</div>
      <div style="height:6px;background:#2b2e33;border-radius:3px;overflow:hidden;margin-top:6px">
        <div style="height:6px;width:${w}%;background:${RARITY[r]}"></div></div></div>
      <span style="width:14px;height:14px;border-radius:50%;background:${RARITY[r]};display:inline-block"></span></div>`;
  }).join('');

  let list;
  if (tab === 'mine') {
    list = all.filter((a) => owned.has(a.id)).sort(sortAch);
  } else {
    list = all.filter((a) => !missingOnly || !owned.has(a.id)).sort(sortAch);
  }
  const rows = list.length ? list.map((a) => {
    const got = owned.get(a.id);
    const dt = got && got.date ? new Date(got.date) : null;
    const gen = (a.gen || []).map(fmtGen).join('、');
    return `<div class="row tap" data-detail="ach:${a.id}" style="${tab === 'all' && !owned.has(a.id) ? 'opacity:.5' : ''}">
      <div class="grow"><div class="t">${owned.has(a.id) ? '✅ ' : '🔒 '}${titleOf(a)}</div>
      <div class="s">${descOf(a)}${gen ? '　' + gen : ''}</div></div>
      <div class="r">${dt ? dt.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</div></div>`;
  }).join('') : `<div class="empty">${game.data.name('', 'achievements_empty')}</div>`;

  return `
  <div class="card"><div class="row tap" data-tab="settings"><div class="grow"><div class="t">${game.data.name('', 'back')}</div></div><div class="r">▸</div></div></div>
  <div class="sec-title">${game.data.name('', 'achievements')}（${owned.size}/${total}）</div>
  <div class="card">${bars}</div>
  <div class="card"><div class="row">
    <button class="btn btn-sm ${tab === 'mine' ? 'btn-primary' : ''}" data-ach-tab="mine">${game.data.name('', 'achievements_mine')}（${owned.size}）</button>
    <button class="btn btn-sm ${tab === 'all' ? 'btn-primary' : ''}" data-ach-tab="all">${game.data.name('', 'achievements_global')}（${total}）</button>
    <button class="btn btn-sm ${missingOnly ? 'btn-primary' : ''}" data-act="toggle-missing">${game.data.name('', 'show_only_missing_achievements')}</button>
  </div></div>
  <div class="card">${rows}</div>`;
};

/* ---------- 标签栏（原版显示条件 + 角标，main.js.src:71463） ---------- */
function renderTabs() {
  const avail = {
    build: true,
    tech: true,
    pop: visibleJobs().length > 1,
    magic: showMagic(),
    army: visibleArmy().length > 0,
    dip: visibleDiplomacy().length > 0,
    market: showMarket(),
  };
  // 当前页签不再可用时回落到建造（原版由 HeadlessUI 的 selectedIndex 兜底）
  // 只对 7 个主导航页签生效：settings/ach 不在 avail 表里，不能把它们重置掉
  if (avail[tab] === false) tab = 'build';
  $('#tabbar').innerHTML = TABS.map((t) => {
    const on = tab === t.id;
    const badge = t.badge ? t.badge() : 0;
    // 不可用页签保留 DOM（自动化脚本仍能按 data-tab 选中），但界面上与原版一致地隐藏
    return `<button role="tab" data-tab="${t.id}" class="${on ? 'on' : ''}" ${avail[t.id] ? '' : 'hidden'}>${game.data.name('', t.k)}${badge > 0 ? `<span class="tabbadge">${badge}</span>` : ''}</button>`;
  }).join('');
}

/* ==================== 覆盖层 ==================== */
const sheetRowsHtml = (rows) => rows.map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span>${v}</span></div>`).join('');
let sheetLive = null;   // 详情面板打开时记住 {kind,id}，之后每 250ms 按最新状态重算（倒计时/缺口会跟着走）
function openSheet(title, rows, live = null) {
  sheetLive = live;
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = sheetRowsHtml(rows);
  $('#sheet').hidden = false;
}
function closeSheet() { sheetLive = null; $('#sheet').hidden = true; }
function refreshSheet() {
  const el = $('#sheet');
  if (!sheetLive || !el || el.hidden) return;
  const body = $('#sheet-body');
  if (!body) return;
  let html = '';
  try { html = sheetRowsHtml(detailRows(sheetLive.kind, sheetLive.id)); } catch { return; }
  if (html !== body.innerHTML) body.innerHTML = html;   // 值/缺口/倒计时变了才写 DOM
}

/* 确认层：原版 showConfirm（main.js.src:64618 / 70082）——danger 时标题为「警告 (n/N)」 */
let confirmState = null;
function askSteps(steps, onOk) { confirmState = { steps, i: 0, onOk }; renderConfirm(); }
function askConfirm(textKey, onOk) { askSteps([{ title: '', text: textKey }], onOk); }
let confirmSig = '';
function renderConfirm() {
  const el = $('#confirm');
  const c = confirmState;
  const sig = c ? c.i + ':' + c.steps[c.i].text : '';
  if (sig === confirmSig) return;
  confirmSig = sig;
  if (!c) { el.hidden = true; el.innerHTML = ''; return; }
  const s = c.steps[c.i];
  el.hidden = false;
  el.innerHTML = `<div class="notify-backdrop"></div><div class="notify-panel">
    <h3>${s.title ? T('warning') + ' ' + s.title : T('warning')}</h3>
    <div class="notify-text">${T(s.text)}</div>
    <button class="btn btn-primary notify-close" data-confirm-ok="1">${T('confirm')}</button>
    <button class="btn btn-ghost notify-close" data-confirm-cancel="1">${T('cancel')}</button></div>`;
}

let notifySig = '';
function renderNotification() {
  const el = $('#notify');
  const n = game.imageNotification;
  const sig = n ? n.key + ':' + n.show + ':' + (n.text || '').length : '';
  if (sig === notifySig) return;
  notifySig = sig;
  if (!n || !n.show) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<div class="notify-backdrop"></div>
    <div class="notify-panel">
      <h3>${n.title || ''}</h3>
      <img src="${n.image}" alt="" onerror="this.style.display='none'">
      <div class="notify-text">${n.text || ''}</div>
      <button class="btn btn-primary notify-close" data-notify-close="1">${game.data.name('', 'next')}</button>
    </div>`;
}

/* 难度选择面板：原版 MainStore.showDifficulty（渲染组件 tr，66600-67090）。
   面板**不可关闭**（dt.l onClose: () => {}），必须点 5 张卡之一；选卡 = handleDifficulty(e)
   → SettingsStore.updateDifficultyMode(e) + toggleDifficulty()。 */
const difficultyPanel = () => $('#difficulty');
let diffSig = '';
function renderDifficulty() {
  const el = difficultyPanel();
  if (!el) return;
  const sig = showDifficulty ? 'open:' + game.run.dfc : '';
  if (sig === diffSig) return;
  diffSig = sig;
  if (!showDifficulty) { el.hidden = true; el.innerHTML = ''; return; }
  const cur = game.run.dfc;
  el.hidden = false;
  el.innerHTML = `<div class="notify-backdrop"></div><div class="diff-panel">
    <h3>${T('difficulty')}</h3>
    <div class="diff-grid">${DIFF_CARDS.map((c) => `
      <div class="diff-card ${c.m === cur ? 'sel' : ''} ${c.cls}" data-diff="${c.m}">
        <h5>${T(DIFF[c.m])}</h5>
        <p>${T('difficulty_' + c.m + '_1_description')}</p>
        <ul>${c.items.map((n) => `<li>${T('difficulty_' + c.m + '_' + n + '_description')}</li>`).join('')}</ul>
      </div>`).join('')}</div></div>`;
}

/* 通知堆叠：原版 addNotification → react-toastify #main-toast-container
   （autoClose 8s，death/enemy/battle/spy_success 12s；颜色 blue/epic/legendary/green/red） */
const toastShown = new Map();
const toastClosed = new Set();
function toastClass(color) {
  if (/legendary|orange/.test(color)) return 'legendary';
  if (/epic/.test(color)) return 'epic';
  if (/rare|blue/.test(color)) return 'blue';
  if (/green/.test(color)) return 'green';
  if (/red/.test(color)) return 'red';
  return '';
}
let toastSig = '';
function renderToasts() {
  const el = $('#toasts');
  const all = game.toasts || [];
  const now = Date.now();
  const live = [];
  for (let i = Math.max(0, all.length - 8); i < all.length; i++) {
    const n = all[i];
    if (toastClosed.has(n)) continue;
    let st = toastShown.get(n);
    if (!st) { st = { at: now }; toastShown.set(n, st); }
    if (n.ttl > 0 && now - st.at >= n.ttl) { toastClosed.add(n); continue; }
    live.push([i, n]);
  }
  const okText = (x) => (x && !String(x).startsWith('UNDEFINED_') ? String(x) : '');
  const shown = live.map(([i, n]) => [i, n, okText(n.title), okText(n.body)]).filter(([, , t, b]) => t || b);
  const sig = shown.map(([i, , t, b]) => i + ':' + t + ':' + b).join('|');
  if (sig === toastSig) return;
  toastSig = sig;
  el.innerHTML = shown.map(([i, n, t, b]) => `<div class="tst ${toastClass(n.color || '')}">
    <div class="grow">${t ? `<div class="tt">${t}</div>` : ''}${b ? `<div class="tb">${b}</div>` : ''}</div>
    <button class="tx" data-tst="${i}" aria-label="${game.data.name('', 'close')}">✕</button></div>`).join('');
}

/* 转生面板：原版 LegacyStore.toggleSoftReset（main.js.src:53379）+ 分包 51 的渲染 */
const SOFT_COUNTER = { army_of_goblin: 5, army_of_dragon: 6, fallen_angel_army_1: 7, fallen_angel_army_2: 8,
  orc_horde_boss: 9, mindless_evil_boss: 10, launch_annhilator: 11 };
let softReset = null;   // {title, desc, counter, pre[], closable, success}
function lastBattleLog() {
  const r = (game.save.combatReports || [])[0];
  if (!r) return [];
  const out = [];
  const nameOf = (id, n) => `${n}${T(n > 1 ? 'uni_' + id + '_plural' : 'uni_' + id)}`;
  const sum = r.summary || {};
  const fmtList = (key, head) => {
    const m = sum[key] || {};
    const parts = Object.keys(m).filter((id) => id !== 'settlement_defenses').map((id) => nameOf(id, m[id]));
    return parts.length ? `${T(head)}：${parts.join('，')}` : '';
  };
  const died = fmtList('armyLosses', 'died'), killed = fmtList('enemyLosses', 'killed');
  if (died) out.push(died);
  if (killed) out.push(killed);
  out.push(r.victory ? T('victory') : T('defeat'));
  return out;
}
function openSoftReset({ key = '', counter = 1, success = true, closable = true } = {}) {
  let title = '', desc = '', pre = [];
  if (key !== '') {
    const bossId = key.replace(/^dip_/, '');
    if (SOFT_COUNTER[bossId] !== undefined) counter = SOFT_COUNTER[bossId];
    title = T(key);
    desc = T('soft_reset_description_' + counter + (success ? '_true' : '_false'));
    if ([2, 5, 6, 7, 8, 9, 10].includes(counter)) pre = lastBattleLog();
  }
  softReset = { title, desc, counter, pre, closable, success };
  renderSoftReset();
}
function closeSoftReset() { softReset = null; renderSoftReset(); }
function renderSoftReset() {
  const el = $('#softreset');
  const s = softReset;
  if (!s) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const res = ['relic', 'coin', 'tome_wisdom', 'gem', 'titan_gift', 'light']
    .map((id) => [id, Math.round(game.resourceValue(id))]).filter(([, v]) => v > 0);
  const legacies = (game.data.legacies || []).filter((l) => game.reqgen.checkReq('legacy', l.id, l, false));
  const body = `
    ${s.pre.length ? `<div class="alert ${s.success ? 'victory' : 'war'}">${s.pre.join(' ')}
      <button class="btn btn-sm" data-act="combat-reports">${T('combat_reports')}</button></div>` : ''}
    <div class="desc">${s.desc}</div>
    <div class="lpoints">${T('legacy_points')}：${fmt(game.legacyPoints)}</div>
    ${res.length ? `<div class="reslist">${res.map(([id, v]) => `<div class="kv2"><span>${resName(id)}</span><span>${v}</span></div>`).join('')}</div>` : ''}
    ${legacies.length ? `<div class="sec-title">${T('res_legacy')}</div>
      <div class="card">${legacies.map((l) => `<div class="legrow">
        <div class="grow"><div class="t">${game.data.name('leg_', l.id)}</div>
        <div class="s">${game.data.name('leg_', l.id + '_description')}</div></div>
        <button class="btn btn-sm ${selectedLegacies.has(l.id) ? 'btn-primary' : ''}" data-legsel="${l.id}">${game.data.name('leg_', l.id)}</button>
      </div>`).join('')}</div>` : ''}`;
  el.innerHTML = `<div class="sreset-backdrop"></div><div class="sreset-panel">
    <h3>${s.title}</h3>
    <div id="softreset-body">${body}</div>
    <button id="softreset-ok" class="btn sreset-ok" data-softreset="1">${T('prestige')}</button>
    ${s.closable ? `<button class="btn btn-ghost sreset-close" data-softreset-close="1">${T('close')}</button>` : ''}
  </div>`;
}
// 转生三步确认（原版分包 51 handleSoftReset1/2/3 → MainStore.softReset）
function confirmSoftReset() {
  askSteps([
    { title: '(1/3)', text: 'soft_reset_confirm_1' },
    { title: '(2/3)', text: 'soft_reset_confirm_2' },
    { title: '(3/3)', text: 'soft_reset_confirm_3' },
  ], () => {
    const sel = [...selectedLegacies];
    selectedLegacies.clear();
    closeSoftReset();
    game.bossResetPrompt = null;
    game.softReset(sel);
    game.achievements.checkPersistent();
    toastSig = '';
    renderTop(true); renderTabs(); renderView(); renderNotification();
  });
}

/* ==================== 详情面板 ==================== */
function detailRows(kind, id) {
  if (kind === 'res') return [['', `${fmt(game.resourceValue(id))} / ${fmt(game.capOf(id))}`], ['', `${game.perSecond(id).toFixed(2)}/秒`]];
  if (kind === 'bui') { const b = game.data.byId.building.get(id); return [['', game.data.name('bui_', b.id)], ['', reqLine(b.req, game.reqgen.checkOwned('building', id), true, '、')], ['', (b.gen || []).map(fmtGen).join('、')]]; }
  if (kind === 'tec') { const t = game.data.byId.tech.get(id); return [['', game.data.name('tec_', t.id)], ['', reqLine(t.req, game.reqgen.checkOwned('tech', id), true, '、')], ['', (t.gen || []).map(fmtGen).join('、')]]; }
  if (kind === 'pra') { const p = game.data.byId.prayer.get(id); return [['', game.data.name('fai_', p.id)], ['', reqLine(p.req, game.reqgen.checkOwned('prayer', id), true, '、')], ['', (p.gen || []).map(fmtGen).join('、')]]; }
  if (kind === 'uni') { const u = game.data.byId.unit.get(id); return [['', `${game.data.name('', 'attack_abbr')} ${u.attack}　${game.data.name('', 'defense_abbr')} ${u.defense}`], ['', u.category >= 1 && u.category <= 4 ? game.data.name('', 'uni_cat_' + u.category) : ''], ['', [u.splash ? game.data.name('', 'splash') + ' ' + u.splash : '', u.trample ? game.data.name('', 'trample') + ' ' + u.trample : ''].filter(Boolean).join(' ')], ['', (u.reqAttack || []).map(fmtReq).join('、')]]; }
  if (kind === 'ene') { const e = game.data.byId.expedition.get(id); return [[game.data.name('ene_', id)], ['', (e.army || []).map((a) => `${game.data.name('uni_', a.id)}×${a.value}`).join('、')], ['', (e.gen || []).map(fmtGen).join('、')]]; }
  if (kind === 'ach') { const a = game.data.byId.achievement.get(id); return [['', (a?.gen || []).map(fmtGen).join('、')], ['', (a?.req || []).map(fmtReq).join('、')], [game.data.name('', 'unlocked'), (() => { const o = (game.save.ach || []).find((x) => (x.id || x) === id); return o?.date ? new Date(o.date).toLocaleString('zh-CN') : ''; })()]]; }
  if (kind === 'dip') { const d = game.data.byId.diplomacy.get(id); return [[game.data.name('dip_', id)], ['', (d.army || []).map((a) => `${game.data.name('uni_', a.id)}×${a.value}`).join('、')]]; }
  return [];
}

/* ==================== 交互 ==================== */
// 队列入队（原版 addQueue：SettingsStore.autoOpenQueue 默认 true → 自动打开队列面板）
function addToQueue(cat, id) {
  const ok = game.queue.add(cat, id, strictOrder);
  if (ok) openQueue();
  return ok;
}
function doBuild(id) {
  const ok = game.build(id);
  if (!ok) addToQueue('building', id);   // 原版：资源/前置不足时静默入队 renderTop(true); renderView();
  return ok;
}
function doResearch(id) {
  const ok = game.research(id);
  if (!ok) addToQueue('tech', id); renderTop(true); renderView();
  return ok;
}
// 手动采集（原版桌面端 hover 每秒 +1；移动端映射为按住每秒 +1，单击仍 +1）
let gatherTimer = null, gatherId = null;
function startGather(id) {
  if (gatherTimer) clearInterval(gatherTimer);
  gatherId = id;
  gatherTimer = setInterval(() => {
    if (!gatherId) return;
    const got = game.manualGather(gatherId);
    if (got) { renderTop(true); renderView(); }
  }, 1000);
}
function stopGather() { if (gatherTimer) clearInterval(gatherTimer); gatherTimer = null; gatherId = null; }

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-tab],[data-ancestor],[data-gather],[data-act],[data-detail],[data-close],[data-build],[data-research],[data-recruit],[data-attack],[data-oracle],[data-job],[data-away],[data-order],[data-scout],[data-queue],[data-queue-open],[data-queue-close],[data-qstrict],[data-unqueue],[data-legacy],[data-defend],[data-war],[data-mkt],[data-notify-close],[data-ach-tab],[data-prayer],[data-confirm-ok],[data-confirm-cancel],[data-dismiss],[data-delegation],[data-army],[data-dip],[data-donate],[data-btab],[data-ttab],[data-atab],[data-spellfilter],[data-spy-pick],[data-spy-target],[data-spy-start],[data-softreset],[data-softreset-close],[data-softreset-open],[data-softreset2],[data-legsel],[data-tst],[data-diff]');
  if (!t) return;
  const d = t.dataset;
  if (d.ancestor) {   // 原版 AncestorsStore.updateAncestor：写入 + 跑 gen + 首启成就检查
    game.chooseAncestor(d.ancestor);
    // 注意：原版 updateAncestor（39779）**不碰** flagd；flagd 归零只发生在选祖界面挂载时
    // （Sa.componentDidMount → updateDifficultyFlag(0)，72486），复刻在启动时按 needAncestor() 做了。
    game.achievements.checkPersistent();             // 原版 runAchievement(prestige/ng_reset/annihilator) renderTop(true); renderTabs(); renderView(); renderNotification(); return;
  }
  if (d.diff !== undefined) {   // 原版 handleDifficulty：SettingsStore.updateDifficultyMode(e) + 关面板
    game.updateDifficultyMode(Number(d.diff));
    showDifficulty = false; renderDifficulty();
    renderTop(); renderView(); return;
  }
  if (d.tab) { tab = d.tab; renderTabs(); renderView(); return; }
  if (d.btab) { buildTab = Number(d.btab); renderView(); return; }
  if (d.atab) { armyTab = d.atab; renderView(); return; }
  if (d.ttab) { techTab = d.ttab; renderView(); return; }
  if (d.spellfilter) { spellFilter = d.spellfilter; try { localStorage.setItem('filterSpells', JSON.stringify(spellFilter)); } catch {} renderView(); return; }
  if (d.notifyClose) { game.closeNotification(); renderNotification(); renderTabs(); renderView(); return; }
  if (d.confirmOk) {
    const c = confirmState;
    if (c && c.i < c.steps.length - 1) { c.i++; renderConfirm(); return; }
    confirmState = null; renderConfirm();
    if (c) c.onOk();
    renderTop(); renderView(); return;
  }
  if (d.confirmCancel) { confirmState = null; renderConfirm(); return; }
  if (d.close !== undefined) return closeSheet();
  if (d.queueOpen) { openQueue(); return; }
  if (d.queueClose) { queueOpen = false; renderQueuePanel(); return; }
  if (d.qstrict) {
    strictOrder = !strictOrder;
    localStorage.setItem('queueStrictOrder', JSON.stringify(strictOrder));
    for (const it of game.run.queue || []) it.strictOrder = strictOrder;   // 原版是全局开关
    renderQueuePanel(); renderView(); return;
  }
  if (d.unqueue) { game.queue.delete(d.unqueue); renderQueuePanel(); renderView(); return; }
  if (d.tst) {
    const n = (game.toasts || [])[Number(d.tst)];
    if (n) toastClosed.add(n);
    toastSig = ''; renderToasts(); return;
  }
  if (d.softresetOpen) {
    const key = d.softresetOpen;
    const counter = key === 'tec_glorious_retirement' ? 1 : key === 'tec_theresmore_richest_nation' ? 3 : key === 'ascension' ? 4 : 1;
    openSoftReset({ key, counter, success: true, closable: true }); return;
  }
  if (d.softreset2) {   // 亡者之门（原版 handleSoftReset2：flag 0 先确认再打，否则直接走转生面板）
    if (game.run.flag === 0) {
      askConfirm('soft_reset_2_confirm', () => { game.softReset2Fight(); openSoftReset({ key: 'tec_portal_of_the_dead', counter: 2, success: game.run.flag === 1, closable: true }); renderTop(true); renderTabs(); renderView(); });
    } else if (game.run.flag === 1) openSoftReset({ key: 'tec_portal_of_the_dead', counter: 2, success: true, closable: true });
    else openSoftReset({ key: 'tec_portal_of_the_dead', counter: 2, success: false, closable: true });
    return;
  }
  if (d.softreset) { confirmSoftReset(); return; }
  if (d.softresetClose) { closeSoftReset(); return; }
  if (d.legsel) {
    if (selectedLegacies.has(d.legsel)) selectedLegacies.delete(d.legsel); else selectedLegacies.add(d.legsel);
    renderSoftReset(); return;
  }
  if (d.dip) {   // 原版：按钮点击后有 3 秒假进度
    const [id, act] = d.dip.split(':'); const g = game;
    t.classList.add('btn-progress'); t.disabled = true;
    setTimeout(() => { t.classList.remove('btn-progress'); t.disabled = false; }, 3000);
    if (act === 'improve') g.improveRelationship(id);
    else if (act === 'insult') g.insultRelationship(id);
    else if (act === 'trade') g.toggleTrade(id);
    else if (act === 'alliance') g.toggleAlliance(id);
    renderTop(); renderView(); return; }
  if (d.donate) { const [id, n] = d.donate.split(':'); game.donateMausoleum(id, n === 'all' ? Infinity : Number(n)); renderTop(); renderView(); return; }
  if (d.army) {
    if (d.army === 'save-preset') game.saveArmyPreset();
    else if (d.army === 'build-preset') game.buildArmyPreset();
    else if (d.army === 'add-all') game.addAllAway();
    else if (d.army === 'remove-all') game.removeAllAway();
    else if (d.army === 'sort-toggle') game.toggleBattleOrderSort();
    renderTop(); renderView(); return;
  }
  if (d.dismiss) { game.dismiss(d.dismiss, 1); renderTop(); renderView(); return; }
  if (d.delegation) { game.sendDelegation(d.delegation); renderTop(); renderView(); return; }
  if (d.prayer) {   // 咒语=可开关（分包 673 handleToggleSpell）；祈祷=一次性购买，资源不足时入队（main.js.src:55999）
    const def = game.data.byId.prayer.get(d.prayer);
    if (def && def.type === 'spell') game.magic.toggleSpell(d.prayer);
    else {
      const q0 = (game.run.queue || []).length;
      game.magic.addPrayer(d.prayer);
      if ((game.run.queue || []).length > q0) openQueue();   // 原版 autoOpenQueue 默认 true
    }
    renderTop(); renderView(); return;
  }
  if (d.gather) { game.manualGather(d.gather); renderTop(true); renderView(); return; }
  if (d.achTab) { game._achTab = d.achTab; renderView(); return; }
  if (d.act === 'res-panel') {   // 点顶部整块资源面板：展开/收起（状态记忆在 localStorage）
    resPanelOpen = !resPanelOpen;
    try { localStorage.setItem('resPanelOpen', JSON.stringify(resPanelOpen)); } catch {}
    renderTop(true);
    return;
  }
  if (d.act === 'toggle-missing') { game._showMissingAch = !game._showMissingAch; renderView(); return; }
  if (d.act === 'combat-reports') { openSheet(game.data.name('', 'combat_reports'), (game.save.combatReports || []).slice(0, 5).map((r) => [game.data.name('dip_', r.enemyId) || game.data.name('ene_', r.enemyId), `${r.victory ? game.data.name('', 'victory') : game.data.name('', 'defeat')}　${game.data.name('', 'rounds') || ''} ${r.rounds ?? ''}`])); return; }
  if (d.act === 'export') { const s = game.serialize(); navigator.clipboard?.writeText(s); return; }
  if (d.act === 'import') { const s = prompt(game.data.name('', 'paste_here')); if (!s) return; try { game = new Game({ data, save: JSON.parse(s) }); window.__game = game; renderTop(); renderTabs(); renderView(); } catch (e) { console.error(e); } return; }
  if (d.act === 'change-difficulty') {   // 原版 handleChangeDifficulty1/2（68329-68345）：两步确认后打开难度面板
    if (game.run.flagd === 2) return;
    askSteps([
      { title: '(1/2)', text: 'change_difficulty_1' },
      { title: '(2/2)', text: 'change_difficulty_2' },
    ], () => { showDifficulty = true; diffSig = ''; renderDifficulty(); });
    return;
  }
  if (d.act === 'reset') {   // 原版 handleHardReset1/2/3：三步确认
    askSteps([
      { title: '(1/3)', text: 'hard_reset_confirm_1' },
      { title: '(2/3)', text: 'hard_reset_confirm_2' },
      { title: '(3/3)', text: 'hard_reset_confirm_3' },
    ], () => { localStorage.removeItem('theresmore-replica'); location.reload(); });
    return;
  }
  if (d.build) { doBuild(d.build); return; }
  if (d.research) { doResearch(d.research); return; }
  if (d.recruit) { game.recruit(d.recruit, Number(d.n || 1)); renderTop(); renderView(); return; }
  if (d.job) { game.assignJob(d.job, Number(d.delta)); renderTop(); renderView(); return; }
  if (d.away) { const row = game.run.army.find((a) => a.id === d.away); if (row) { game.setAway(d.away, row.away + Number(d.delta)); renderView(); } return; }
  if (d.order) {
    const o = game.run.armyOrder || (game.run.armyOrder = { away: [], defense: [] });
    const i = o.away.indexOf(d.order);
    if (i === -1) o.away.push(d.order);
    else { const j = i + Number(d.dir); if (j >= 0 && j < o.away.length) { [o.away[i], o.away[j]] = [o.away[j], o.away[i]]; } }
    renderView(); return;
  }
  if (d.scout) { game.startScout(); renderTop(); renderView(); return; }
  if (d.queue) { const [cat, id] = d.queue.split(':'); addToQueue(cat, id); renderView(); return; }
  if (d.legacy) { game.addLegacy(d.legacy); renderTop(); renderView(); return; }
  if (d.act === 'reset-ng') { askConfirm('new_game_plus_confirm_1', () => { game.newGamePlus(); renderTop(true); renderTabs(); renderView(); }); return; }
  if (d.war) { game.declareWar(d.war); renderTop(); renderView(); return; }
  if (d.mkt) { const [act, id, n] = d.mkt.split(':'); act === 'buy' ? game.market.buy(id, Number(n)) : game.market.sell(id, Number(n)); renderTop(); renderView(); return; }
  if (d.defend) { const r = game.defend(d.defend); renderTop(); renderView(); return; }
  if (d.attack) { game.startAttack(d.attack); renderTop(); renderView(); return; }
  if (d.oracle) { game.startOracle(d.oracle); renderTop(); renderView(); return; }
  if (d.spyPick) {
    const opts = enemyOptions();
    if (opts.length) openPick(T('enemies'), opts);
    return;
  }
  if (d.spyTarget) { game.updateSpy(d.spyTarget); closeSheet(); renderTop(); renderView(); return; }
  if (d.spyStart) { game.startSpy(); renderTop(); renderView(); return; }
  if (d.detail) { const [kind, id] = d.detail.split(':'); openSheet(game.data.name({ res: 'res_', bui: 'bui_', tec: 'tec_', uni: 'uni_', ene: 'ene_', dip: 'dip_', pra: 'fai_', ach: 'not_' }[kind], id), detailRows(kind, id), { kind, id }); }
});
// 手动采集：按住每秒 +1（原版桌面端 hover 每秒 +1 的移动端映射）
document.addEventListener('pointerdown', (ev) => {
  const b = ev.target.closest('[data-gather]');
  if (!b) return;
  startGather(b.dataset.gather);
});
for (const e of ['pointerup', 'pointercancel', 'pointerleave']) {
  document.addEventListener(e, (ev) => { if (ev.target.closest && ev.target.closest('[data-gather]')) stopGather(); }, true);
}
document.addEventListener('contextmenu', (ev) => { if (ev.target.closest && ev.target.closest('[data-gather]')) ev.preventDefault(); });

/* 长按查看详情（触屏无 hover） */
let lp = null;
document.addEventListener('touchstart', (ev) => {
  const row = ev.target.closest('[data-detail]');
  if (!row) return;
  lp = setTimeout(() => { const [k, id] = row.dataset.detail.split(':'); openSheet(game.data.name({ res: 'res_', bui: 'bui_', tec: 'tec_', uni: 'uni_', ene: 'ene_', dip: 'dip_', pra: 'fai_' }[k], id), detailRows(k, id), { kind: k, id }); lp = null; }, 450);
}, { passive: true });
for (const e of ['touchend', 'touchmove', 'touchcancel']) document.addEventListener(e, () => { if (lp) { clearTimeout(lp); lp = null; } }, { passive: true });

/* ==================== 视图自动刷新（低频、可控） ====================
   原版是 React 订阅 store 变化即时重绘；复刻版没有订阅机制，这里用"离散状态签名"在
   frame() 里做脏检查：签名变化才重画，且 350ms 节流（≈3Hz），不每帧重画。 */
const lastRes = new Map();
function commitRes() { for (const row of game.run.resources || []) lastRes.set(row.id, row.value); }
/* 「买得起」指纹：资源只会随时间上涨，而 viewSig 以前只记录资源**骤降**，
   于是"资源够了但建造按钮还禁用"要等到别的状态变化才刷新（用户实测："过一下又可以点击"）。
   这里按当前页签算一份"可买集合"，它一变就重画；250ms 缓存，避免每帧都做全表 checkReq。 */
let _affordAt = 0, _affordKey = '', _affordSig = '';
function affordSig(now) {
  const key = `${tab}|${buildTab}|${techTab}`;
  if (key === _affordKey && now - _affordAt < 250) return _affordSig;
  let sig = '';
  if (tab === 'build') {
    const a = buildableBuildings(), c = buildableCapBuildings();
    sig = 'B' + a.length + ':' + c.length + ':' + a.map((x) => x.id).join(',');
  } else if (tab === 'tech') {
    const a = buildableTechs();
    sig = 'T' + a.length + ':' + a.map((x) => x.id).join(',');
  } else if (tab === 'magic') {
    sig = 'M' + visiblePrayers().filter((x) => game.reqgen.checkReq('prayer', x.id, x)).length;
  } else if (tab === 'army') {
    sig = 'A' + visibleArmy().filter((x) => game.reqgen.checkReq('army', x.id, x)).length;
  } else if (tab === 'dip') {
    sig = 'D' + visibleDiplomacy().filter((x) => game.reqgen.checkReq('diplomacy', x.id, x)).length;
  }
  _affordAt = now; _affordKey = key; _affordSig = sig;
  return sig;
}
function viewSig(now = performance.now()) {
  const r = game.run;
  // 资源"骤降"（非生产增长）也要触发重画：防守战失败清零、被消耗等
  // 注意：这里只读快照，快照只在真正重画后提交（commitRes），否则骤降信号会被自己吞掉
  let drop = '';
  for (const row of r.resources || []) {
    const prev = lastRes.get(row.id);
    if (prev !== undefined && row.value < prev - 1) drop += row.id + ',';
  }
  return [needAncestor(), r.flag, r.flagb, r.boss, (r.queue || []).length, (r.techs || []).length,
    (r.buildings || []).length, (r.army || []).length, (r.diplomacy || []).length,
    (r.population || []).length, (r.prayers || []).length, (r.spells || []).length,
    (game.logs || []).length, (game.toasts || []).length, drop,
    game.attackInProgress ? Math.round(game.attackInProgress.attack) : '',
    Math.floor(r.donation || 0), (game.save.ach || []).length, showMarket(), showMagic(),
    game.exploreInProgress, game.spyInProgress, game.attackRunInProgress, r.spy,
    (game.save.leg || []).length, tab, buildTab, techTab,
    Math.floor(game.resourceValue('queue_slot') || 0), affordSig(now)].join('|');
}
let lastSig = null;

/* ==================== 主循环 ==================== */
/* 原版的游戏循环跑在 Web Worker 里（main.js.src:6166/64745），切到后台也会继续跑；而且它按
   "真实经过时间"积分产量（_processInterval 64758：t = performance.now() - lastInterval）。
   复刻用 requestAnimationFrame，后台会被浏览器暂停 → 这里在回到前台时按真实时间补算，
   效果与原版一致（关闭标签页另算，见启动处的 offline 资源）。
   上限 8 小时与原版 offline 资源上限一致；分片推进避免一次补太久卡住界面
   （产量按时间线性积分，分片大小不影响资源总量；对"每 tick 一次"的外交倒计时是近似）。 */
const CATCHUP_MAX_MS = 8 * 3600 * 1000;
function catchUp(elapsedReal) {
  const total = Math.min(Math.max(0, elapsedReal), CATCHUP_MAX_MS);
  if (total < 250) return 0;
  const step = total > 30 * 60 * 1000 ? 5000 : Math.max(250, game.intervalMs);
  let left = total, ticks = 0;
  while (left > 0 && ticks < 40000) {
    const stepReal = Math.min(left, step);
    game.tick(stepReal * game.clock.scale);
    left -= stepReal; ticks++;
  }
  return total;
}
window.__catchUp = catchUp;   // 自动化测试用（和 __fmt/__game 一类）
function resumeFromBackground() {
  const now = performance.now();
  const real = now - lastFrame;
  lastFrame = now;
  if (real > 250) catchUp(real);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) resumeFromBackground(); });
window.addEventListener('pageshow', resumeFromBackground);
window.addEventListener('focus', resumeFromBackground);

function frame(now) {
  const real = now - lastFrame;
  lastFrame = now;
  const err = (where, e) => (window.__viewErrs ||= []).push(where + ': ' + (e && e.message ? e.message : e));
  try {
    if (real > 2000) catchUp(real);                   // 刚回到前台（rAF 被暂停过）→ 补算
    else game.tick(real * game.clock.scale);
  } catch (e) { err('tick', e); }
  try { renderTop(); renderNotification(); renderConfirm(); renderDifficulty(); renderToasts(); } catch (e) { err('overlay', e); }
  try { if (now - (window.__sheetAt || 0) > 250) { window.__sheetAt = now; refreshSheet(); } } catch (e) { err('sheet', e); }
  // 转生面板：原版 LegacyStore 构造函数（main.js.src:52831）
  //   flag===2 → softReset2Confirm(3)；flagb===2 → toggleSoftReset("dip_"+boss, 0, false)
  try {
    if (!softReset) {
      if (game.run.flag === 2) openSoftReset({ key: 'tec_portal_of_the_dead', counter: 2, success: false, closable: false });
      else if (game.run.flagb === 2) {
        const id = game.bossResetPrompt?.id || game.run.boss || '';
        if (id) openSoftReset({ key: 'dip_' + id, counter: game.bossResetPrompt?.counter || 0, success: false, closable: false });
      }
    } else if (softReset.closable === false && game.run.flag !== 2 && game.run.flagb !== 2) {
      closeSoftReset();   // 状态已恢复（例如已转生）→ 面板自动收起
    }
  } catch (e) { err('softreset', e); }
  // 低频视图刷新：离散状态签名变化 + 350ms 节流（≈3Hz），避免每帧重画/丢输入焦点
  try {
    const sig = viewSig(now);
    if (sig !== lastSig) {
      const ae = document.activeElement;
      const typing = ae && ae.tagName === 'INPUT' && $('#view').contains(ae);
      // 节流：只有真正重画时才提交签名与资源快照，否则这次变化会被永久吞掉
      if (!typing && now - lastViewRender > 350) {
        lastSig = sig; commitRes();
        renderTabs(); renderView(); renderQueuePanel();
      }
    }
  } catch (e) { err('view', e); }
  requestAnimationFrame(frame);
}
// 原版开局难度的强制流程：
//   · MainStore 构造末尾 `0 === SettingsStore.difficultyFlag && toggleDifficulty()`（64293）→ flagd=0 就弹面板
//   · 选祖界面 Sa.componentDidMount 每次冷启动都 `updateDifficultyFlag(0)`（72487）→ 只要还在选祖界面就重弹
//     （已选完祖先进入主界面后不再重弹；dfc 会保留，面板会把上次选择高亮出来）
if (needAncestor()) game.run.flagd = 0;
if (game.run.flagd === 0) showDifficulty = true;
renderDifficulty();
renderTabs(); renderTop(); renderView(); renderQueuePanel(); requestAnimationFrame(frame);
setInterval(() => { if (game.autoSave) game.saveToStorage(); }, 5000);
window.addEventListener('beforeunload', () => {
  try { localStorage.setItem('last', JSON.stringify(Date.now())); } catch {}   // 原版 _initOfflineProgress
  game.saveToStorage();
});
