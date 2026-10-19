/**
 * 出杆算法离线验证：用合成 IMU 信号（静息噪声 + 高斯型出杆脉冲）跑 metrics.js，
 * 检查出杆次数、速度积分、稳定性和热量方程是否符合预期。
 *
 * 说明：这里的合成数据只用于验证算法本身，应用运行时只使用手表真实传感器采样。
 *
 * 运行：node native-fit5/scripts/test-metrics.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '../entry/src/main/js/MainAbility/common/metrics.js'), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const { createCueEngine, keytelPerMinute, toKmh } = await import(moduleUrl);

const HZ = 50;
const STEP_MS = 1000 / HZ;

function gaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 生成一段合成采样：静息段 + 若干次出杆 */
function buildTrace(spec) {
  const unit = spec.accelInG ? 1 / 9.80665 : 1;
  const gyroUnit = spec.gyroInDeg ? 57.29578 : 1;
  const samples = [];
  let t = 0;
  const totalMs = spec.totalMs;
  const strokes = spec.strokes;
  let strokeIndex = 0;
  while (t < totalMs) {
    while (strokeIndex < strokes.length && t >= strokes[strokeIndex].at + strokes[strokeIndex].accelMs + strokes[strokeIndex].decelMs) {
      strokeIndex += 1;
    }
    let ax = 0;
    let ay = 0;
    let az = 9.80665;
    let gx = 0;
    let gy = 0;
    let gz = 0;
    if (strokeIndex < strokes.length && t >= strokes[strokeIndex].at) {
      const stroke = strokes[strokeIndex];
      const local = (t - stroke.at) / 1000;
      const accelPhase = stroke.accelMs / 1000;
      const decelPhase = stroke.decelMs / 1000;
      // 峰值速度 v = A * 2 * T / pi（正弦半波积分）
      const amplitude = stroke.peakSpeed * Math.PI / (2 * accelPhase);
      if (local >= 0 && local < accelPhase) {
        ax = amplitude * Math.sin(Math.PI * local / accelPhase);
      } else if (local >= accelPhase && local < accelPhase + decelPhase) {
        ax = -amplitude * Math.sin(Math.PI * (local - accelPhase) / decelPhase);
      }
      // 出杆时手腕有轻微转动（陀螺仪真实会读到）
      if (local >= -0.05 && local < accelPhase + decelPhase + 0.05) {
        gy = 1.8 * stroke.peakSpeed / 4;
      }
    }
    samples.push({
      t: t,
      ax: (ax + gaussian() * 0.05) * unit,
      ay: (ay + gaussian() * 0.05) * unit,
      az: (az + gaussian() * 0.05) * unit,
      gx: (gx + gaussian() * 0.008),
      gy: (gy + gaussian() * 0.008) * gyroUnit,
      gz: (gz + gaussian() * 0.008) * gyroUnit
    });
    t += STEP_MS;
  }
  return samples;
}

function runTrace(samples) {
  const engine = createCueEngine();
  for (const sample of samples) engine.feed(sample);
  return engine.snapshot();
}

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: !!condition, detail });
}

// 1) 静止 6 秒：不应检出任何出杆
const restOnly = runTrace(buildTrace({ totalMs: 6000, strokes: [] }));
check('静止段不产生出杆', restOnly.count === 0, 'count=' + restOnly.count);

