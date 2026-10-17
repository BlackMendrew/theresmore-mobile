// 侦察与发现 1:1（规格书 03 §7.2–7.4，main.js.src:42725 processExplore / 43957 foundEnemy /
// 43934 foundKingdom / 43902 foundLoot / 43912 processLoot / 43977 addEnemy / 43861 destroyArmy）
//
// 反馈口径（原版实测，见 build/compare/修复-引擎.md 第 5 条）：
//   拾荒   → addLog(raw 文本, text-blue-500) + addNotification(..., 'loot', 'blue')
//   发现据点 → addEnemy：addLog('ene_'+id) +（6 个图片据点开图 / 其余 'enemy' 通知）
//   发现王国 → addDiplomacy：addLog('dip_'+id) + 图片通知
//   侦察兵阵亡 → destroyArmy(..., 'recon')：addLog('ene_death_'+zP(117)) + 'death' 通知
//   一无所获 → addLog(log_ene_no_loot(s), raw)
export class Explore {
  constructor(game) { this.g = game; }
  zP(n) { return Math.floor(this.g.rng.next() * n) + 1; }            // 1..n 闭区间
  HO(a, b) { return a + Math.floor(this.g.rng.next() * (b - a + 1)); }
  reconUnits() {
    return (this.g.run.army || []).filter((a) => a.away > 0 && this.g.data.byId.unit.get(a.id)?.type === 'recon');
  }
  // 一次侦察：每个出征侦察兵各掷一次（对应 processExplore）
  process() {
    const res = { enemies: 0, kingdom: false, loot: 0, deaths: 0, nothing: 0 };
    let foundEnemyCount = 0, foundKingdom = false, nothing = 0;
    const looted = [];
    const dead = [];
    for (const u of this.reconUnits()) {
      for (let i = 0; i < u.away; i++) {
        if (u.id === 'familiar') {
          const d = this.zP(6);
          if (d >= 5) { if (foundEnemyCount < 2) { if (this.foundEnemy()) { foundEnemyCount++; res.enemies++; } else nothing++; } }
          else if (d >= 2) { looted.push(...this.foundLoot()); res.loot++; }
          else nothing++;
        } else if (u.id === 'explorer') {
          const d = this.zP(12);
          if (d === 12) dead.push(u.id);
          else if (d === 6 || d === 7) { if (!foundKingdom) { if (this.foundKingdom()) { foundKingdom = true; res.kingdom = true; } else nothing++; } }
          else if (d <= 5) { if (foundEnemyCount < 2) { if (this.foundEnemy()) { foundEnemyCount++; res.enemies++; } else nothing++; } }
          else if (d >= 10) { looted.push(...this.foundLoot()); res.loot++; }
          else nothing++;
        } else {
          const d = this.zP(10);
          if (d === 1) dead.push(u.id);
          else if (d <= 3) { if (!foundKingdom) { if (this.foundKingdom()) { foundKingdom = true; res.kingdom = true; } else nothing++; } }
          else if (d <= 5) { if (foundEnemyCount < 2) { if (this.foundEnemy()) { foundEnemyCount++; res.enemies++; } else nothing++; } }
          else if (d <= 7) { looted.push(...this.foundLoot()); res.loot++; }
          else nothing++;
        }
      }
    }
    this.processLoot(res.loot, looted);
    if (nothing > 0) {                       // 源码 42813-42828：一无所获的日志
      const txt = this.g.t(nothing > 1 ? 'log_ene_no_loots' : 'log_ene_no_loot')
        .replace('侦察兵们', '侦察兵们(' + nothing + ')');
      this.g.addLog(txt, 'text-gray-400 dark:text-gray-500', true, false);
    }
    for (const id of dead) { this.g.destroyArmy(id, 1, 'recon'); res.deaths++; }
    res.nothing = nothing;
    return res;
  }
  // 对应 foundLoot（43902）：只算不发放，发放交给 processLoot
  foundLoot() {
    const m = this.zP(12), k = this.HO(5, 10);
    return [
      { id: 'wood', value: 10 * m * k },
      { id: 'gold', value: 8 * m * k },
      { id: 'stone', value: 6 * m * k },
      { id: 'copper', value: 3 * m * k },
      { id: 'iron', value: 2 * m * k },
    ];
  }
  // 对应 processLoot（43912）：汇总 → 发放 → 日志（raw）+ 通知（loot/blue）
  processLoot(count, loot) {
    if (count <= 0) return null;
    const r = this.g.t(count > 1 ? 'log_ene_loots' : 'log_ene_loot')
      .replace('侦察兵们', '侦察兵们(' + count + ')');
    const agg = new Map();
    for (const it of loot) agg.set(it.id, (agg.get(it.id) || 0) + Number(it.value));
    let text = '';
    for (const [id, v] of agg) {
      this.g.addResource(id, v, true);
      if (text !== '') text += '，';
      text += v + this.g.t('res_' + id);
    }
    const line = r + '：' + text;
    this.g.addLog(line, 'text-blue-500', true, false);
    this.g.addNotification(line, 'loot', 'blue', false);
    return { count, agg: Object.fromEntries(agg), line };
  }
  // 取表序"最后"一个满足条件的据点 → addEnemy（43977）
  foundEnemy() {
    const r = this.zP(40);
    let winner = null;
    for (const a of this.g.data.expeditions) {
      if (!(a.found || []).includes(r)) continue;
      if ((this.g.run.enemies || []).some((e) => e.id === a.id)) continue;
      if (!this.g.reqgen.checkReq('enemy', a.id, { id: a.id, req: a.reqFound })) continue;
      winner = a.id;
    }
    if (!winner) return false;
    this.addEnemy(winner);
    return true;
  }
  // 对应 addEnemy（43977）：push + 日志 + 图片通知/普通通知
  addEnemy(id) {
    this.g.run.enemies ||= [];
    this.g.run.enemies.push({ id, owned: 0, log: '' });
    this.g.addLog('ene_' + id, 'text-orange-500', false, false);
    const IMG_ENEMY = ['demoness_castle', 'vampire_lair', 'citadel_dead', 'skullface_encampment', 'markanat_forest', 'elder_dragon'];
    if (IMG_ENEMY.includes(id)) this.g.notify('img_' + id, 'img_' + id + '_description');
    else this.g.addNotification(this.g.t('log_ene_' + id), 'enemy', 'green', false);
    return true;
  }
  // 取表序"最后"一个满足条件的王国 → addDiplomacy（43934）
  foundKingdom() {
    const r = this.zP(40);
    let winner = null;
    for (const a of this.g.data.diplomacy) {
      if (!(a.found || []).includes(r)) continue;
      if ((this.g.run.diplomacy || []).some((e) => e.id === a.id)) continue;
      if (!this.g.reqgen.checkReq('diplomacy', a.id, { id: a.id, req: a.reqFound })) continue;
      winner = a.id;
    }
    if (!winner) return false;
    return this.g.addDiplomacyEntry(winner);
  }
}
