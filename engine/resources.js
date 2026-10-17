// ResourcesStore 的 1:1 移植（main.js.src:63333 getTimerValue / 63352 updateCap / 63290 addProp）
const SPECIAL = new Set(['tome_wisdom', 'relic', 'coin', 'gem', 'titan_gift', 'light']);
export class Resources {
  constructor(game) { this.g = game; }
  row(id) { const i = this.g.idxs.resources[id]; return i === undefined ? null : this.g.run.resources[i]; }
  resourcePerc(id) { const r = this.row(id); return r ? r.perc || 0 : 0; }
  resourcePercMul(id) { const r = this.row(id); return r ? r.percMul || 0 : 0; }
  addProp(prop, id, value) {
    const i = this.g.ensureResource(id);
    const r = this.g.run.resources[i];
    r[prop] = (r[prop] || 0) + value;
  }
  // 每秒产量：与源码逐行一致（顺序很关键）
  getTimerValue(rowOrId) {
    const r = typeof rowOrId === 'string' ? this.row(rowOrId) : rowOrId;
    if (!r) return 0;
    if (this.g.resourceValue('food') === 0 && r.id !== 'food') return 0; // 断粮停产
    let t = 0;
    if (r.timer) t += r.timer;
    t += this.g.modifiers.getModifiersValue(r.id, true);
    if (r.perc && r.perc !== 0 && t > 0) t += (t * r.perc) / 100;
    const pm = r.percMul || 0;
    if (pm !== 0 && t > 0) t += (t * pm) / 100;
    if (t > 0 && !SPECIAL.has(r.id)) {
      t += (t * (0.1 * this.g.stats.ngResetBonus)) / 100;
      t += (t * (2 * this.g.stats.resetNumber)) / 100;
      t += (t * (4 * this.g.stats.annLaunchNumber)) / 100;
    }
    if (r.timern) t += r.timern;
    t += this.g.modifiers.getModifiersValue(r.id, false);
    return Math.round(100 * t) / 100;
  }
  // 上限增减：非 army 时先吃 NG 加成并向上取整
  updateCap(id, delta) {
    if (id !== 'army') {
      delta += (delta * (1 * this.g.stats.ngResetBonus)) / 100;
      delta = Math.ceil(delta);
    }
    this.g.idxs.caps ||= {};
    if (this.g.idxs.caps[id] === undefined) {
      delta += this.g.baseCap(id);
      const i = this.g.run.caps.push({ id, value: delta }) - 1;
      this.g.idxs.caps[id] = i;
    } else {
      this.g.run.caps[this.g.idxs.caps[id]].value += delta;
    }
  }
}
