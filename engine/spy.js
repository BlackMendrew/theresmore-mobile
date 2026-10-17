// 间谍系统 1:1 移植（main.js.src:42506 checkSpy / 42670 startSpy / 42735 processSpy /
// 43999 _addEnemySpyLog / 43573 _addEnemiesQtyModifiers / 42613 spyOption）
//
// 状态机（与原版 ArmyStore 完全同构）：
//   选目标：MainStore.updateSpy(id) 写 run.spy（UI 用 enemiesOptions：未拥有的据点 / 已宣战未占领的王国）
//   启动  ：checkSpy（非进行中、run.spy 非空、costsSpy 非空且资源足够）→ 扣 costsSpy
//           → StatsStore.updateStat('spy',1) → spyInProgress=true → waitTime 后 processSpy
//   结算  ：每个出征间谍掷 zP(10)，=1 被抓（destroyArmy(...,'spy')），否则记 1 点成功
//           成功数 >= 目标 esp        → 完整情报（数量+攻/防/溅射/践踏 + 类别）
//           成功数 >= 目标 esp/2      → 一半情报（数量档位词 + 类别）
//           否则                      → 失败（"未发现任何信息"）
//   反馈  ：被抓 → log_spy_death+N 日志 + 'death' 通知
//           完整 → '~~~~~~~~~~' + 情报 + spy_full + 目标名 + '~~~~~~~~~~' + 'spy_success' 通知
//           一半 → 同上但 spy_up50 + 'spy_success' 通知
//           失败 → 目标名+'：'+log_spy_down50 日志 + 'spy' 通知
// 无法确证项：无（全部规则来自源码；esp 缺失的目标按原版 undefined 比较 → 走失败分支）。
import { addEnemiesQtyModifiers } from './combat.js';

export class Spy {
  constructor(game) { this.g = game; }

  // 对应 ArmyStore.spyOption（42613）：Ce（据点）优先，其次 qe（王国）
  target(id = this.g.run.spy) {
    if (!id) return null;
    const ex = this.g.data.byId.expedition.get(id);
    if (ex) return { kind: 'enemy', def: ex };
    const dip = this.g.data.byId.diplomacy.get(id);
    if (dip) return { kind: 'kingdom', def: dip };
    return null;
  }
  label(t) { return this.g.t((t.kind === 'enemy' ? 'ene_' : 'dip_') + t.def.id); }

  // 对应 checkSpy（42506）
  check() {
    if (this.g.spyInProgress) return false;
    if (this.g.run.spy === '') return false;
    const costs = this.g.costsSpy;
    const keys = Object.keys(costs);
    if (keys.length === 0) return false;
    return keys.every((k) => this.g.resourceValue(k) >= costs[k]);
  }

  // 对应 startSpy（42670）：整笔预检 → 整笔扣除
  start() {
    if (!this.check()) return false;
    const costs = { ...this.g.costsSpy };
    const keys = Object.keys(costs);
    if (keys.length === 0) return false;
    for (const k of keys) if (this.g.resourceValue(k) < costs[k]) return false;
    keys.forEach((k) => this.g.useResource(k, costs[k]));
    this.g.updateStat('spy', 1);
    return true;
  }

  // 对应 _addEnemySpyLog（43999）
  addEnemySpyLog(id, text) {
    let i = (this.g.run.enemies || []).findIndex((e) => e.id === id);
    if (i !== -1) { this.g.run.enemies[i].log = text; return; }
    i = (this.g.run.diplomacy || []).findIndex((e) => e.id === id);
    if (i !== -1) this.g.run.diplomacy[i].log = text;
  }

  // 对应 _addEnemiesQtyModifiers（43573）：无 cap 的兵种按难度放大并 ±随机
  qtyMod(qty) {
    return addEnemiesQtyModifiers(qty, this.g.run.dfc || 0, (a, b) => this.g.rng.int(a, b));
  }