// 2) 四杆同速：应检出 4 杆，速度接近 4 m/s，稳定性高
const sameSpeed = runTrace(buildTrace({
  totalMs: 9000,
  strokes: [
    { at: 1500, peakSpeed: 4.0, accelMs: 150, decelMs: 150 },
    { at: 3000, peakSpeed: 4.0, accelMs: 150, decelMs: 150 },
    { at: 4500, peakSpeed: 4.0, accelMs: 150, decelMs: 150 },
    { at: 6000, peakSpeed: 4.0, accelMs: 150, decelMs: 150 }
  ]
}));
check('检出四杆', sameSpeed.count === 4, 'count=' + sameSpeed.count);
const speedError = sameSpeed.speedAvg ? Math.abs(sameSpeed.speedAvg - 4.0) / 4.0 : 1;
check('速度积分误差 <15%', speedError < 0.15, 'avg=' + (sameSpeed.speedAvg || 0).toFixed(2) + ' m/s 误差=' + (speedError * 100).toFixed(1) + '%');
check('同速出杆稳定性 ≥80', sameSpeed.stability !== null && sameSpeed.stability >= 80, 'stability=' + sameSpeed.stability);
check('同速出杆方向偏差 ≤5°', sameSpeed.deviationDeg !== null && sameSpeed.deviationDeg <= 5, 'deviation=' + sameSpeed.deviationDeg);
check('同速入位稳定性 ≥80', sameSpeed.positionStability !== null && sameSpeed.positionStability >= 80, 'position=' + sameSpeed.positionStability);

// 3) 速度不一致：稳定性应明显低于同速组
const mixed = runTrace(buildTrace({
  totalMs: 9000,
  strokes: [
    { at: 1500, peakSpeed: 2.0, accelMs: 150, decelMs: 150 },
    { at: 3000, peakSpeed: 5.0, accelMs: 150, decelMs: 150 },
    { at: 4500, peakSpeed: 1.5, accelMs: 150, decelMs: 150 },
    { at: 6000, peakSpeed: 4.5, accelMs: 150, decelMs: 150 }
  ]
}));
check('力度不一致时稳定性下降', mixed.stability !== null && mixed.stability < sameSpeed.stability, 'mixed=' + mixed.stability + ' vs same=' + sameSpeed.stability);

// 4) 加速度计以 g 为单位（部分固件）时仍能正确估计
const inG = runTrace(buildTrace({
  accelInG: true,
  totalMs: 6000,
  strokes: [
    { at: 1500, peakSpeed: 4.0, accelMs: 150, decelMs: 150 },
    { at: 3000, peakSpeed: 4.0, accelMs: 150, decelMs: 150 },
    { at: 4500, peakSpeed: 4.0, accelMs: 150, decelMs: 150 }
  ]
}));
const gError = inG.speedAvg ? Math.abs(inG.speedAvg - 4.0) / 4.0 : 1;
check('g 单位自动识别', inG.count === 3 && gError < 0.15, 'count=' + inG.count + ' avg=' + (inG.speedAvg || 0).toFixed(2) + ' scale=' + inG.accelScale.toFixed(1));

// 5) 极轻的晃动不应被当成出杆
const tiny = runTrace(buildTrace({
  totalMs: 6000,
  strokes: [
    { at: 1500, peakSpeed: 0.12, accelMs: 200, decelMs: 200 },
    { at: 3000, peakSpeed: 0.1, accelMs: 200, decelMs: 200 }
  ]
}));
check('轻微晃动不算出杆', tiny.count === 0, 'count=' + tiny.count);

// 6) 一杆期间不应被拆成多杆（长间隔 + 短间隔都只算一杆）
const single = runTrace(buildTrace({
  totalMs: 5000,
  strokes: [{ at: 2000, peakSpeed: 6.0, accelMs: 200, decelMs: 200 }]
}));
check('单杆不重复计数', single.count === 1, 'count=' + single.count);

// 7) Keytel 热量方程
const kcal = keytelPerMinute(120, 70, 30, 'male');
check('Keytel 男性 70kg/30岁/120bpm 在 5~15 kcal/min', kcal > 5 && kcal < 15, 'kcal/min=' + kcal.toFixed(2));
check('缺少体重时热量为 null', keytelPerMinute(120, 0, 30, 'male') === null, 'null');
check('心率 255（无效值）不产生热量', keytelPerMinute(255, 70, 30, 'male') === null, 'null');
check('m/s → km/h 换算', Math.abs(toKmh(4) - 14.4) < 1e-6, '4 m/s = ' + toKmh(4) + ' km/h');

