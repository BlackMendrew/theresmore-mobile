// 虚拟时钟：真实游戏用 Date.now()，复刻里所有时间都走这里，测试可瞬间推进数小时
export class Clock {
  constructor(startTime = Date.now()) { this.now = startTime; this.scale = 1; }
  advance(ms) { this.now += ms * this.scale; return this.now; }
  set(ms) { this.now = ms; }
  get elapsedRef() { return this.now; }
}
