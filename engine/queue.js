// 建造/研究队列（规格书 02 §4.4，对应 main.js.src:57158 processQueue / addQueue）
export class Queue {
  constructor(game) { this.g = game; this._inProgress = false; }
  get slots() { return Math.max(0, this.g.resourceValue('queue_slot')); }
  list() { this.g.run.queue ||= []; return this.g.run.queue; }
  add(cat, id, strictOrder = true) {
    if (cat === 'tech') {   // 源码 canQueue@71221：confirm:true 的科技不可入队
      const t = this.g.data.byId.tech.get(id);
      if (t && t.confirm) return false;
    }
    const q = this.list();
    if (q.length >= this.slots) return false;
    if (q.some((x) => x.id === id)) return false;
    q.push({ cat, id, age: this.g.clock.now, strictOrder });
    return true;
  }
  delete(id) { this.g.run.queue = this.list().filter((x) => x.id !== id); }
  empty() { this.g.run.queue = []; }
  // 1:1 对应 main.js.src:57158-57216：
  //   - `_inProgress` 重入保护：gen 内部（如成就/建筑 gen 的 resource fix）会再次 addResource→processQueue，
  //     没有它会在一次 build 里递归重入、把同一个队列项反复结算（修复前实测一次 process 能建出上百座）。
  //   - 一趟最多完成 1 项，末尾删掉已完成项后再递归处理下一项（_inProgress 必须先复位）。
  //   - 每个 cat 成功判定 = 返回值 `!== false`（addPrayer 成功返回 undefined）。
  //   - strictOrder：当前项买不起就停止向后扫描。
  //   - 完成时发 `queue_<cat>_done: <名称>` 绿色通知（原版 57175/57187/57199）。
  process() {
    const q = this.list();
    if (!q.length) return 0;
    if (this._inProgress) return 0;
    this._inProgress = true;
    const done = [];
    let examined = 0, scan = true;
    try {
      for (let i = 0; i < q.length && scan; i++) {
        const item = q[i];
        examined++;
        const fn = item.cat === 'building' ? () => this.g.build(item.id, true)
          : item.cat === 'tech' ? () => this.g.research(item.id, true)
            : item.cat === 'prayer' ? () => this.g.magic.addPrayer(item.id, true) : null;
        const ok = fn ? fn() !== false : false;
        if (ok) { done.push(item.id); this.g.queueDoneLog(item.cat, item.id); }
        if (item.strictOrder && done.length < examined) scan = false;   // 队首失败即停
        if (done.length > 0) scan = false;                              // 一趟只成功一个
      }
      for (const id of done) this.delete(id);
    } finally {
      this._inProgress = false;
    }
    return done.length + (done.length ? this.process() : 0);
  }
}
