// 战斗模拟器（1:1 移植 ArmyStore._fight()），数据由调用方注入：simulate(fixture, data)
// data 需包含 byId.unit（我方+敌方兵种合并）与 byId.expedition（据点表）
// 对应游戏里的 ge.HO(a,b)：返回 [a,b] 之间的随机整数（含端点）
export function HO(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

// 对应 ArmyStore._addEnemiesQtyModifiers
export function addEnemiesQtyModifiers(qty, difficultyMode, rnd = HO) {
  let t = 0;
  if (difficultyMode === 1) { qty += (50 * qty) / 100; t = 10; }
  else if (difficultyMode === 2) { qty += (100 * qty) / 100; t = 20; }
  else if (difficultyMode === 3) { qty += (350 * qty) / 100; t = 30; }
  qty += (qty * rnd(0, t)) / 100;
  return Math.round(qty);
}

// 对应 ArmyStore.sortByOrderArr
function sortByOrderArr(orderArr) {
  return (t, r) => {
    const a = orderArr.indexOf(t.id), i = orderArr.indexOf(r.id);
    return a === -1 && i === -1 ? 0 : a === -1 ? 1 : i === -1 ? -1 : a - i;
  };
}

/**
 * fixture = {
 *   mode: 'attack' | 'defense' | 'oracle',
 *   ourArmy: [{id, value, away}],
 *   armyOrder: { away: [...ids], defense: [...ids] },
 *   mods: { unitId: [attackMod, defenseMod] },     // = ArmyStore.calcArmyMods(id)
 *   enemy: { id, army: [{id, value}] } | enemyId,  // 直接用 enemyId 时从表里取 army
 *   enemyArmyOverride: [{id, value}],              // 可选：直接指定敌方阵容
 *   difficultyMode: 0..3,
 *   detail: false                                  // true 时输出逐回合事件
 * }
 */
export function simulate(fixture, data) {
  const unitById = data.byId.unit;
  const enemyById = data.byId.expedition;
  const {
    mode = 'attack', ourArmy = [], armyOrder = {}, mods = {},
    difficultyMode = 0, detail = false, rnd = HO,
  } = fixture;
  let enemy = fixture.enemy;
  if (!enemy && fixture.enemyId) {
    const def = enemyById.get(fixture.enemyId);
    if (!def) throw new Error('unknown enemy ' + fixture.enemyId);
    enemy = { id: def.id, army: def.army };
  }
  if (fixture.enemyArmyOverride) enemy = { id: enemy ? enemy.id : 'custom', army: fixture.enemyArmyOverride };
  if (!enemy) throw new Error('no enemy given');

  // ---- 我方：attack/oracle 用 away 的 army 单位；defense 用留在家里的单位 ----
  const d = [];
  let c = [];
  for (const t of ourArmy) {
    const u = unitById.get(t.id);
    if (!u) throw new Error('unknown unit ' + t.id);
    const mod = mods[t.id] || [0, 0];
    const atk = (u.attack || 0) + mod[0];
    const def = (u.defense || 0) + mod[1];
    let count = 0;
    if (mode === 'attack' || mode === 'oracle') {
      count = t.away || 0;
      if (u.type !== 'army') count = 0;                 // 只有 army 类型才能出征
    } else {
      count = (t.value || 0) - (t.away || 0);
      if (count < 0) count = 0;
    }
    for (let n = 0; n < count; n++) {
      c.push({ id: t.id, defense: def, order: u.order, category: u.category });
      d.push({
        id: t.id, attack: atk, order: u.category, category: u.category,
        trample: u.trample, splash: u.splash,
      });
    }
  }
  const orderArr = mode === 'defense' ? (armyOrder.defense || []) : (armyOrder.away || []);
  d.sort(sortByOrderArr(orderArr));
  c.sort(sortByOrderArr(orderArr));

  // ---- 敌方 ----
  const p = [];
  let _ = [];
  for (const e of enemy.army) {
    const t = unitById.get(e.id);
    if (!t) throw new Error('unknown enemy unit ' + e.id);
    let r = e.value;
    if (typeof t.cap === 'undefined') r = addEnemiesQtyModifiers(r, difficultyMode, rnd);
    const a = t.attack || 0, i = t.defense || 0;
    for (let n = 0; n < r; n++) {
      _.push({ id: e.id, defense: i, order: t.order, category: t.category });
      p.push({
        id: e.id, attack: a, order: t.category, category: t.category,
        trample: t.trample, splash: t.splash,
      });
    }
  }
  p.sort((e, t) => (e.order > t.order ? 1 : t.order > e.order ? -1 : 0));
  _.sort((e, t) => (e.order > t.order ? 1 : t.order > e.order ? -1 : 0));

  let h = 0, y = 0, m = [], g = [], f = [];

  while (h === 0) {
    y++;
    let e = 0, t = [];
    // 我方进攻
    for (let i = 0; i < d.length; i++) {
      const r = d[i];
      let a = r.attack;
      const n = r.category === 4 ? 1 : r.category + 1;
      while (e < _.length && t.includes(e)) e++;
      if (r.splash && r.splash > 0) {
        let i2 = 0, o = e;
        while (i2 < r.splash && o < _.length) {
          if (t.includes(o)) { o++; continue; }
          let dmg = a;
          const s = _[o].category === n;
          if (s) dmg *= 2;
          const l = dmg >= _[o].defense;
          const dd = Math.min(dmg, _[o].defense);
          f.push({ round: y, attacker: r.id, target: _[o].id, damage: dd, originalDamage: a, targetDefense: _[o].defense, killed: l, attackType: 'splash', categoryBonus: s });
          if (l) { if (!t.includes(o)) { g.push(_[o].id); t.push(o); } } else { _[o].defense -= dmg; }
          i2++; o++;
        }
      } else {
        while (e < _.length && a > 0) {
          const i2 = _[e], o = i2.defense;
          let s = a;
          const l = _[e].category === n;
          if (l) s *= 2;
          const dd = s >= _[e].defense;
          const cc = Math.min(s, _[e].defense);
          let u = 0;
          if (dd) {
            a -= _[e].defense;
            if (r.trample && r.trample > 0) { u = Math.floor(a * (r.trample / 100)); a = u; } else a = 0;
            if (!t.includes(e)) { g.push(_[e].id); t.push(e); }
            e++;
          } else { _[e].defense -= s; a = 0; }
          f.push({ round: y, attacker: r.id, target: i2.id, damage: cc, originalDamage: r.attack, targetDefense: o, killed: dd, attackType: r.trample && r.trample > 0 && dd && u > 0 ? 'trample' : 'normal', categoryBonus: l, trampleRemaining: u > 0 ? u : undefined });
        }
      }
    }
    // 敌方进攻
    let r2 = 0, a2 = [];
    for (let i = 0; i < p.length; i++) {
      const e2 = p[i];
      let t2 = e2.attack;
      const n2 = e2.category === 4 ? 1 : e2.category + 1;
      while (r2 < c.length && a2.includes(r2)) r2++;
      if (e2.splash && e2.splash > 0) {
        let i3 = 0, o2 = r2;
        while (i3 < e2.splash && o2 < c.length) {
          if (a2.includes(o2)) { o2++; continue; }
          let dmg = t2;
          const s2 = c[o2].category === n2;
          if (s2) dmg *= 2;
          const l2 = dmg >= c[o2].defense;
          const dd2 = Math.min(dmg, c[o2].defense);
          f.push({ round: y, attacker: e2.id, target: c[o2].id, damage: dd2, originalDamage: t2, targetDefense: c[o2].defense, killed: l2, attackType: 'splash', categoryBonus: s2 });
          if (l2) { if (!a2.includes(o2)) { m.push(c[o2].id); a2.push(o2); } } else { c[o2].defense -= dmg; }
          i3++; o2++;
        }
      } else {
        while (r2 < c.length && t2 > 0) {
          const i3 = c[r2], o2 = i3.defense;
          let s2 = t2;
          const l2 = c[r2].category === n2;
          if (l2) s2 *= 2;
          const dd2 = s2 >= c[r2].defense;
          const u2 = Math.min(s2, c[r2].defense);
          let p2 = 0;
          if (dd2) {
            t2 -= c[r2].defense;
            if (e2.trample && e2.trample > 0) { p2 = Math.floor(t2 * (e2.trample / 100)); t2 = p2; } else t2 = 0;
            if (!a2.includes(r2)) { m.push(c[r2].id); a2.push(r2); }
            r2++;
          } else { c[r2].defense -= s2; t2 = 0; }
          f.push({ round: y, attacker: e2.id, target: i3.id, damage: u2, originalDamage: e2.attack, targetDefense: o2, killed: dd2, attackType: e2.trample && e2.trample > 0 && dd2 && p2 > 0 ? 'trample' : 'normal', categoryBonus: l2, trampleRemaining: p2 > 0 ? p2 : undefined });
        }
      }
    }
    // 结算阵亡（严格复刻 delete + splice(-1) 的行为）
    t.forEach((idx) => {
      const j = p.findIndex((x) => x.id === _[idx].id);
      p.splice(j, 1);
      delete _[idx];
    });
    a2.forEach((idx) => {
      const j = d.findIndex((x) => x.id === c[idx].id);
      d.splice(j, 1);
      delete c[idx];
    });
    _ = _.filter((x) => x !== undefined);
    c = c.filter((x) => x !== undefined);
    if (c.length === 0) h = 2; else if (_.length === 0) h = 1;
  }

  const count = (arr) => arr.reduce((acc, id) => ((acc[id] = (acc[id] || 0) + 1), acc), {});
  const res = {
    victory: h === 1,
    rounds: y,
    totalOurDeaths: m.length,
    totalEnemyDeaths: g.length,
    ourDeathsByType: count(m),
    enemyDeathsByType: count(g),
    ourSurvivors: c.length,
    enemySurvivors: _.length,
  };
  if (detail) res.events = f;
  return res;
}

