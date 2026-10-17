// AchievementsStore 1:1（规格书 03 §6，main.js.src:39373 runAchievement / 39383 _runAchievement）
export class Achievements {
  constructor(game) { this.g = game; }
  get owned() { return this.g.save.ach || (this.g.save.ach = []); }
  has(id) { return this.owned.some((a) => (a.id || a) === id); }
  // 难度后缀：-1=99、0=无后缀、其余 _dif_N
  run(name) {
    const dfc = this.g.run.dfc === 99 ? -1 : (this.g.run.dfc || 0);
    let n = 0;
    for (let r = -1; r <= dfc; r++) n += this._run(name + (r === 0 ? '' : r === -1 ? '_dif_99' : '_dif_' + r));
    return n;
  }
  _run(key) {
    const grp = (this.g.data.achievements || []).find((a) => a.id === key);
    if (!grp) return 0;
    let n = 0;
    for (const ach of grp.ach || []) {
      if (this.has(ach.id)) continue;
      if (!this.g.reqgen.checkReq('achievement', ach.id, ach)) continue;
      this.owned.push({ id: ach.id, parent: key, date: this.g.clock.now });
      this.g.reqgen.runGen('achievement', ach.id, ach);
      // 源码 39395-39399：_runAchievement 里还会发一条 achievement 通知（title/body 在
      // addNotification 内按 'achievement' 分支互换，并补一条 raw 日志）
      this.g.addNotification(ach.id, 'achievement', ach.rarity);
      n++;
    }
    return n;
  }
  // 主界面挂载时补判三组（原版 L72483：prestige / ng_reset / annihilator）
  checkPersistent() { let n = 0; for (const k of ['prestige', 'ng_reset', 'annihilator']) n += this.run(k); return n; }
}
