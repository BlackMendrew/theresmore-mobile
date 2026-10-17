// MarketStore 1:1（源码 L56152 类 / L56192 buy / L56222 sell / L56254 start / L56262 _stocksInterval）
const r2 = (v) => Math.round(100 * v) / 100;
export class Market {
  constructor(game) {
    this.g = game;
    this.stocks = [...(game.data.market || [])].reverse();   // 运行时顺序 = 静态表反转（iron…horse）
    this._acc = 0;
    this.initStocks();
    this.interval(false);
  }
  get showMarket() { return this.g.reqgen.checkOwned('building', 'marketplace', 1); }
  initStocks() {
    const run = this.g.run;
    run.stocks ||= [];
    if (!run.stocks.length || typeof run.stocks[0].sell_min === 'undefined') {
      this.stocks.forEach((s, i) => {
        run.stocks[i] = { id: s.id, sell_min: s.sell_min, sell_max: s.sell_max, sell_duration: 0, buy_min: s.buy_min, buy_max: s.buy_max, buy_duration: 0 };
      });
    }
  }
  idx(id) { return this.stocks.findIndex((s) => s.id === id); }
  Q5(a, b) { return a + this.g.rng.next() * (b - a); }          // 区间内随机价
  buy(id, n = 1) {
    const r = this.idx(id);
    if (r === -1) return false;
    const s = this.stocks[r], rs = this.g.run.stocks[r];
    if (!this.g.useResource('gold', s.buy_value * n)) return false;
    this.g.addResource(id, n);
    for (let i = 0; i < n; i++) {
      rs.buy_min = r2(rs.buy_min + s.buy_variance);
      rs.buy_max = r2(rs.buy_max + s.buy_variance);
      rs.buy_duration = r2(rs.buy_duration + s.buy_duration);
    }
    this.interval(false);
    return true;
  }
  sell(id, n = 1) {
    const r = this.idx(id);
    if (r === -1) return false;
    const s = this.stocks[r], rs = this.g.run.stocks[r];
    if (!this.g.useResource(id, n)) return false;
    this.g.addResource('gold', s.sell_value * n);
    for (let i = 0; i < n; i++) {
      if (rs.sell_min - s.sell_variance > 0.01) {
        rs.sell_min = r2(rs.sell_min - s.sell_variance);
        rs.sell_max = r2(rs.sell_max - s.sell_variance);
      }
      rs.sell_duration = r2(rs.sell_duration + s.sell_duration);
    }
    this.interval(false);
    return true;
  }
  // 每 5s（原版 Worker 5000ms）：先衰减 duration，再重算买卖价
  tick(deltaMs) { this._acc += deltaMs; if (this._acc < 5000) return; this._acc = 0; this.interval(true); }
  interval(enabled = true) {
    this.stocks.forEach((t, r) => {
      const rs = this.g.run.stocks[r];
      if (!rs) return;
      if (enabled) {
        if (rs.buy_duration > 0) {
          rs.buy_duration = r2(rs.buy_duration - 1);
          if (rs.buy_duration <= 0) { rs.buy_duration = 0; rs.buy_min = t.buy_min; rs.buy_max = t.buy_max; }
          else { const e = (rs.buy_min - t.buy_min) / rs.buy_duration; rs.buy_min = r2(rs.buy_min - e); rs.buy_max = r2(rs.buy_max - e); }
        }
        if (rs.sell_duration > 0) {
          rs.sell_duration = r2(rs.sell_duration - 1);
          if (rs.sell_duration <= 0) { rs.sell_duration = 0; rs.sell_min = t.sell_min; rs.sell_max = t.sell_max; }
          else { const e = (rs.sell_min - t.sell_min) / rs.sell_duration; rs.sell_min = r2(rs.sell_min - e); rs.sell_max = r2(rs.sell_max - e); }
        }
      }
      t.buy_value = r2(this.Q5(rs.buy_min, rs.buy_max));
      t.sell_value = r2(this.Q5(rs.sell_min, rs.sell_max));
    });
  }
}
