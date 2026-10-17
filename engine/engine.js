// 复刻引擎核心：DOM 无关，可在 Node 里跑（测试用虚拟时钟 + 种子随机）
// 规则来源：main.js.src（1.2.2）逐行还原，见 spec/*.md
import { emptySave, newRun, DATA_VERSION } from './state.js';
import { Modifiers } from './modifiers.js';
import { Resources } from './resources.js';
import { ReqGen } from './reqgen.js';
import { simulate } from './combat.js';
import { Queue } from './queue.js';
import { Achievements } from './achievements.js';
import { Explore } from './explore.js';
import { Spy } from './spy.js';
import { Magic } from './magic.js';
import { Market } from './market.js';
import { makeRng } from './rng.js';
import { Clock } from './clock.js';

export class Game {
  constructor({ data, save = null, seed = 1, clock = null, difficultyMode = 0, autoSave = true } = {}) {
    this.data = data;
    this.rng = makeRng(seed);
    this.clock = clock || new Clock();
    this.autoSave = autoSave;
    this.save = save || emptySave({ difficultyMode });
    this._rebuildIdx();
    this.log = [];
    this._initCaps();
    // 派生 store（与原版 MainStore.xxxStore 对应）
    this.stats = { resetNumber: 0, ngResetNumber: 0, ngResetBonus: 0, annLaunchNumber: 0 };
    this._setResetNumber();
    this.legacies = this.save.leg || [];
    this.modifiers = new Modifiers(this);
    this.resources = new Resources(this);
    this.reqgen = new ReqGen(this);
    this.buildings = { destroyBuilding: (id, silent) => this.destroyBuilding(id, silent) };
    this._simulate = simulate;
    this.checkEmptyMana = 0; this.checkEmptyOffline = 0;
    this.initArmyOrder();                  // 原版：载入存档后初始化 armyOrder（43821+）
    // —— 任务状态机（对应 ArmyStore 构造，main.js.src:42177-42206）——
    this.waitTimeOracle = 5000;            // 原版 waitTimeOracle = 5e3
    this.progressScout = 0; this.progressAttack = 0; this.progressSpy = 0; this.progressOracle = 0;
    this.exploreInProgress = false; this.spyInProgress = false;
    this.attackRunInProgress = false; this.oracleInProgress = false;   // ★ 原版 ArmyStore.attackInProgress（玩家出征）
    this._missions = { scout: null, spy: null, attack: null, oracle: null };
    this.queue = new Queue(this);
    this.achievements = new Achievements(this);
    this.explore = new Explore(this);
    this.spyStore = new Spy(this);   // 间谍任务实现（对应原版 ArmyStore 的 spy 部分）
    this.magic = new Magic(this);
    this.market = new Market(this);
    this._processQueue = () => this.queue.process();   // 战斗模拟器（1:1 移植，已用真机 15/15 验证）
  }
  // 对应 SettingsStore.setIntervalValues（源码 63592）：batteryMode 0/1/2 → intervalMs 250/1000/2000
  get intervalMs() {
    const b = this.run.batteryMode ?? 0;
    return b === 0 ? 250 : b === 1 ? 1000 : 2000;
  }
  // 对应 SettingsStore.difficultyMode（源码 63537-63540 初始化自 run.dfc；63582 写入时两者同步）
  // 与 difficultyFlag（63533-63536 镜像 run.flagd）：复刻里 run.dfc/run.flagd 就是唯一真相，这两个访问器只是别名。
  get difficultyMode() { return this.run.dfc ?? 0; }
  set difficultyMode(v) { this.run.dfc = v; }
  get difficultyFlag() { return this.run.flagd ?? 0; }
  set difficultyFlag(v) { this.run.flagd = v; }
  // 对应 MainStore.showOracle（main.js.src:64674）：只有"容易(99)/普通(0)"能询问神谕
  get showOracle() { return this.run.dfc === 99 || this.run.dfc === 0; }
  // 对应 SettingsStore.updateDifficultyFlag（main.js.src:63589）：写 run.flagd 并落盘
  updateDifficultyFlag(f) { this.run.flagd = f; this.saveToStorage(); return f; }
  // 对应 SettingsStore.updateDifficultyMode（main.js.src:63579-63587）：
  //   flagd===2 → 锁定后无操作；否则同步写 run.dfc/difficultyMode，并把 flagd 推进：
  //   首次选择 0→1；已选过(1)且值真的变了 → 1→2（本局锁定，之后只能靠转生/超转生/软重置）
  updateDifficultyMode(m) {
    if (this.run.flagd === 2) return false;
    const changed = this.difficultyMode !== m;
    this.difficultyMode = m;
    if (this.run.flagd === 1) { if (changed) this.updateDifficultyFlag(2); else this.saveToStorage(); }
    else this.updateDifficultyFlag(1);
    return true;
  }
  // 对应 ArmyStore 构造 42199-42203：waitTime=6e4，每超转生一次减半，下限 3000
  get waitTime() {
    let w = 60000;
    for (let i = 0; i < this.stats.ngResetNumber; i++) w /= 2;
    return Math.max(3000, w);
  }

  /* ---------------- 索引（与原版 idxs 一致，便于导入原版存档） ---------------- */
  _rebuildIdx() {
    const s = this.save;
    s.idxs = s.idxs || { resources: {}, caps: {}, buildings: {}, army: {} };
    s.idxs.resources = {};
    s.run.resources.forEach((r, i) => { s.idxs.resources[r.id] = i; });
    s.idxs.caps = {};
    s.run.caps.forEach((c, i) => { s.idxs.caps[c.id] = i; });
    s.idxs.buildings = {};
    (s.run.buildings || []).forEach((b, i) => { s.idxs.buildings[b.id] = i; });
    s.idxs.army = {};
    (s.run.army || []).forEach((a, i) => { s.idxs.army[a.id] = i; });
    s.idxs.techs = {};
    (s.run.techs || []).forEach((t, i) => { s.idxs.techs[t.id] = i; });
  }
  get run() { return this.save.run; }
  get idxs() { return this.save.idxs; }

  /* ---------------- 上限 / 资源（对应 ResourcesStore） ---------------- */
  _initCaps() {
    for (const def of this.data.resources) {
      if (typeof def.cap === 'number' && typeof this.idxs.caps[def.id] === 'undefined') {
        this.idxs.caps[def.id] = this.run.caps.push({ id: def.id, value: def.cap }) - 1;
      }
    }
  }
  capOf(id) {
    const i = this.idxs.caps[id];
    if (typeof i !== 'undefined') return this.run.caps[i].value;
    const def = this.data.byId.resource.get(id);
    return def && typeof def.cap === 'number' ? def.cap : 0;
  }
  setCap(id, v) {
    const i = this.idxs.caps[id];
    if (typeof i === 'undefined') { this.idxs.caps[id] = this.run.caps.push({ id, value: v }) - 1; }
    else this.run.caps[i].value = v;
  }
  ensureResource(id) {
    if (typeof this.idxs.resources[id] !== 'undefined') return this.idxs.resources[id];
    const row = { id, value: 0, manual: 1, timer: 0, timern: 0, perc: 0, percMul: 0 };
    const i = this.run.resources.push(row) - 1;
    this.idxs.resources[id] = i;
    return i;
  }
  resourceValue(id) {
    const i = this.idxs.resources[id];
    return typeof i === 'undefined' ? 0 : this.run.resources[i].value;
  }
  // 对应 addResource：超过上限截断、保留 2 位小数、不存在则创建
  addResource(id, amount = 1) {
    const cap = this.capOf(id);
    const i = this.ensureResource(id);
    const row = this.run.resources[i];
    const before = row.value;
    let v = Math.round((before + amount) * 100) / 100;
    if (cap > 0 && v > cap) v = cap;
    if (v < 0) { this.removeNegativePopulation(id); v = 0; }
    row.value = v;
    if (id === 'fame') this.addResource('legacy', amount / 100);   // 源码 63448：声誉的 1/100 进传承
    if (v !== before) this.processQueue();
    return v - before;
  }
  // 对应 useResource（main.js.src:63380）：不够整笔失败；直接扣值，不走 addResource
  useResource(id, amount) {
    if (this.resourceValue(id) < amount) return false;
    const i = this.ensureResource(id);
    this.run.resources[i].value -= amount;
    this.processQueue?.();
    return true;
  }
  setResource(id, v) { const i = this.ensureResource(id); this.run.resources[i].value = v; }
  /* ---------------- 手动采集（对应 ResourcesStore，main.js.src:63229/63243/63404） ----------------
   * 原版：`addResourceManual = throttle(100, addResourceManualThrottle, { noTrailing: true })`
   *   → 100ms 内的重复调用被直接丢弃（不排队、不补发），实测 4ms 内点 10 次只 +1。
   * 采集入口：`showManual = !checkOwned('tech','feudalism',1)`，研究出封建制度后整块消失。
   */
  get showManual() { return !this.reqgen.checkOwned('tech', 'feudalism', 1); }
  get manualResources() {
    return this.showManual ? this.data.resources.filter((r) => !(r.hidden || !r.manual)) : [];
  }
  manualGather(id) {
    const now = this.clock.now;
    if (typeof this._lastManualGatherAt === 'number' && now - this._lastManualGatherAt < 100) return 0;
    this._lastManualGatherAt = now;
    const i = this.ensureResource(id);
    const amt = this.run.resources[i].manual || 1;
    return this.addResource(id, amt);
  }

