// ModifiersStore 的 1:1 移植（main.js.src:56554 _updateModifier / 56583 getModifiersValue /
// 56845 recalcModifiers / 56890 getAllMods / 56905 _getMods）
export class Modifiers {
  constructor(game) { this.g = game; }
  getAllMods(targetId) {
    const i = this.g.idxs.modifiers?.[targetId];
    return i === undefined ? [] : this.g.run.modifiers[i].mods;
  }
  getModifiersValue(targetId, positive) {
    const mods = this.getAllMods(targetId);
    let sum = 0;
    for (const m of mods) { if (positive ? m.value > 0 : m.value < 0) sum += m.value; }
    return sum;
  }
  _getMods(targetId, groupKey) {
    const i = this.g.idxs.modifiers?.[groupKey];
    if (i === undefined) return [];
    return this.g.run.modifiers[i].mods.filter((m) => m.id === targetId);
  }
  addModifier(sourceType, sourceId, groupType, genTarget, genType, groupKey, value, perc) {
    this.g.idxs.modifiers ||= {};
    if (this.g.idxs.modifiers[groupKey] === undefined) {
      const i = this.g.run.modifiers.push({ id: groupKey, type: groupType, mods: [{ typeOrig: sourceType, idOrig: sourceId, type: genType, id: genTarget, value, perc: !!perc }] }) - 1;
      this.g.idxs.modifiers[groupKey] = i;
    } else {
      const i = this.g.idxs.modifiers[groupKey];
      const mods = this.g.run.modifiers[i].mods;
      const at = mods.findIndex((m) => m.id === genTarget && m.perc === !!perc && m.idOrig === sourceId);
      if (at === -1) mods.push({ typeOrig: sourceType, idOrig: sourceId, type: genType, id: genTarget, value, perc: !!perc });
      else mods[at].value += value;
    }
  }
  _updateModifier(targetId, targetType, sourceId, sourceType, value) {
    value = Math.round(100 * value) / 100;
    this.g.idxs.modifiers ||= {};
    if (this.g.idxs.modifiers[targetId] === undefined) {
      const i = this.g.run.modifiers.push({ id: targetId, type: targetType, mods: [{ type: sourceType, id: sourceId, value }] }) - 1;
      this.g.idxs.modifiers[targetId] = i;
    } else {
      const mods = this.g.run.modifiers[this.g.idxs.modifiers[targetId]].mods;
      const at = mods.findIndex((m) => m.id === sourceId);
      if (at === -1) mods.push({ type: sourceType, id: sourceId, value });
      else mods[at].value = value;
    }
  }
  // 人口职业的产出重算：i = gen.value * 人数，再叠加该职业上的百分比/固定修饰符
  recalcModifiers(kind, jobId, count) {
    if (kind !== 'population') return;
    if (count === undefined) count = this.g.populationTotal(jobId);
    const job = this.g.data.byId.job.get(jobId);
    if (!job || !job.gen) return;
    for (const gen of job.gen) {
      let v = gen.value * count;
      for (const mod of this._getMods(gen.id, jobId)) {
        if (mod.perc) v += (v * mod.value) / 100; else v += mod.value;
      }
      this._updateModifier(gen.id, gen.type, jobId, kind, v);
    }
  }
  recalcAllPopulation() { for (const p of this.g.run.population || []) if (p.id !== 'unemployed') this.recalcModifiers('population', p.id); }
}
