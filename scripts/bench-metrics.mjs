/**
 * 算力余量评估：把算法层按真机采样率跑一遍，测吞吐与单样本耗时。
 *
 * 真机是 JerryScript（比 V8 慢很多），所以这里给出的是**上界**：只要 V8 下的单样本耗时
 * 乘以一个保守倍数（默认 30）仍远小于采样间隔，就能确定算法本身不是瓶颈。
 *
 * 运行：node native-fit5/scripts/bench-metrics.mjs [小时数] [采样率Hz] [保守倍数]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '../entry/src/main/js/MainAbility/common/metrics.js'), 'utf8');
const { createCueEngine } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

const hours = Number(process.argv[2] || 0.5);
const hz = Number(process.argv[3] || 50);
const slowFactor = Number(process.argv[4] || 30);

const dt = 1000 / hz;
const total = Math.round(hours * 3600 * hz);
const engine = createCueEngine();

// 正常活动量级的输入：静息噪声 + 每 2 秒一次的出杆动作
// 出杆用「先加速后减速、末速度回到 0」的物理波形，避免把推着不放手当成异常输入
const strokePeriod = 2 * hz;
const accelPhase = 0.15;   // 加速段时长（秒）
const decelPhase = 0.15;   // 减速段时长（秒）
let peak = 0;
const start = process.hrtime.bigint();
for (let i = 0; i < total; i += 1) {
  const phase = i % strokePeriod;
  const local = phase / hz;
  let amp = 0;
  if (local < accelPhase) {
    amp = 42 * Math.sin(Math.PI * local / accelPhase);
  } else if (local < accelPhase + decelPhase) {
    amp = -42 * Math.sin(Math.PI * (local - accelPhase) / decelPhase);
  }
  const inStroke = local < accelPhase + decelPhase;
  engine.feed({
    t: i * dt,
    ax: amp + (Math.random() - 0.5) * 0.06,
    ay: (Math.random() - 0.5) * 0.06,
    az: 9.80665 + (Math.random() - 0.5) * 0.06,
    gx: (inStroke ? 3 : 0) + (Math.random() - 0.5) * 0.02,
    gy: 0,
    gz: 0
  });
  if (i % 10000 === 0) peak = Math.max(peak, process.memoryUsage().heapUsed);
}
const elapsedNs = Number(process.hrtime.bigint() - start);
const elapsedMs = elapsedNs / 1e6;
const perSampleUs = (elapsedNs / 1000) / total;
const snapshot = engine.snapshot();

console.log('样本数            : ' + total + '（' + hours + ' 小时 @ ' + hz + 'Hz）');
console.log('总耗时            : ' + elapsedMs.toFixed(1) + ' ms');
console.log('吞吐              : ' + Math.round(total / (elapsedMs / 1000)) + ' 样本/秒');
console.log('单样本耗时(V8)    : ' + perSampleUs.toFixed(3) + ' µs');
console.log('按慢 ' + slowFactor + ' 倍估算: ' + (perSampleUs * slowFactor).toFixed(1) + ' µs/样本，' +
  '占采样间隔 ' + ((perSampleUs * slowFactor) / (dt * 1000) * 100).toFixed(2) + '%');
console.log('堆峰值            : ' + (peak / 1024 / 1024).toFixed(1) + ' MB（引擎内部数组有上限）');
console.log('检出出杆          : ' + snapshot.count + '（预期 ' + Math.round(hours * 3600 / 2) + ' 左右）');

const load = (perSampleUs * slowFactor) / (dt * 1000);
if (load > 0.25) {
  console.log('\n结论：估算占用偏高，需要精简算法或降低采样率');
  process.exit(1);
}
console.log('\n结论：算力余量充足（真机 CPU 占用估算 < 25%）');