  /* ---------------- 统计（对应 StatsStore._setResetNumber，main.js.src:63868） ---------------- */
  _setResetNumber() {
    const st = this.save.stats || [];
    const get = (id) => { const i = st.findIndex((x) => x.id === id); return i === -1 ? undefined : st[i].value; };
    this.stats.resetNumber = get('reset') ?? 0;
    const ng = get('ng_reset');
    if (ng !== undefined) { this.stats.ngResetNumber = ng; this.stats.ngResetBonus = get('ng_bonus') ?? 0; }
    else { this.stats.ngResetNumber = 0; this.stats.ngResetBonus = 0; }
    this.stats.annLaunchNumber = get('ann_launch') ?? 0;
  }
  updateStat(id, delta) {
    this.save.stats ||= [];
    const i = this.save.stats.findIndex((x) => x.id === id);
    if (i !== -1) this.save.stats[i].value += delta; else this.save.stats.push({ id, value: delta });
    if (id === 'reset' || id === 'ng_reset' || id === 'ann_launch') this._setResetNumber();
  }
  /* ---------------- 派生量 ---------------- */
  baseCap(id) { const def = this.data.byId.resource.get(id); return def && typeof def.cap === 'number' ? def.cap : 0; }
  perSecond(id) { return this.resources.getTimerValue(id); }   // 与源码 getTimerValue 完全一致
  populationTotal(jobId) { const r = (this.run.population || []).find((p) => p.id === jobId); return r ? r.value : 0; }
  addPopulation(n) {
    this.run.population ||= [];
    let i = this.run.population.findIndex((p) => p.id === 'unemployed');
    if (i === -1) i = this.run.population.push({ id: 'unemployed', value: 0 }) - 1;
    this.run.population[i].value += n;
    this.modifiers.recalcAllPopulation();
  }
  populationUpdateCap(jobId, delta) { this.resources.updateCap(jobId, delta); }
  /* ---------------- 科技（对应 TechsStore.addTech，main.js.src:63960） ----------------
   * ★ 判定顺序与原版逐行一致（实测 orig 页面，见 build/compare/修复-引擎.md 第 1 条）：
   *   1) 先 ReqGenStore.useResources("tech", id) —— 资源足够就**先扣**；
   *   2) 再判 `idxs.techs[id] !== undefined`（是否已拥有）：已拥有直接 return false，
   *      不 push、不 runGen、不发图片通知、不写日志/成就（费用已扣，与原版一致）；
   *   3) 新科技才走 图片/BOSS/外交钩子链 → runGen → 成就 → addLog("tec_"+id)。
   *   原版成功时返回 undefined，这里返回 true 以兼容复刻调用方（失败一律 false）。
   */
  addTech(id) {
    if (!this.reqgen.useResources('tech', id)) return false;
    const owned = typeof this.idxs.techs?.[id] !== 'undefined'
      || (this.run.techs || []).some((t) => t.id === id);
    if (owned) return false;
    this.run.techs ||= [];
    const i = this.run.techs.push({ id, value: 1 }) - 1;
    this.idxs.techs ||= {};
    this.idxs.techs[id] = i;
    this.lastTechHook = this.runTechHooks(id);      // 原版 63968-64062：图片/BOSS/外交钩子链
    this.reqgen.runGen('tech', id);                 // 原版 64064
    this.achievements.run(id);                      // 原版 64065：runAchievement(裸科技 id)
    this.addLog('tec_' + id, 'text-violet-500');    // 原版 64066
    return true;
  }
  destroyTech(id) { this.run.techs = (this.run.techs || []).filter((t) => t.id !== id); }
  destroyBuilding(id) { this.run.buildings = (this.run.buildings || []).filter((b) => b.id !== id); }

