// MagicStore 1:1（源码 L55888 类 / L55962 activeSpell / L55995 addPrayer / L56033 emptySpells / L56049 removeSpell）
export class Magic {
  constructor(game) { this.g = game; }
  def(id) { return this.g.data.byId.prayer.get(id); }
  activeSpell(id) { return (this.g.run.spells || []).includes(id); }
  _isFlatCost(gen, res) { return gen.type === 'resource' && gen.id === res && !gen.perc && (gen.value || 0) < 0; }
  canActivateSpellGen(gen) {
    if (!gen) return true;
    const sum = (res) => gen.reduce((a, e) => a + (this._isFlatCost(e, res) ? -e.value : 0), 0);
    const mana = sum('mana'), off = sum('offline');
    return !(mana > 0 && this.g.resourceValue('mana') < mana) && !(off > 0 && this.g.resourceValue('offline') < off);
  }
  canActivateSpell(id) { const d = this.def(id); return !d || this.canActivateSpellGen(d.gen); }
  // 祈祷：一次性花费后常驻（对应 main.js.src:55995-56019 addPrayer）
  // ★ 原版口径（56002-56004）：`if (!useResources('prayer', id)) return (t || addQueue('prayer', id), false)`
  //   第二参 silent=true 时**只失败不入队**（队列自己 process 时用，防止递归重复入队）。
  addPrayer(id, silent = false) {
    if (!this.g.reqgen.useResources('prayer', id)) {
      if (!silent) this.g.queue.add('prayer', id);   // 原版 QueueStore.addQueue('prayer', id)
      return false;
    }
    this.g.idxs.prayers ||= {};
    if (this.g.idxs.prayers[id] !== undefined) return false;
    // 原版成功分支无 return（返回 undefined，队列用 !1 !== ret 判成功）
    const i = this.g.run.prayers.push({ id, value: 1 }) - 1;
    this.g.idxs.prayers[id] = i;
    this.g.reqgen.runGen('prayer', id);
    return undefined;
  }
  destroyPrayer(id) {
    this.g.idxs.prayers ||= {};
    if (this.g.idxs.prayers[id] === undefined) { this.g.run.prayers.push({ id, value: -1 }); this.g.idxs.prayers[id] = this.g.run.prayers.length - 1; return true; }
    this.g.run.prayers[this.g.idxs.prayers[id]].value = -1;
    return true;
  }
  // 法术：可开关（对应 toggleSpell / _addSpell / removeSpell）
  toggleSpell(id) { this.activeSpell(id) ? this.removeSpell(id) : (this.canActivateSpell(id) && this._addSpell(id)); }
  _addSpell(id) { this.g.run.spells ||= []; this.g.run.spells.push(id); this.g.reqgen.runGen('spell', id, this.def(id)); }
  removeSpell(id) {
    const arr = this.g.run.spells || [];
    const i = arr.indexOf(id);
    if (i === -1) return;
    arr.splice(i, 1);
    this.g.reqgen.deleteGen('spell', id, this.def(id));
  }
  // 资源见底时自动关闭消耗该资源的法术（对应 emptySpells）
  emptySpells(res) {
    for (const id of [...(this.g.run.spells || [])]) {
      const d = this.def(id);
      if (d?.gen?.some((e) => this._isFlatCost(e, res))) this.removeSpell(id);
    }
  }
  // 每 tick：连续 max(1, round(3000/intervalMs)) 个 tick 为 0 才清空（源码 tickEmptyCheck L63318）
  tickEmptyCheck() {
    const need = Math.max(1, Math.round(3000 / (this.g.intervalMs || 250)));
    for (const [res, key] of [['mana', 'checkEmptyMana'], ['offline', 'checkEmptyOffline']]) {
      if (this.g.resourceValue(res) <= 0) {
        this.g[key] = (this.g[key] || 0) + 1;
        if (this.g[key] >= need) { this.g[key] = 0; this.emptySpells(res); }
      } else this.g[key] = 0;
    }
  }
}