// 8) 陀螺仪单位自适应：固件给 deg/s 时也必须能正确处理
const degTrace = runTrace(buildTrace({
  gyroInDeg: true,
  totalMs: 9000,
  strokes: [
    { at: 1500, peakSpeed: 3.0, accelMs: 150, decelMs: 150 },
    { at: 3000, peakSpeed: 3.0, accelMs: 150, decelMs: 150 },
    { at: 4500, peakSpeed: 3.0, accelMs: 150, decelMs: 150 }
  ]
}));
check('陀螺仪 deg/s 被识别', degTrace.gyroUnit === 'deg/s', 'unit=' + degTrace.gyroUnit);
const degError = degTrace.speedAvg ? Math.abs(degTrace.speedAvg - 3.0) / 3.0 : 1;
check('deg/s 下速度仍然准确', degTrace.count === 3 && degError < 0.2,
  'count=' + degTrace.count + ' avg=' + (degTrace.speedAvg || 0).toFixed(2));

// 9) 采样断点：中途丢 400ms 数据，不应产生速度离谱的假杆
const dropTrace = buildTrace({
  totalMs: 6000,
  strokes: [{ at: 3000, peakSpeed: 2.0, accelMs: 150, decelMs: 150 }]
});
const withGap = dropTrace.filter((s) => !(s.t >= 2900 && s.t < 3300));
const dropResult = runTrace(withGap);
check('采样断点不产生离谱速度',
  dropResult.speedMax === null || dropResult.speedMax < 12,
  'speedMax=' + (dropResult.speedMax === null ? 'null' : dropResult.speedMax.toFixed(2)));

// 10) 持续转动（例如挥手、摘戴）不应被计入出杆
const waving = [];
for (let i = 0; i < 300; i += 1) {
  const t = i * 20;
  const phase = t / 1000 * 2 * Math.PI;
  waving.push({
    t: t,
    ax: Math.sin(phase) * 2.5,
    ay: 0,
    az: 9.80665 + Math.cos(phase) * 1.5,
    gx: 0,
    gy: 1.2,
    gz: 0
  });
}
const waveResult = runTrace(waving);
check('缓慢挥手不误判为出杆', waveResult.count === 0, 'count=' + waveResult.count);

// 11) 物理模型验证：把手腕出杆建成立体运动（平移 + 手腕转动 + 重力投影变化），
//     用模型里的真实峰值速度作标准答案，检查算法估计误差。
function rotateTranspose(q, v) {
  // q = [w, x, y, z]，返回 R^T * v（把世界向量转到传感器坐标）
  const [w, x, y, z] = q;
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y),
    2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x),
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)
  ];
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2]
  ];
}

function quatFromAxisAngle(axis, angle) {
  const half = angle / 2;
  const s = Math.sin(half);
  return [Math.cos(half), axis[0] * s, axis[1] * s, axis[2] * s];
}