  // 对应 PopulationStore.removeNegativePopulation：资源见底时让消耗它的岗位下岗
  removeNegativePopulation(resourceId) {
    this.run.population ||= [];
    for (const job of [...this.run.population]) {
      if (job.id === 'unemployed' || !job.value) continue;
      const def = this.data.byId.job.get(job.id);
      const drains = (def?.gen || []).some((g) => g.type === 'resource' && g.id === resourceId && g.value < 0);
      if (drains) { job.value = 0; this.modifiers.recalcModifiers('population', job.id, 0); }
    }
    this.recomputeUnemployed();
  }
  // 原版：unemployed = 住房上限 − Σ在岗
  recomputeUnemployed() {
    this.run.population ||= [];
    const cap = this.capOf('unemployed');
    const employed = this.run.population.reduce((a, p) => a + (p.id === 'unemployed' ? 0 : p.value), 0);
    let row = this.run.population.find((p) => p.id === 'unemployed');
    if (!row) { row = { id: 'unemployed', value: 0 }; this.run.population.push(row); }
    row.value = Math.max(0, cap - employed);
    return row.value;
  }
  processQueue() { /* 队列（规格书 02）：资源变化时触发，见 queue.js */ if (this._processQueue) this._processQueue(); }
  /* ---------------- 可见性 / 玩家动作 ---------------- */
  idxBuilding(id) { const i = this.idxs.buildings?.[id]; return i === undefined ? null : this.run.buildings[i]; }
  visibleResources() {   // 对应 ResourcesStore.resources getter
    return this.data.resources.filter((d) => !d.hidden && this.reqgen.checkReq('resource', d.id, d));
  }
  build(id) {
    const def = this.data.byId.building.get(id);
    if (!def) return false;
    if (!this.reqgen.useResources('building', id)) return false;
    this.run.buildings ||= [];
    const i = this.run.buildings.findIndex((b) => b.id === id);
    if (i === -1) this.run.buildings.push({ id, value: 1 }); else this.run.buildings[i].value += 1;
    this.idxs.buildings ||= {};
    if (this.idxs.buildings[id] === undefined) this.idxs.buildings[id] = this.run.buildings.length - 1;
    this.reqgen.runGen('building', id);
    this.modifiers.recalcAllPopulation();
    this.achievements.run(id);   // 原版 50005：runAchievement(裸建筑 id)
    // 原版反馈（main.js.src:50006-50013）：`addLog("bui_"+数量+"_"+建筑, "text-orange-500")`，
    // 只有 i18n 里存在该 (数量,建筑) key 的"里程碑数量"才真正落日志，其余由 addLog 丢弃。
    const cnt = this.run.buildings.find((b) => b.id === id).value;
    this.addLog('bui_' + cnt + '_' + id, 'text-orange-500');
    if (def.cap && cnt >= def.cap) this.addNotification('max_cap', 'key', 'common', false);
    // 图片通知触发点（源码 L49996/L50027/L50032）
    if (id === 'marketplace' && this.run.buildings.find((b) => b.id === id).value === 1) this.notify('img_marketplace', 'img_marketplace_description');
    if (id === 'mine' && this.run.buildings.find((b) => b.id === id).value === 6) this.notify('img_deep_mine', 'img_deep_mine_description');
    if (id === 'reactivate_portal') this.notify('img_the_portal', 'img_the_portal_description');
    return true;
  }
  // UI/队列入口：完全等价于原版 TechsStore.addTech(id)（含"已拥有也扣费但返回 false"的语义）
  research(id) {
    return this.addTech(id) === true;
  }
  // 对应 PopulationStore.updatePopulation（规格书 02 §3）：溢出按"住房上限"回收，再夹到岗位 cap
  assignJob(jobId, delta) {
    this.run.population ||= [];
    const cap = this.capOf(jobId);
    if (cap <= 0) return 0;
    const row = this.run.population.find((p) => p.id === jobId);
    const cur = row ? row.value : 0;
    let next = cur + delta;
    const employed = this.run.population.reduce((a, p) => a + (p.id === 'unemployed' ? 0 : p.value), 0);
    const housing = this.capOf('unemployed');
    const overflow = employed + delta - housing;
    if (overflow > 0) next -= overflow;
    next = Math.max(0, Math.min(next, cap));
    if (next === cur) return 0;
    if (row) row.value = next; else this.run.population.push({ id: jobId, value: next });
    this.modifiers.recalcModifiers('population', jobId, next);
    this.recomputeUnemployed();
    return next - cur;
  }
  /* ---------------- 外交与战争（规格书 05；源码 L50252 randomAttack / L50305 _startAttack / L50314 _processAttack） ---------------- */
  // 构造函数默认值（L50076）；setIntervalValues（L63592）按省电模式换算
  get intervalRandomAttackSpeed() { return this.run.batteryMode === 1 ? 0.64 : this.run.batteryMode === 2 ? 1.28 : 0.16; }
  get intervalRandomAttackDice() { return 2200 * (this.run.batteryMode === 1 ? 1 : this.run.batteryMode === 2 ? 0.5 : 4); }
  declareWar(id) {
    this.run.diplomacy ||= [];
    let row = this.run.diplomacy.find((d) => d.id === id);
    if (!row) { row = { id, owned: 0, relationship: 0, trade: 0, alliance: 0, war: 0, attack: 0 }; this.run.diplomacy.push(row); }
    row.war = 1;
    return row;
  }
  startIncomingAttack(id) {   // 对应 _startAttack(id)：attack=100，记录进行中的下标
    const row = this.run.diplomacy.find((d) => d.id === id);
    if (!row) return false;
    row.attack = 100;
    this.idxAttackInProgress = this.run.diplomacy.indexOf(row);
    return true;
  }
  get attackInProgress() {
    const i = (this.run.diplomacy || []).findIndex((d) => d.attack !== 0);
    return i === -1 ? null : { id: this.run.diplomacy[i].id, attack: this.run.diplomacy[i].attack };
  }
  // 每 tick 调用：对应 randomAttack（L50252）
  tickDiplomacy() {
    const dip = this.run.diplomacy || [];
    const idx = dip.findIndex((d) => d.attack !== 0);
    if (idx === -1) {
      if (dip.length && this.rng.int(1, this.intervalRandomAttackDice) === 1) {
        const wars = dip.filter((d) => d.war === 1 && !d.owned);
        if (wars.length) this.startIncomingAttack(wars[this.rng.int(0, wars.length - 1)].id);
      }
      return null;
    }
    dip[idx].attack -= this.intervalRandomAttackSpeed;   // 对应 _updateAttackTimer
    if (dip[idx].attack <= 0) {
      const id = dip[idx].id;
      dip[idx].attack = 0;                                // 对应 _resetAttackVars
      return this.processDefense(id);                     // 对应 _processAttack → processDefense
    }
    return null;
  }
  // 对应 ArmyStore.processDefense(kingdomId)（main.js.src:43486）：走同一套 _fight，
  // 失败则资源清零（源码在 _fight 里，排除 11 种特殊资源）。BOSS/亡者大军/来犯都走这里。
  processDefense(kingdomId) {
    const k = this.data.byId.diplomacy.get(kingdomId);
    if (!k) return { error: 'unknown_faction' };
    const mods = {};
    for (const a of this.run.army || []) mods[a.id] = this.armyMods(a.id);
    const r = this._simulate({
      mode: 'defense', ourArmy: (this.run.army || []).map((a) => ({ ...a })),
      armyOrder: this.run.armyOrder || {}, mods, difficultyMode: this.run.dfc || 0,
      enemyArmyOverride: k.army, rnd: () => this.rng.next(),
    }, this.data);
    this._applyDeaths(r.ourDeathsByType, true);   // 防守阵亡：原版 destroyArmy(...,'army',!0)
    if (!r.victory) this.zeroResourcesOnDefenseLoss();
    this.save.combatReports ||= [];
    this.save.combatReports.unshift({ fightType: 'defense', enemyId: kingdomId, victory: r.victory, rounds: r.rounds,
      summary: { armyCasualties: r.totalOurDeaths, enemyCasualties: r.totalEnemyDeaths, armyLosses: r.ourDeathsByType, enemyLosses: r.enemyDeathsByType } });
    this.save.combatReports = this.save.combatReports.slice(0, 10);
    return r;
  }
  // 玩家动作入口（复刻 UI 的「驻军」按钮）。★★ 原版**没有**"玩家主动发起防守"这个动作：
  // 防守只由 randomAttack 在敌方来犯（run.diplomacy[x].war===1 && attack 走到 0）时自动触发
  // （源码 50252 randomAttack → 50314 _processAttack → 43486 processDefense；原版 ArmyStore
  //  没有 manualDefend，只有 `processDefense` 与驻军分页）。所以这里只允许"正在来犯"的目标，
  // 其余情况一律不开战、不动任何资源，返回 { error:'no_incoming_attack' }。
  defend(kingdomId) {
    const inc = this.attackInProgress;
    if (!inc || inc.id !== kingdomId) return { error: 'no_incoming_attack', kingdomId };
    const row = (this.run.diplomacy || []).find((d) => d.id === kingdomId);
    if (row) row.attack = 0;      // 对应 _resetAttackVars：防止 tick 倒计时归零后再结算一次
    return this.processDefense(kingdomId);
  }
  // 源码 _fight 的排除清单（11 种）
  zeroResourcesOnDefenseLoss() {
    const KEEP = new Set(['legacy', 'fame', 'relic', 'coin', 'tome_wisdom', 'luck', 'gem', 'titan_gift', 'light', 'offline', 'queue_slot']);
    for (const row of this.run.resources) if (!KEEP.has(row.id)) row.value = 0;
  }
  /* ---------------- 众神之陵捐赠（分包 455；贡品价值表源码 L52792） ---------------- */
  get mausoleumResources() {
    return [{ id: 'gold', value: 0.3 }, { id: 'faith', value: 1 }, { id: 'mana', value: 1.5 },
      { id: 'cow', value: 2.5 }, { id: 'horse', value: 3 }, { id: 'crystal', value: 5 }];
  }
  get showMausoleum() { return (this.run.donation || 0) < 1e6 && this.reqgen.checkOwned('building', 'mausoleum_gods', 1); }
  // 对应 updateDonation（源码 L53441 附近）：按贡品价值折算，满 1e6 触发 img_ascension
  donateMausoleum(resourceId, amount) {
    const def = this.mausoleumResources.find((x) => x.id === resourceId);
    if (!def) return false;
    const have = this.resourceValue(resourceId);
    let n = amount === Infinity ? have : Math.min(amount, have);
    if (n <= 0) return false;
    let value = n * def.value;
    if ((this.run.donation || 0) + value > 1e6) { value = 1e6 - (this.run.donation || 0); n = value / def.value; }
    if (!this.useResource(resourceId, n)) return false;
    this.updateDonation(value);
    return true;
  }
  /* ---------------- 日志与通知（源码 addLog L64426 / addNotification L64467） ---------------- */
  addLog(key, color = '', rawKey = false, notify = true, notifText = '') {
    const raw = rawKey ? key : this.t('log_' + key);
    if (String(raw).startsWith('UNDEFINED_')) return null;      // 缺 key 整条丢弃
    const lines = String(raw).split(' | ');
    const entry = { at: this.clock.now, color, lines };
    (this.logs ||= []).push(entry);
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
    // 原版 64456-64459：notify 时**逐行**发 type='text' 通知，正文就是解析后的日志文本
    // （第 5 参 notifText 非空则用它替换）；颜色固定 "common"（不是日志颜色）。
    // 修复前这里把日志 key 当通知 key 用 → 产生 `UNDEFINED_not_*`，UI 只能整条过滤。
    if (notify) for (const line of lines) this.addNotification(notifText !== '' ? notifText : line, 'text', 'common', false);
    return entry;
  }
  /* addNotification（源码 L64467）1:1：
   *   title = notifText(s) 非空时用 s；否则"RAW 标题类"为空串，其余 t('not_'+e+'_title')
   *   body  = "RAW 正文类"直接用传入的 e（原样文本），其余 t('not_'+e)
   *   type==='achievement' 时 title/body 互换
   *   addLogEntry(第4参) 为真时补一条 raw 日志 `title : body`（text-green-600）
   */
  addNotification(e, type = 'key', color = 'common', addLogEntry = true, autoClose = true, _o = false, notifText = '') {
    const TITLE_RAW = new Set(['text', 'loot', 'death', 'enemy', 'relationship', 'reward', 'oracle', 'queue']);
    const BODY_RAW = new Set(['text', 'loot', 'death', 'enemy', 'spy', 'spy_success', 'battle', 'relationship', 'reward', 'oracle', 'queue']);
    let title = notifText !== '' ? String(notifText) : (TITLE_RAW.has(type) ? '' : this.t('not_' + e + '_title'));
    let body = BODY_RAW.has(type) ? String(e) : this.t('not_' + e);
    if (type === 'achievement') { const t = title; title = body; body = t; }
    const n = { title, body, color, type, at: this.clock.now,
      ttl: autoClose === false ? 0 : (['death', 'enemy', 'battle', 'spy_success'].includes(type) ? 12000 : 8000) };
    (this.toasts ||= []).push(n);
    if (addLogEntry) this.addLog(title + ' : ' + body, 'text-green-600', true, false);
    return n;
  }
  emptyLogs() { this.logs = []; }
  /* ---------------- 图片通知 / 剧情弹窗（源码 toggleImageNotification L63920 附近） ---------------- */
  // i18n 查表：缺 key 时源码返回 "UNDEFINED_"+key 并照常显示（1:1 保留该行为）
  t(key) { const v = this.data.names[key]; return v === undefined ? 'UNDEFINED_' + key : v; }
  notify(key = '', descKey = '', type = 'green') {
    if (key === '' && this.imageNotification?.key === 'img_annhilator') { this.processDefeatAnnihilator(true); return; }
    if (key !== '') {
      if (key === 'img_annhilator') this.processDefeatAnnihilator(false);
      this.imageNotification = {
        key, title: this.t(key), text: this.t(descKey), type, image: './images/' + key + '.webp',
        show: !(this.imageNotification?.show === true),   // ★ 源码是"翻转"而不是置真
      };
    } else if (this.imageNotification) this.imageNotification.show = !this.imageNotification.show;
  }
  closeNotification() {
    if (!this.imageNotification) return;
    if (this.imageNotification.key === 'img_annhilator') this.processDefeatAnnihilator(true);
    this.imageNotification.show = false;
  }
  // 灭世的"战败"分支（源码 processDefeat("launch_annhilator", 11, r)）
  processDefeatAnnihilator(openPanel = true) {
    this.updateFlagB(2, 'launch_annhilator');
    if (openPanel) this.bossResetPrompt = { id: 'launch_annhilator', counter: 11 };
  }
  // 选祖（源码 updateAncestor L39779）：写 run.ancestors + 跑祖先 gen + 送 1 个城防 + img_start
  chooseAncestor(id) {
    const def = this.data.byId.ancestor.get(id);
    if (!def) return false;
    this.run.ancestors = id;
    this.reqgen.runGen('ancestor', id, def);
    this.addArmy('settlement_defenses', 1, true);
    this.addLog('village_empty', '', false, false);            // 原版 updateAncestor 内的 addLog
    this.notify('img_start', 'img_start_description');
    return true;
  }
  addArmy(id, n = 1, force = false) {   // 对应 ArmyStore.addArmy（force 跳过上限检查）
    // ★ 原版每加 1 个单位都会 runGen('army', id)（源码 43703），把该兵种的 gen 应用一次
    //   （例如 archer food -0.2 的维持消耗）。与 destroyArmy/dismiss 的 deleteGen 严格配对。
    this.run.army ||= [];
    let row = this.run.army.find((a) => a.id === id);
    if (!row) {
      row = { id, value: 0, away: 0 };
      this.run.army.push(row);
      this.idxs.army ||= {};
      if (this.idxs.army[id] === undefined) this.idxs.army[id] = this.run.army.length - 1;
    }
    for (let i = 0; i < n; i++) {
      row.value += 1;
      this.reqgen.runGen('army', id);
      this._updateArmyOrder(id, row.value, row.away);   // 源码 43697-43702
    }
    return row.value;
  }
  updateFlag(v) { this.run.flag = v; }
  // 捐赠（源码 updateDonation：>=1e6 弹 img_ascension，注意原版无幂等保护）
  updateDonation(n) {
    this.run.donation = (this.run.donation || 0) + n;
    if (this.run.donation >= 1e6) this.notify('img_ascension', 'img_ascension_description');
    return this.run.donation;
  }
  // 对应 softReset2Confirm（源码 L53422）：flag=0 打亡者大军，胜→flag=1 且 +1 遗物
  softReset2Fight() {
    const r = this.processDefense('army_of_the_dead');
    if (r.victory) { this.updateFlag(1); this.addResource('relic', 1); }
    else this.updateFlag(2);
    return r;
  }
  /* ---------------- BOSS 战与主线钩子（源码 L64018-L64062 科技钩子链 / L43489 processBoss / L44024 updateFlagB） ---------------- */
  updateFlagB(flag, bossId) { this.run.flagb = flag; this.run.boss = bossId || ''; }
  // 防守一场 BOSS 战：胜→flagb=1+成就；败→flagb=2（原版此时弹转生面板）
  processBoss(bossId, counter) {
    const r = this.processDefense(bossId);
    if (r.victory) {
      this.updateFlagB(1, bossId); this.achievements.run(bossId);
      this.notify('img_' + bossId, 'img_' + bossId + '_description');   // 源码 _processVictory
    }
    else { this.updateFlagB(2, bossId); this.bossResetPrompt = { id: bossId, counter }; }
    return r;
  }
  // 对应 DiplomacyStore.addDiplomacy（main.js.src:50140）：
  // push 空行 → 数据表 relationship===0 时立刻宣战 → 图片通知 → addLog("dip_"+id)
  addDiplomacyEntry(id) {
    this.run.diplomacy ||= [];
    if (this.run.diplomacy.some((d) => d.id === id)) return false;
    const def = this.data.byId.diplomacy.get(id);
    if (!def) return false;
    this.run.diplomacy.push({ id, owned: 0, relationship: 0, trade: 0, alliance: 0, war: 0, attack: 0 });
    if (def.relationship === 0) this.run.diplomacy[this.run.diplomacy.length - 1].war = 1;
    this.notify('img_' + id, 'img_' + id + '_description');   // 源码 L50144（缺 key 也照常开窗，1:1 保留）
    this.addLog('dip_' + id, 'text-green-600', false, false); // 源码 L50145
    return true;
  }
  // 研究科技后的钩子（原版 addTech 里的 else-if 链）
  runTechHooks(techId) {
    const BOSS = {
      moonlight_night: ['army_of_goblin', 5], dragon_assault: ['army_of_dragon', 6],
      mysterious_robbery: ['fallen_angel_army_1', 7], fallen_angel: ['fallen_angel_army_2', 8],
      orc_horde: ['orc_horde_boss', 9], mindless_evil: ['mindless_evil_boss', 10],
    };
    const IMG = this.data.byId.imgNotification[techId];
    if (IMG) this.notify(IMG.img, IMG.desc);
    if (BOSS[techId]) { const [boss, counter] = BOSS[techId]; return { boss, result: this.processBoss(boss, counter) }; }
    if (techId === 'orcish_threat') {   // 兽人战争：把兽人战争队伍全部拉进外交表
      let n = 0;
      for (let i = 1; i <= 16; i++) if (this.addDiplomacyEntry('orc_war_party_' + i)) n++;
      return { orcsWar: n };
    }
    if (techId === 'activate_signal') return { diplomacy: this.addDiplomacyEntry('hand_evil') };
    if (techId === 'war_nobunaga') return { diplomacy: this.addDiplomacyEntry('oda_army') };
    if (techId === 'enso_mythical_dragon') return { diplomacy: this.addDiplomacyEntry('blue_dragon') };
    if (techId === 'launch_annhilator') {   // 灭世触发：ann_launch +1（永久加成在下次转生发放）
      this.updateStat('ann_launch', 1);
      return { annihilator: true };
    }
    return null;
  }
  /* ---------------- 面板支撑：队列完成日志 / 确认状态 ---------------- */
  toggleStrictOrder(id) {
    const it = (this.run.queue || []).find((x) => x.id === id);
    if (!it) return false;
    it.strictOrder = !it.strictOrder;
    return it.strictOrder;
  }
  // 队列完成反馈 1:1（源码 57163-57200）：`queue_<cat>_done + ": " + 名称` 的绿色通知（type='queue'）。
  // addNotification 的第 4 参默认 true 会补一条 `title : body` 的 raw 日志（title 空 → " : ..."），与原版一致。
  // 修复前取的是 `log_queue_<cat>_done`（i18n 不存在 → 被 addLog 丢弃），界面上完全看不到完成反馈。
  queueDoneLog(cat, id) {
    const prefix = { building: 'bui_', tech: 'tec_', prayer: 'fai_' }[cat];
    if (!prefix || id === undefined) return null;
    return this.addNotification(this.t('queue_' + cat + '_done') + ': ' + this.t(prefix + id), 'queue', 'green');
  }
  get legacyPoints() { return this.resourceValue('legacy'); }
  /* ---------------- 侦察 / 间谍 / 成就 / 离线 ----------------
   * 原版是"启动 → waitTime 等待 → 结算"的状态机（ArmyStore:42177 waitTime=6e4，
   * 42201-42203 每超转生一次减半、下限 3000）。这里 1:1 落成：
   *   startScout()/startSpy()/startAttack() → 扣成本 + 置进行中 + 记录 endsAt
   *   tick() 内 _tickMissions() 推进 progressScout/Attack/Spy（0..100）并在到点时结算
   * 同时保留 scout()/spy()/attack() 三个"启动并立即结算"的同步入口（复刻 UI 现状 + 既有断言用）。
   */
  // 对应 startExplore（42648）
  startScout() {
    if (this.exploreInProgress) return { error: 'explore_in_progress' };
    const costs = this.costsScout;
    if (Object.keys(costs).length === 0) return { error: 'no_scout_units', costs };
    if (!this.payCost(costs)) return { error: 'insufficient_resources', costs };
    this.updateStat('scout', 1);                       // 源码 42663
    this.exploreInProgress = true; this.progressScout = 0;
    this._missions.scout = { startedAt: this.clock.now, endsAt: this.clock.now + this.waitTime };
    return true;
  }
  // 对应 processExplore（42725）
  finishScout() {
    this._missions.scout = null; this.exploreInProgress = false; this.progressScout = 0;
    const r = this.explore.process();
    this.achievements.checkPersistent();
    return r;
  }
  scout() { const s = this.startScout(); return s === true ? this.finishScout() : s; }

