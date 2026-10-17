// 存档结构：与原版 1.2.2 的 run/idxs/ach/stats/leg 形状保持一致，便于导入原版存档做对照
export const DATA_VERSION = 1;
export function newRun(opts = {}) {
  return {
    race: opts.race ?? 'humans',
    ancestors: opts.ancestors ?? '',
    enemy: '', spy: '',
    caps: [],
    resources: [],   // 与原版模板一致：开局为空，靠 addResource 惰性创建
    buildings: [], population: [], techs: [], modifiers: [], army: [],
    armyOrder: { away: [], defense: [] },
    enemies: [], diplomacy: [], stocks: [], prayers: [], spells: [], rewards: [],
    flag: 0, flagb: 0, flagd: 0, dfc: opts.difficultyMode ?? 0, boss: '',
    donation: 0, dataVersion: DATA_VERSION,
    queue: [],                 // 复刻自建：建造/研究队列（原版存在 MainStore 上，这里并入 run 便于存档）
    ach: [], leg: [],
  };
}
export function emptySave(opts) {
  return { version: '1.2.2-replica', idxs: { resources: {}, caps: {}, buildings: {}, army: {} }, run: newRun(opts), ach: [], stats: [], leg: [], combatReports: [] };
}
