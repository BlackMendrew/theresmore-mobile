// 可注入的确定性随机数（测试用种子固定，1:1 复刻里游戏用 Math.random）
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  const next = () => { // mulberry32
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    float: (a = 0, b = 1) => a + next() * (b - a),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)), // 含端点，对应源码 ge.HO(a,b)
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
  };
}
