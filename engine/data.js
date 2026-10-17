// 载入从 1.2.2 生产包提取的全量数据表（Node 与浏览器通用）
const FILES = ['img-notifications', 'resources', 'units', 'enemies', 'buildings', 'techs', 'jobs', 'expeditions', 'diplomacy', 'legacies', 'prayers', 'achievements', 'rewards', 'ancestors', 'market', 'names'];
export async function loadData(baseUrl = '../data/') {
  const out = {};
  for (const f of FILES) {
    const res = await fetch(`${baseUrl}${f}.json`);
    out[f] = await res.json();
  }
  return normalize(out);
}
export function loadDataSync(readFile) { // Node 测试用
  const out = {};
  for (const f of FILES) out[f] = JSON.parse(readFile(f));
  return normalize(out);
}
function flattenAchievements(groups) {
  const m = new Map();
  for (const g of groups || []) for (const a of g.ach || []) m.set(a.id, { ...a, parent: g.id });
  return m;
}
function normalize(d) {
  const idx = (arr) => { const m = new Map(); arr.forEach((x) => m.set(x.id, x)); return m; };
  const names = d.names.names || d.names;
  return {
    ...d,
    byId: {
      resource: idx(d.resources), unit: idx([...d.units, ...d.enemies]), building: idx(d.buildings),
      tech: idx(d.techs), job: idx(d.jobs), expedition: idx(d.expeditions), diplomacy: idx(d.diplomacy),
      market: idx(d.market || []), ancestor: idx(d.ancestors || []),
      imgNotification: Object.fromEntries((d['img-notifications'] || []).map((x) => [x.tech, x])), legacy: idx(d.legacies || []), prayer: idx(d.prayers || []), achievement: flattenAchievements(d.achievements),
    },
    name: (prefix, id) => names[`${prefix}${id}`] || id,
    names,
  };
}
