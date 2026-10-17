// ReqGenStore 的 1:1 移植（main.js.src:62735 useResources / 62745 checkReq / 62804 checkOwned / 62868 runGen）
const ARRAY_OF = { army: 'army', building: 'buildings', cap: 'caps', diplomacy_alliance: 'diplomacy', diplomacy_owned: 'diplomacy',
  enemy: 'enemies', population: 'population', prayer: 'prayers', resource: 'resources', tech: 'techs' };
export class ReqGen {
  constructor(game) { this.g = game; }
  // amount 省略 → 返回数量；给了数值 → 返回是否足够
  checkOwned(type, id, amount = false) {
    if (type === 'achievement') {   // 成就存在 save.ach（不在 run 里）
      const owned = (this.g.save.ach || []).some((a) => (a.id || a) === id);
      return amount === false ? (owned ? 1 : 0) : owned;
    }
    let arr = ARRAY_OF[type];
    let i = amount === false ? 0 : false;
    if (type === 'legacy') {
      const at = this.g.legacies.findIndex((x) => x.id === id);
      if (at !== -1) i = amount === false ? 1 : true;
      return i;
    }
    if (type === 'stat') {
      const st = this.g.save.stats || [];
      const at = st.findIndex((x) => x.id === id);
      if (at !== -1) i = amount === false ? st[at].value : st[at].value >= amount;
      return i;
    }
    if (!arr) return i;
    const list = this.g.run[arr] || [];
    const at = list.findIndex((x) => x.id === id);
    if (at === -1) return i;
    const row = list[at];
    if (arr === 'diplomacy' && type === 'diplomacy_alliance') i = amount === false ? row.alliance : row.alliance >= amount;
    else if (arr === 'enemies' || (arr === 'diplomacy' && type === 'diplomacy_owned')) i = amount === false ? row.owned : row.owned >= amount;
    else if (arr !== 'diplomacy') i = amount === false ? row.value : row.value >= amount;
    return i;
  }
  getData(type, id) {
    const map = { resource: 'resource', building: 'building', tech: 'tech', army: 'unit', prayer: 'prayer', legacy: 'legacy',
    enemy: 'expedition', diplomacy: 'diplomacy', population: 'job', achievement: 'achievement', cap: 'resource', stat: null, ancestor: 'ancestor' };
    return this.g.data.byId[map[type]]?.get(id) || {};
  }
  checkReq(type, id, data = false, checkResources = true, consume = false, ignoreOwnedCheck = false, capOnly = false) {
    let r = data === false ? this.getData(type, id) : data;
    let ok = true;
    if (!r || !r.req) return ok;
    const owned = this.checkOwned(type, id);
    if ((type === 'building' || type === 'prayer' || type === 'tech') && owned < 0 && !ignoreOwnedCheck) return false;
    if ((type === 'building' || type === 'army') && r.cap && owned >= r.cap && checkResources) return false;
    for (const req of r.req) {
      let v = req.value;
      if (owned > 0 && req.multi) v *= req.multi ** owned;   // 重复建造的成本膨胀
      if (req.type === 'resource') {
        if (capOnly) { if (this.g.capOf(req.id) < Math.floor(v)) ok = false; }
        else if (checkResources) {
          const enough = this.checkOwned('resource', req.id, Math.floor(v));
          if (enough) { if (consume) this.g.useResource(req.id, Math.floor(v)); } else ok = false;
        }
      } else if (req.type === 'building' && req.consume) {
        if (checkResources) {
          if (this.checkOwned('building', req.id, v)) { if (consume) this.g.buildings.destroyBuilding(req.id); } else ok = false;
        } else if (!this.checkReq('building', req.id, false, false, false, true)) ok = false;
      } else {
        if (!this.checkOwned(req.type, req.id, v)) ok = false;
      }
    }
    return ok;
  }
  useResources(type, id, data = false) {
    return !!this.checkReq(type, id, data) && this.checkReq(type, id, data, true, true);
  }
  // 回滚 gen 效果（对应 deleteGen，源码 L62961）：只回滚 modifier / resource 两类
  deleteGen(type, id, data = false) {
    const r = data === false ? this.getData(type, id) : data;
    if (!r || !r.gen) return;
    for (const g of r.gen) {
      if (g.type === 'modifier') {
        this.g.modifiers.addModifier(type, id, g.type_id, g.gen, g.type_gen, g.id, -g.value, g.perc);
      } else if (g.type === 'resource') {
        if (g.perc) {
          const prop = (type === 'spell' && r.cat === 'time') ? 'percMul' : 'perc';
          this.g.resources.addProp(prop, g.id, -g.value);
          this.g.modifiers.addModifier(type, id, type, g.id, g.type, id, -g.value, true);
        } else {
          this.g.resources.addProp(g.value >= 0 ? 'timer' : 'timern', g.id, -g.value);
          this.g.modifiers.addModifier(type, id, type, g.id, g.type, id, -g.value);
        }
      }
    }
  }
  // 应用 gen 效果（building/tech/prayer/population 的效果入口）
  runGen(type, id, data = false) {
    const r = data === false ? this.getData(type, id) : data;
    if (!r || !r.gen) return;
    for (const g of r.gen) {
      switch (g.type) {
        case 'cap': this.g.resources.updateCap(g.id, g.value); break;
        case 'modifier': this.g.modifiers.addModifier(type, id, g.type_id, g.gen, g.type_gen, g.id, g.value, g.perc); break;
        case 'population':
          if (g.id === 'unemployed') this.g.addPopulation(g.value);
          this.g.populationUpdateCap(g.id, g.value);
          break;
        case 'resource':
          if (g.manual) this.g.resources.addProp('manual', g.id, g.value);
          else if (g.perc) {
            const prop = (type === 'spell' && r.cat === 'time') ? 'percMul' : 'perc';   // 源码 L62918
            this.g.resources.addProp(prop, g.id, g.value);
            this.g.modifiers.addModifier(type, id, type, g.id, g.type, id, g.value, true);
          } else if (g.fix) {
            let v = g.value;
            const p = this.g.resources.resourcePerc(g.id), pm = this.g.resources.resourcePercMul(g.id);
            if (p > 0) v += (v * p) / 100;
            if (pm > 0) v += (v * pm) / 100;
            this.g.addResource(g.id, v);
          } else {
            this.g.resources.addProp(g.value >= 0 ? 'timer' : 'timern', g.id, g.value);
            this.g.modifiers.addModifier(type, id, type, g.id, g.type, id, g.value);
          }
          break;
        case 'tech': if (g.value >= 0) this.g.addTech(g.id); else this.g.destroyTech(g.id); break;
        case 'building': if (g.value < 0) this.g.buildings.destroyBuilding(g.id, true); break;
      }
    }
  }
}