  // 对应 startSpy（42670）
  startSpy() {
    if (this.spyInProgress) return { error: 'spy_in_progress' };
    if (this.run.spy === '') return { error: 'no_spy_target' };      // 源码 checkSpy 42508
    const costs = this.costsSpy;
    if (Object.keys(costs).length === 0) return { error: 'no_spy_units', costs };
    if (!this.payCost(costs)) return { error: 'insufficient_resources', costs };
    this.updateStat('spy', 1);                         // 源码 42685
    this.spyInProgress = true; this.progressSpy = 0;
    this._missions.spy = { startedAt: this.clock.now, endsAt: this.clock.now + this.waitTime };
    return true;
  }
  // 对应 processSpy（42735）
  finishSpy() {
    this._missions.spy = null; this.spyInProgress = false; this.progressSpy = 0;
    return this.spyStore.process();
  }
  spy() { const s = this.startSpy(); return s === true ? this.finishSpy() : s; }

  // 对应 MainStore.updateSpy（64339）/ ArmyStore.spyOption（42613）/ visibleEspionage（42384）
  updateSpy(id) { this.run.spy = id; }
  get spyOption() {
    const id = this.run.spy;
    if (id === '') return { value: '', label: '' };
    const ex = this.data.byId.expedition.get(id);
    if (ex) return { value: id, label: this.t('ene_' + id) };
    const dip = this.data.byId.diplomacy.get(id);
    if (dip) return { value: id, label: this.t('dip_' + id) };
    return { value: '', label: '' };
  }
  get visibleEspionage() { return this.reqgen.checkOwned('tech', 'espionage', 1); }
  spyOwned() { return (this.run.army || []).filter((a) => this.data.byId.unit.get(a.id)?.type === 'spy').reduce((s, a) => s + a.value, 0); }
  spyAway() { return (this.run.army || []).filter((a) => this.data.byId.unit.get(a.id)?.type === 'spy').reduce((s, a) => s + a.away, 0); }