  // 对应 processSpy（42735）
  process() {
    let success = 0, captured = 0;
    // ★ 注意：原版 for 循环上界读的是 `r.away`，而 destroyArmy 会同步 -1 away，
    //   所以每被抓一个，本次循环就少掷一次骰子。这里逐行保留该行为。
    for (const row of [...(this.g.run.army || [])]) {
      const def = this.g.data.byId.unit.get(row.id);
      if (!def || def.type !== 'spy' || !(row.away > 0)) continue;
      for (let i = 0; i < row.away; i++) {
        if (this.g.rng.int(1, 10) === 1) { captured++; this.g.destroyArmy(row.id, 1, 'spy'); }
        else success++;
      }
    }
    if (captured > 0) {   // 源码 42848-42860
      this.g.addLog(this.g.t('log_spy_death') + captured, 'text-red-600', true, false);
      this.g.addNotification(this.g.t('log_spy_death') + captured, 'death', 'red', false);
    }
    const out = { success, captured, result: null, target: this.g.run.spy };
    if (success > 0) {
      const t = this.target();
      if (!t) { this.g.spyInProgress = false; return { ...out, error: 'no_spy_target' }; }
      const label = this.label(t);
      const esp = t.def.esp;
      if (success >= esp) out.result = this.full(t, label, success);
      else if (success >= esp / 2) out.result = this.half(t, label, success);
      else out.result = this.fail(t, label, success);
    }
    this.g.spyInProgress = false;
    return out;
  }

  // 完整情报（源码 42870-42928）
  full(t, label, successes) {
    this.g.addLog('~~~~~~~~~~', 'text-green-500', true, false);
    let text = '';
    for (const u of t.def.army || []) {
      const def = this.g.data.byId.unit.get(u.id);
      if (!def) continue;
      let qty = u.value;
      if (typeof def.cap === 'undefined') qty = this.qtyMod(qty);
      const name = qty > 1 ? this.g.t('uni_' + u.id + '_plural') : this.g.t('uni_' + u.id);
      if (text !== '') text += '，';
      let stats = this.g.t('attack_abbr').toLowerCase() + '：' + def.attack
        + ' / ' + this.g.t('defense_abbr').toLowerCase() + '：' + def.defense;
      if (def.splash) stats += ' / ' + this.g.t('splash').toLowerCase() + '：' + def.splash;
      if (def.trample) stats += ' / ' + this.g.t('trample').toLowerCase() + '：' + def.trample + '%';
      text += qty + ' ' + name + ' (' + this.g.t('uni_cat_' + def.category).toLowerCase() + ' / ' + stats + ')';
    }
    this.addEnemySpyLog(t.def.id, text);
    this.g.addLog(text, 'text-green-600', true, false);
    this.g.addLog('spy_full', 'text-green-600', false, false);
    this.g.addLog(label, 'text-green-600', true, false);
    this.g.addLog('~~~~~~~~~~', 'text-green-500', true, false);
    this.g.addNotification(this.g.t('log_spy_full') + text, 'spy_success', 'green', false, true, false, label);
    return { level: 'full', text, esp: t.def.esp, successes };
  }

  // 一半情报（源码 42929-42982）
  half(t, label, successes) {
    this.g.addLog('~~~~~~~~~~', 'text-green-500', true, false);
    let text = '';
    for (const u of t.def.army || []) {
      const def = this.g.data.byId.unit.get(u.id);
      if (!def) continue;
      let qty = u.value;
      if (typeof def.cap === 'undefined') qty = this.qtyMod(qty);
      let word = qty === 1 ? this.g.t('one')
        : qty <= 7 ? this.g.t('a_few')
          : qty <= 15 ? this.g.t('some')
            : qty <= 30 ? this.g.t('a_lot')
              : qty <= 60 ? this.g.t('a_plethora')
                : this.g.t('a_legion');
      const name = qty > 1 ? this.g.t('uni_' + u.id + '_plural') : this.g.t('uni_' + u.id);
      if (text !== '') { word = word.toLowerCase(); text += '，'; }
      text += word + name.toLowerCase() + ' (' + this.g.t('uni_cat_' + def.category).toLowerCase() + ')';
    }
    this.addEnemySpyLog(t.def.id, text);
    this.g.addLog(text, 'text-green-600', true, false);
    this.g.addLog('spy_up50', 'text-green-600', false, false);
    this.g.addLog(label, 'text-green-600', true, false);
    this.g.addLog('~~~~~~~~~~', 'text-green-500', true, false);
    this.g.addNotification(this.g.t('log_spy_up50') + text.toLowerCase(), 'spy_success', 'green', false, true, false, label);
    return { level: 'half', text, esp: t.def.esp, successes };
  }

  // 情报不足（源码 42983-42998）
  fail(t, label, successes) {
    this.g.addLog(label + '：' + this.g.t('log_spy_down50'), 'text-red-600', true, false);
    this.g.addNotification(this.g.t('log_spy_down50'), 'spy', 'red', false, true, false, label);
    return { level: 'fail', text: '', esp: t.def.esp, successes };
  }
}