/** 生成一次物理模型的出杆：v(t) = V*sin^2(pi t/T)，手腕同时转 thetaMax */
function physicsTrace(spec) {
  const { peakSpeed, durationMs, thetaDeg, hz, startMs = 1200, totalMs = 4000, noise = 0.03 } = spec;
  const dt = 1000 / hz;
  const T = durationMs / 1000;
  const thetaMax = thetaDeg * Math.PI / 180;
  const samples = [];
  const axis = [0, 1, 0];              // 手腕转动轴
  const strokeDir = [0, 0, 1];         // 出杆方向（世界坐标）
  const gravityWorld = [0, -9.80665, 0];
  for (let t = 0; t < totalMs; t += dt) {
    const local = (t - startMs) / 1000;
    let speed = 0;
    let accelAlong = 0;
    let theta = 0;
    let omega = 0;
    if (local > 0 && local < T) {
      speed = peakSpeed * Math.pow(Math.sin(Math.PI * local / T), 2);
      accelAlong = peakSpeed * (Math.PI / T) * Math.sin(2 * Math.PI * local / T);
      theta = thetaMax * Math.pow(Math.sin(Math.PI * local / T), 2);
      omega = thetaMax * (Math.PI / T) * Math.sin(2 * Math.PI * local / T);
    }
    const q = quatFromAxisAngle(axis, theta);
    const accelWorld = [
      strokeDir[0] * accelAlong,
      gravityWorld[1] + strokeDir[1] * accelAlong,
      strokeDir[2] * accelAlong
    ];
    const accelSensor = rotateTranspose(q, accelWorld);
    const omegaSensor = rotateTranspose(q, [axis[0] * omega, axis[1] * omega, axis[2] * omega]);
    samples.push({
      t: t,
      ax: accelSensor[0] + gaussian() * noise,
      ay: accelSensor[1] + gaussian() * noise,
      az: accelSensor[2] + gaussian() * noise,
      gx: omegaSensor[0] + gaussian() * 0.01,
      gy: omegaSensor[1] + gaussian() * 0.01,
      gz: omegaSensor[2] + gaussian() * 0.01,
      trueSpeed: speed
    });
  }
  return samples;
}

const physicsCases = [
  { name: '轻推 2m/s @50Hz', peakSpeed: 2.0, durationMs: 250, thetaDeg: 12, hz: 50 },
  { name: '正常 4m/s @50Hz', peakSpeed: 4.0, durationMs: 280, thetaDeg: 20, hz: 50 },
  { name: '开球 6.5m/s @50Hz', peakSpeed: 6.5, durationMs: 320, thetaDeg: 25, hz: 50 },
  { name: '正常 4m/s @25Hz', peakSpeed: 4.0, durationMs: 280, thetaDeg: 20, hz: 25 },
  { name: '正常 4m/s @100Hz', peakSpeed: 4.0, durationMs: 280, thetaDeg: 20, hz: 100 }
];

for (const spec of physicsCases) {
  const trace = physicsTrace(spec);
  const engine = createCueEngine();
  for (const sample of trace) engine.feed(sample);
  const snap = engine.snapshot();
  const error = snap.speedMax ? Math.abs(snap.speedMax - spec.peakSpeed) / spec.peakSpeed : 1;
  check('物理模型 ' + spec.name + ' 检出且误差 <25%',
    snap.count >= 1 && error < 0.25,
    'count=' + snap.count + ' 估计=' + (snap.speedMax || 0).toFixed(2) +
    ' 真值=' + spec.peakSpeed + ' 误差=' + (error * 100).toFixed(1) + '%');
}

// 12) 物理模型下多杆一致性：同速 3 杆的稳定性应为高分
const physicsRepeat = [];
for (let stroke = 0; stroke < 3; stroke += 1) {
  const part = physicsTrace({
    peakSpeed: 3.5, durationMs: 260, thetaDeg: 18, hz: 50,
    startMs: 800 + stroke * 900, totalMs: 800 + stroke * 900 + 700
  });
  for (const s of part) physicsRepeat.push({ t: s.t, ax: s.ax, ay: s.ay, az: s.az, gx: s.gx, gy: s.gy, gz: s.gz });
}
const physicsRepeatResult = runTrace(physicsRepeat);
check('物理模型 3 杆一致性评分 ≥60',
  physicsRepeatResult.stability !== null && physicsRepeatResult.stability >= 60,
  'count=' + physicsRepeatResult.count + ' stability=' + physicsRepeatResult.stability);

let failed = 0;
for (const result of results) {
  if (!result.ok) failed += 1;
  console.log((result.ok ? 'PASS  ' : 'FAIL  ') + result.name + '  (' + result.detail + ')');
}
console.log('\n' + (results.length - failed) + '/' + results.length + ' 通过');
if (failed) process.exit(1);