  // 任务进度（给 UI 读：百分比 + 剩余毫秒）
  missionInfo(kind) {
    const m = this._missions[kind];
    if (!m) return { active: false, progress: 0, remainingMs: 0 };
    const now = this.clock.now, total = Math.max(1, m.endsAt - m.startedAt);
    return { active: true, progress: Math.min(100, ((now - m.startedAt) / total) * 100), remainingMs: Math.max(0, m.endsAt - now) };
  }
  _tickMissions() {
    const now = this.clock.now;
    for (const kind of ['scout', 'spy', 'attack', 'oracle']) {
      const m = this._missions[kind];
      if (!m) continue;
      const total = Math.max(1, m.endsAt - m.startedAt);
      const prog = Math.min(100, ((now - m.startedAt) / total) * 100);
      if (kind === 'scout') this.progressScout = prog;
      else if (kind === 'spy') this.progressSpy = prog;
      else if (kind === 'oracle') this.progressOracle = prog;
      else this.progressAttack = prog;
      if (now >= m.endsAt) {
        if (kind === 'scout') this.finishScout();
        else if (kind === 'spy') this.finishSpy();
        else if (kind === 'oracle') this.finishOracle();
        else this.finishAttack();
      }
    }
  }
  // 离线：原版只把离线秒数记进 offline 资源（cap 28800），不补算产量
  applyOffline(seconds) {
    if (seconds > 0) this.addResource('offline', seconds);
    return this.resourceValue('offline');
  }
  /* ---------------- 军队（对应 ArmyStore.addArmy / startAttack+processAttack） ---------------- */
  armyCap() { return this.capOf('army'); }   // 对应 ArmyStore.get cap（42297-42300）
  // 对应 ArmyStore.ownedCount（main.js.src:42398-42403）：**Σ(value) − 1**。
  // 那个 −1 是给祖先赠送的 settlement_defenses 留的偏移，原版的"cap 判定"和"界面显示"
  // （军队页 ownedCount/cap、驻军页 defenseCount/ownedCount）用的是同一个 getter。
  // 原版页面实测：有 1 个 settlement_defenses 时正好招到 cap 个；没有时能招到 cap+1 个。
  armyOwned() { return (this.run.army || []).reduce((a, x) => a + x.value, 0) - 1; }
  get ownedCount() { return this.armyOwned(); }
  // 对应 ArmyStore.defenseCount（42405-42410）：ownedCount − Σaway
  get defenseCount() { return this.armyOwned() - (this.run.army || []).reduce((a, x) => a + (x.away || 0), 0); }
  // 对应 ArmyStore._updateArmyOrder（main.js.src:43808-43821）
  _updateArmyOrder(id, value, away) {
    this.run.armyOrder ||= { away: [], defense: [] };
    const a = this.run.armyOrder.away, d = this.run.armyOrder.defense;
    const n = a.indexOf(id), o = d.indexOf(id);
    let changed = false;
    if (away > 0) { if (n === -1) { changed = true; a.push(id); } }
    else if (n !== -1) { changed = true; a.splice(n, 1); }
    if (value === away) { if (o !== -1) { changed = true; d.splice(o, 1); } }
    else if (o === -1) { changed = true; d.push(id); }
    if (changed) this._sortArmyOrder();
  }
  // 对应 ArmyStore.initArmyOrder（main.js.src:43821+）：载入存档时把 run.army 里的单位
  // 按 _updateArmyOrder 的规则灌进 armyOrder（away=已出征的 army 类；defense=value!==away 的），
  // 再按兵种 order 排序。原版只在 armyOrder 未定义/away 为空时做这件事。
  initArmyOrder() {
    if (typeof this.run.armyOrder === 'undefined') this.run.armyOrder = { away: [], defense: [] };
    for (const row of this.run.army || []) this._updateArmyOrder(row.id, row.value, row.away || 0);
    this._sortArmyOrder(true);
    return this.run.armyOrder;
  }
  // 对应 ArmyStore._sortArmyOrder（main.js.src:43781-43807）：
  // 无参调用只把 away 里"非 army 类型"（侦察/间谍）剔除；sort=true 时按兵种 order 排序两个数组。
  _sortArmyOrder(sort = false) {
    this.run.armyOrder ||= { away: [], defense: [] };
    const a = this.run.armyOrder.away, d = this.run.armyOrder.defense;
    for (let i = a.length - 1; i >= 0; i--) {
      if (this.data.byId.unit.get(a[i])?.type !== 'army') a.splice(i, 1);
    }
    if (!sort) return;
    const ord = (id) => this.data.byId.unit.get(id)?.order ?? 0;
    const na = a.slice().sort((x, y) => ord(x) - ord(y));
    const nd = d.slice().sort((x, y) => ord(x) - ord(y));
    a.splice(0, a.length, ...na);
    d.splice(0, d.length, ...nd);
  }
  recruit(id, n = 1) {
    const def = this.data.byId.unit.get(id);
    if (!def) return 0;
    let done = 0;
    for (let i = 0; i < n; i++) {
      if (def.cap !== undefined) {
        const row = (this.run.army || []).find((a) => a.id === id);
        if ((row ? row.value : 0) >= def.cap) break;
      }
      if (this.armyOwned() >= this.armyCap()) break;      // 原版：已拥有数 ≥ 上限即拒绝
      if (!this.reqgen.useResources('army', id)) break;
      this.addArmy(id, 1);                                // 含 runGen('army')（源码 43703）
      done++;
    }
    if (!done && def.cap !== undefined && (this.run.army.find((a) => a.id === id)?.value || 0) >= def.cap) {
      this.addNotification('max_cap', 'key', 'common', false);   // 源码 L43713
    }
    return done;
  }
  // 对应 ArmyStore.dismissArmy（main.js.src:43887-43901）：★ 只能遣散"在家"的单位
  // （k 被夹到 value-away），不动 away、**不删行**，并且**每个单位一次 deleteGen('army')**。
  dismiss(id, n = 1) {
    if (id === 'settlement_defenses') return false;             // 源码 43888
    const row = (this.run.army || []).find((a) => a.id === id);
    if (!row) return false;                                     // 源码 43889（idxs.army 未定义）
    const avail = row.value - row.away;
    if (avail < 1) return 0;
    const k = Math.min(n, avail);
    row.value -= k;
    this._updateArmyOrder(id, row.value, row.away);      // 源码 43896
    for (let i = 0; i < k; i++) this.reqgen.deleteGen('army', id);
    return k;
  }
  // 对应 DiplomacyStore.sendDelegation（规格书 05：relationship += zP(6)）
  sendDelegation(id) {
    const row = (this.run.diplomacy || []).find((d) => d.id === id);
    if (!row) return 0;
    const inc = this.rng.int(1, 6);
    row.relationship = (row.relationship || 0) + inc;
    return inc;
  }
  // —— 军队面板动作（分包 918：army_preset_save/army_preset_build/add_all/remove_all/sort_by_battle_order）——
  saveArmyPreset() {
    this.run.armyPreset = {};
    for (const a of this.run.army || []) if (a.away > 0) this.run.armyPreset[a.id] = a.away;
    return this.run.armyPreset;
  }
  buildArmyPreset() {
    let n = 0;
    for (const [id, want] of Object.entries(this.run.armyPreset || {})) {
      const row = (this.run.army || []).find((a) => a.id === id);
      if (row) { row.away = Math.max(0, Math.min(want, row.value)); n += row.away; }
    }
    return n;
  }
  armyPresetInfo() {
    const p = this.run.armyPreset || {};
    const types = Object.keys(p).length;
    const units = Object.values(p).reduce((a, b) => a + b, 0);
    return { types, units, text: types ? this.t('army_preset_summary').replace('{types}', types).replace('{units}', units) : this.t('army_preset_empty') };
  }
  addAllAway() { for (const a of this.run.army || []) a.away = a.value; return this.run.army?.length || 0; }
  removeAllAway() { for (const a of this.run.army || []) a.away = 0; return 0; }
  toggleBattleOrderSort() { this.orderByBattleOrder = !this.orderByBattleOrder; return this.orderByBattleOrder; }
  // —— 外交面板动作（分包 648；规格书 05：改善/侮辱 ±zP(6)，通商/联盟用 run.diplomacy 字段）——
  improveRelationship(id) {
    const row = (this.run.diplomacy || []).find((d) => d.id === id);
    if (!row) return 0;
    const inc = this.rng.int(1, 6);
    row.relationship = (row.relationship || 0) + inc;
    return inc;
  }
  insultRelationship(id) {
    const row = (this.run.diplomacy || []).find((d) => d.id === id);
    if (!row) return 0;
    const dec = this.rng.int(1, 6);
    row.relationship = (row.relationship || 0) - dec;
    if (row.relationship < 50 && row.trade) this.toggleTrade(id, false);
    return dec;
  }
  toggleTrade(id, on) {
    const row = (this.run.diplomacy || []).find((d) => d.id === id);
    if (!row) return false;
    const def = this.data.byId.diplomacy.get(id);
    row.trade = on === undefined ? (row.trade ? 0 : 1) : (on ? 1 : 0);
    if (row.trade) this.reqgen.runGen('trade', id, { id, gen: def?.commercial || [] });
    return !!row.trade;
  }
  toggleAlliance(id, on) {
    const row = (this.run.diplomacy || []).find((d) => d.id === id);
    if (!row) return false;
    row.alliance = on === undefined ? (row.alliance ? 0 : 1) : (on ? 1 : 0);
    return !!row.alliance;
  }
  setAway(id, n) {   // 派出/撤回（对应 ArmyStore.updateAway，源码 43822-43829）
    const row = (this.run.army || []).find((a) => a.id === id);
    if (!row) return 0;
    row.away = n < 0 ? 0 : Math.min(n, row.value);
    this._updateArmyOrder(id, row.value, row.away);
    return row.away;
  }
  /* ---------------- 出征成本（对应 ArmyStore.costsAttack，main.js.src:42471） ----------------
   * 原版口径：只累计 type==='army' 且 away>0 的单位，每单位成本 = reqAttack × away。
   * UI「运行成本一览」与 startAttack 实扣用的是同一个 getter，因此两者必然一致。
   */
  get costsAttack() { return this._costsByType('army'); }
  get costsScout() { return this._costsByType('recon'); }
  get costsSpy() { return this._costsByType('spy'); }
  _costsByType(type) {
    const out = {};
    for (const a of this.run.army || []) {
      const def = this.data.byId.unit.get(a.id);
      if (!def || def.type !== type || !(a.away > 0)) continue;
      for (const req of def.reqAttack || []) out[req.id] = (out[req.id] || 0) + req.value * a.away;
    }
    return out;
  }
  // 对应 startAttack 的预检 + useResource 逐项扣除（main.jssrc:42703-42717）
  payCost(costs) {
    for (const [id, v] of Object.entries(costs)) if (this.resourceValue(id) < v) return false;
    for (const [id, v] of Object.entries(costs)) this.useResource(id, v);
    return true;
  }
  // 对应 ArmyStore.checkAttack（main.js.src:42530）：未出征 + 有目标 + 出征成本买得起且成本非空
  get checkAttack() {
    if (this.attackRunInProgress) return false;
    if (this.run.enemy === '') return false;
    const costs = this.costsAttack, keys = Object.keys(costs);
    if (keys.length === 0) return false;
    return keys.every((id) => this.resourceValue(id) >= costs[id]);
  }
  // 对应 ArmyStore.checkOracle（main.js.src:42526）：未在神谕/出征中且有目标
  get checkOracle() {
    return !this.oracleInProgress && !this.attackRunInProgress && this.run.enemy !== '';
  }
  // 对应 startAttack（42703）：checkAttack（非进行中/有目标/买得起）→ 扣 costsAttack → updateStat('attack',1)
  startAttack(enemyId, { simulateFn } = {}) {
    if (this.attackRunInProgress) return { error: 'attack_in_progress' };
    const sim = simulateFn || this._simulate;
    if (!sim) return { error: 'combat_simulator_not_wired' };
    if (!this.data.byId.expedition.get(enemyId)) return { error: 'unknown_outpost' };
    const costs = this.costsAttack;
    if (!this.payCost(costs)) return { error: 'insufficient_resources', costs };
    this.run.enemy = enemyId;              // 原版 startAttack 读的就是 run.enemy
    this.updateStat('attack', 1);          // 源码 42718
    this.attackRunInProgress = true; this.progressAttack = 0;
    this._missions.attack = { enemyId, simulateFn, startedAt: this.clock.now, endsAt: this.clock.now + this.waitTime };
    return true;
  }
  // 对应 processAttack（43483）→ _fight('attack')：结算阵亡/征服/报告
  finishAttack() {
    const m = this._missions.attack;
    this._missions.attack = null; this.attackRunInProgress = false; this.progressAttack = 0;
    if (!m) return { error: 'no_attack_in_progress' };
    const { enemyId, simulateFn } = m;
    const sim = simulateFn || this._simulate;
    const mods = {};
    for (const a of this.run.army || []) mods[a.id] = this.armyMods(a.id);
    const r = sim({
      mode: 'attack', ourArmy: (this.run.army || []).map((a) => ({ ...a })),
      armyOrder: this.run.armyOrder || {}, mods, difficultyMode: this.run.dfc || 0, enemyId, rnd: () => this.rng.next(),
    }, this.data);
    // 结算阵亡（原版 destroyArmy：先扣 away 再扣 value）
    this._applyDeaths(r.ourDeathsByType, false);  // 出征阵亡：原版 destroyArmy(...,'army')
    if (r.victory) {
      this.run.enemies ||= [];
      let e = this.run.enemies.find((x) => x.id === enemyId);
      if (!e) { e = { id: enemyId, owned: 0, log: '' }; this.run.enemies.push(e); }
      e.owned = 1;
      this.achievements.run(enemyId);   // 原版 43380：runAchievement(run.enemy) —— 裸据点/王国 id
      const IMG_ENEMY = ['demoness_castle', 'vampire_lair', 'citadel_dead', 'skullface_encampment', 'markanat_forest', 'elder_dragon'];
      if (IMG_ENEMY.includes(enemyId)) this.notify('img_' + enemyId, 'img_' + enemyId + '_description');   // 源码 L43987 白名单
      this.updateEnemy('');
    }
    this.save.combatReports ||= [];
    this.save.combatReports.unshift({ fightType: 'attack', enemyId, victory: r.victory, rounds: r.rounds,
      summary: { armyCasualties: r.totalOurDeaths, enemyCasualties: r.totalEnemyDeaths, armyLosses: r.ourDeathsByType, enemyLosses: r.enemyDeathsByType } });
    this.save.combatReports = this.save.combatReports.slice(0, 10);
    return r;
  }
  // 同步入口：启动并立即结算（复刻 UI 现状 + 既有断言用；1:1 的异步路径是 startAttack + tick）
  attack(enemyId, opts = {}) { const s = this.startAttack(enemyId, opts); return s === true ? this.finishAttack() : s; }
  /* ---------------- 神谕（对应 startOracle 42692 / processOracle 43454-43481 / _fight('oracle')） ----------------
   * 原版口径：
   *   · 只有 showOracle（dfc 0/99）时才可能被 UI 调用；startOracle 的门槛是 **checkAttack**
   *     （有目标、未出征、出征成本买得起），但**不扣资源**——只是"预演一次战斗"。
   *   · 5 秒后 processOracle：_fight('oracle') 只做战斗模拟并返回胜负，**不写战报、不占领据点、
   *     不触发 updateEnemy**；但 _fight 里仍然按阵亡名单扣兵（destroyArmy(...,'army',!0)，即只扣 value）。
   *   · 结果日志 = 裸文本 "神谕：<oracle_prediction_victory|defeat>_<zP(20)>"，颜色 text-indigo-700，
   *     通知 type='oracle' / green|red（RAW 正文类，标题为空）。
   * ★ 复刻 UI 是"每个据点一行按钮"（原版是选目标 + 单按钮），所以这里接受 enemyId 并写 run.enemy；
   *   UI 未传时沿用 run.enemy（与源码 setTimeout 里读 run.enemy 一致）。
   */
  startOracle(enemyId, { simulateFn } = {}) {
    if (enemyId !== undefined && enemyId !== '') this.run.enemy = enemyId;
    if (!this.checkAttack) return { error: 'oracle_not_available' };
    this.oracleInProgress = true;
    this.updateStat('oracle', 1);                       // 源码 42696
    this._missions.oracle = { enemyId: this.run.enemy, simulateFn, startedAt: this.clock.now,
      endsAt: this.clock.now + this.waitTimeOracle };   // 源码 setTimeout(processOracle, waitTimeOracle)
    return true;
  }
  finishOracle() {
    const m = this._missions.oracle;
    this._missions.oracle = null; this.oracleInProgress = false; this.progressOracle = 0;
    if (!m) return { error: 'no_oracle_in_progress' };
    const enemyId = this.run.enemy || m.enemyId;
    const sim = m.simulateFn || this._simulate;
    if (!sim) return { error: 'combat_simulator_not_wired' };
    const mods = {};
    for (const a of this.run.army || []) mods[a.id] = this.armyMods(a.id);
    const r = sim({
      mode: 'oracle', ourArmy: (this.run.army || []).map((a) => ({ ...a })),
      armyOrder: this.run.armyOrder || {}, mods, difficultyMode: this.run.dfc || 0, enemyId, rnd: () => this.rng.next(),
    }, this.data);
    this._applyDeaths(r.ourDeathsByType, true);   // _fight：oracle 也扣兵（noAway=true）
    const n = this.rng.int(1, 20);                 // 源码 ge.zP(20)
    const key = (r.victory ? 'oracle_prediction_victory_' : 'oracle_prediction_defeat_') + n;
    this.addLog('神谕：' + this.t(key), 'text-indigo-700 dark:text-indigo-400', true, false);
    this.addNotification(this.t(key), 'oracle', r.victory ? 'green' : 'red', false);
    return r;
  }
  // 同步入口（测试/既有断言用；1:1 异步路径是 startOracle + tick → finishOracle）
  oracle(enemyId, opts = {}) { const s = this.startOracle(enemyId, opts); return s === true ? this.finishOracle() : s; }
  // 原版 _fight 里是 `m.forEach(t => destroyArmy(t,1,'army'[,!0]))`：逐个单位结算（不是一次扣 N）。
  // 难度 99（容易）在扣兵前先随机救回 20% 阵亡名单（源码 43419-43423 extractAndRemoveRandomStrings(m,20)）；
  // 注意：原版战报在救回**之前**就写好了（_saveCombatReport 在 43418 之前），所以战报仍记原始阵亡数。
  _applyDeaths(byType, noAway) {
    const deaths = [];
    for (const [id, n] of Object.entries(byType || {})) for (let i = 0; i < n; i++) deaths.push(id);
    if (this.run.dfc === 99 && deaths.length > 0) {
      const resc = Math.floor((deaths.length * 20) / 100);   // 源码：floor(len * 20 / 100)
      for (let i = deaths.length - 1; i > 0; i--) {          // Math.random 洗牌 → 这里用种子随机
        const j = this.rng.int(0, i);
        [deaths[i], deaths[j]] = [deaths[j], deaths[i]];
      }
      deaths.splice(0, resc);
    }
    const counts = {};
    for (const id of deaths) counts[id] = (counts[id] || 0) + 1;
    for (const [id, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i++) this.destroyArmy(id, 1, 'army', noAway);
    }
    return counts;
  }
  // 对应 ArmyStore.destroyArmy（main.js.src:43861-43886）
  // ★ 与原版逐行对齐：① settlement_defenses 直接 return false；② 只在 away/value >= n 时扣，
  //   **不把行删掉**（原版保留 value=0 的行）；③ 每次结算 updateStat('dead', n)。
  // noAway=true 时不动 away（原版防守阵亡 destroyArmy(...,'army',!0)）。
  destroyArmy(id, n, type, noAway) {
    if (id === 'settlement_defenses') return false;
    const row = (this.run.army || []).find((a) => a.id === id);
    if (!row) return false;
    const awayOk = !noAway && row.away >= n;
    const valueOk = row.value >= n;
    if (awayOk) row.away -= n;
    if (valueOk) row.value -= n;
    if (awayOk || valueOk) this._updateArmyOrder(id, row.value, row.away);   // 源码 43870/43872
    for (let i = 0; i < n; i++) this.reqgen.deleteGen('army', id);   // 源码 43873-43874：逐单位回滚 gen
    // 源码 43875-43884：侦察兵阵亡 → 随机一条 ene_death_<1..117> 日志 + death 通知
    if (type === 'recon') {
      const k = this.rng.int(1, 117);
      this.addLog('ene_death_' + k, 'text-red-600', false, false);
      this.addNotification(this.t('log_ene_death_' + k), 'death', 'red', false);
    }
    this.updateStat('dead', n);          // 源码 43885
    return true;
  }
  armyMods(id) {   // 对应 ArmyStore.calcArmyMods
    let atk = 0, def = 0;
    for (const m of this.modifiers.getAllMods(id)) {
      if (m.id === 'attack') atk += m.value; else if (m.id === 'defense') def += m.value;
    }
    return [atk, def];
  }
  updateEnemy(id) { this.run.enemy = id; }
  /* ---------------- 转生（对应 MainStore.softReset/_initNewRun，main.js.src:64342） ---------------- */
  get legacyPoints() { return this.resourceValue('legacy'); }
  // 对应 StatsStore.setStat（main.js.src:63892）：只写 stats，**不**刷新派生量（原版只有 updateStat 刷新）
  setStat(id, value) {
    this.save.stats ||= [];
    const i = this.save.stats.findIndex((x) => x.id === id);
    if (i === -1) this.save.stats.push({ id, value }); else this.save.stats[i].value = value;
  }
  legacyDef(id) { return this.data.byId.legacy?.get(id); }
  legacyCost(id) {
    const d = this.legacyDef(id);
    if (!d) return Infinity;
    const req = (d.req || []).filter((r) => r.type === 'resource' && r.id === 'legacy');
    return req.length ? req.reduce((a, r) => a + r.value, 0) : 0;
  }
  // 购买传承：逐个扣 legacy，失败静默跳过（原版 addLegacy，L53356）
  addLegacy(id) {
    this.save.leg ||= [];
    if (this.save.leg.some((l) => l.id === id)) return false;
    const def = this.legacyDef(id);
    if (!def) return false;
    const okReq = this.reqgen.checkReq('legacy', id, def);
    if (!okReq) return false;
    if (!this.reqgen.checkReq('legacy', id, def, true, true)) return false;   // 实扣（含 legacy 花费）
    this.save.leg.push({ id, value: 1 });
    return true;
  }
  get visibleNewGamePlus() { return (this.save.leg || []).length >= 25; }   // 原版 L52886
  // 重放永久效果（转生/超转生后调用，原版 restore*Mods）
  restoreLegaciesMods() { for (const l of this.save.leg || []) this.reqgen.runGen('legacy', l.id); }
  restoreAchievementsMods() { for (const a of this.save.ach || []) this.reqgen.runGen('achievement', typeof a === 'string' ? a : a.id); }
  softReset(selected = []) {
    for (const id of selected) this.addLegacy(id);
    const carry = {};
    for (const id of ['legacy', 'relic', 'coin', 'tome_wisdom', 'gem', 'titan_gift', 'light']) carry[id] = this.resourceValue(id);
    const oldRun = this.run, oldDfc = oldRun.dfc;
    this.save.run = newRun({ difficultyMode: oldDfc });   // 原版模板 dfc:0，这里保留玩家难度以便测试可复现
    this.save.idxs = { resources: {}, caps: {}, population: {}, buildings: {}, techs: {}, modifiers: {}, army: {}, prayers: {} };
    this._rebuildIdx(); this._initCaps();
    for (const [id, v] of Object.entries(carry)) if (v) this.addResource(id, v);
    const ann = this.stats.annLaunchNumber;
    if (ann >= 1) {
      this.resources.addProp('perc', 'fame', 2 * ann);
      this.addResource('light', 2 * ann); this.addResource('luck', 2 * ann);
      this.resources.updateCap('army', 10 * ann);
    }
    this.restoreAchievementsMods(); this.restoreLegaciesMods();
    this.updateStat('reset', 1);
    this.emptyLogs();                 // 源码：转生清空日志
    return true;
  }
  // 对应 MainStore._initNewGamePlus（L64407-L64422）
  newGamePlus() {
    const e = (this.save.leg || []).length;                 // ★ 先取当前已购传承数
    this.save.run = newRun({ difficultyMode: this.run.dfc });
    this.save.idxs = { resources: {}, caps: {}, population: {}, buildings: {}, techs: {}, modifiers: {}, army: {}, prayers: {} };
    this.save.leg = [];                                     // ★ 传承清空
    this._rebuildIdx(); this._initCaps();
    this.setStat('reset', 0);                               // ★ 转生次数清零
    this.updateStat('ng_bonus', e);                         // ★ 累加
    this.updateStat('ng_reset', 1);
    this.emptyLogs();                                       // 源码：NG+ 清空日志
    this.restoreAchievementsMods();                         // 原版只重放成就（传承已清空）
    return this.stats.ngResetNumber;
  }
  /* ---------------- 主循环 ---------------- */
  tick(deltaMs) {
    this.tickCount = (this.tickCount || 0) + 1;
    this.clock.advance(deltaMs);
    const secs = deltaMs / 1000;
    if (secs <= 0) return;
    this._tickProduction(secs);
    this.magic.tickEmptyCheck();
    this.market.tick(deltaMs);
    this.tickDiplomacy();
    this._tickMissions();                  // 侦察/间谍/出征的 waitTime 推进与到点结算
    if (this._tickQueue) this._tickQueue(deltaMs);
    if (this._tickCombat) this._tickCombat(deltaMs);
    this.ticked = (this.ticked || 0) + deltaMs;
  }
  _tickProduction(secs) {
    for (const row of this.run.resources) {
      const rate = this.perSecond(row.id);
      if (rate) this.addResource(row.id, rate * secs);
    }
  }

  /* ---------------- 存档 ---------------- */
  toJSON() { return JSON.parse(JSON.stringify(this.save)); }
  serialize() { return JSON.stringify(this.save); }
  saveToStorage() { try { localStorage.setItem('theresmore-replica', this.serialize()); } catch {} }
  static fromJSON(data, json, opts = {}) { return new Game({ data, save: JSON.parse(json), ...opts }); }
}
export { emptySave, newRun, DATA_VERSION };
