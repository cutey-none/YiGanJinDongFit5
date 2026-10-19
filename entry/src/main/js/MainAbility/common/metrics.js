/**
 * 出杆指标算法层（纯计算，不依赖任何系统模块，可在 Node 下用合成数据离线验证）
 *
 * 数据来源：手表加速度计（m/s^2 或 g）+ 陀螺仪（rad/s）真实采样。
 * 本模块不做任何假数据、不做随机数、不在缺少采样时编造数值；无有效采样时输出 null。
 *
 * 计算链路：
 *   1. 静止段自动标定：加速度单位（m/s^2 / g）、重力幅值、陀螺仪零偏。
 *   2. 陀螺仪辅助的互补滤波估计重力方向，得到线性加速度（去掉重力）。
 *   3. 自适应阈值出杆检测（阈值来自静止噪声基线，不写死设备量程）。
 *   4. 短窗口积分线性加速度得到手部（≈杆）速度峰值，峰值方向作为该杆方向。
 *   5. 会话聚合：出杆次数、平均/最快出杆速度、力度一致性、出杆顺滑度、
 *      方向（走位）离散度 → 出杆稳定性 / 入位稳定性。
 *
 * 物理约定：击球瞬间手（握把）的线速度即为杆的推进速度，因此用积分得到的
 * 手部速度峰值作为「出杆速度」的估计值；单位 m/s，界面按 km/h 展示。
 */

export const GRAVITY = 9.80665;

export function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function length3(vector) {
  return Math.sqrt(vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]);
}

function normalize3(vector) {
  const len = length3(vector);
  if (len < 1e-6) return [0, 0, 1];
  return [vector[0] / len, vector[1] / len, vector[2] / len];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function angleBetween(a, b) {
  return Math.acos(clamp(dot3(normalize3(a), normalize3(b)), -1, 1));
}

/** 用角速度把重力方向在传感器坐标系里转过 dt（小角近似） */
function predictGravity(gHat, omega, dt) {
  const cross = [
    omega[1] * gHat[2] - omega[2] * gHat[1],
    omega[2] * gHat[0] - omega[0] * gHat[2],
    omega[0] * gHat[1] - omega[1] * gHat[0]
  ];
  return normalize3([
    gHat[0] + cross[0] * dt,
    gHat[1] + cross[1] * dt,
    gHat[2] + cross[2] * dt
  ]);
}

function mean(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i += 1) sum += list[i];
  return list.length ? sum / list.length : 0;
}

function stdDev(list, avg) {
  if (list.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < list.length; i += 1) sum += Math.pow(list[i] - avg, 2);
  return Math.sqrt(sum / (list.length - 1));
}

export function createCueEngine(options) {
  const cfg = Object.assign({
    onsetAbs: 3.0,        // 线性加速度起杆阈值下限（m/s^2，约 0.3g，低于此值多为日常挥臂）
    onsetHold: 2,         // 连续超阈值采样数才算起杆
    releaseHold: 4,       // 连续回到阈值以下才算收杆
    refractoryMs: 250,    // 两次出杆最小间隔，避免一杆被拆成两杆
    maxStrokeMs: 700,     // 单杆最长窗口
    minSpeed: 0.60,       // 有效出杆速度下限（m/s，约 2.2km/h；再慢不是有效击球）
    maxSpeed: 25.0,       // 有效出杆速度上限（m/s）
    maxThreshold: 8.0,    // 自适应阈值上限（m/s^2），防止一次异常把检测彻底关掉
    quietRelockMs: 500,   // 连续安静多久后把重力方向重新对齐到加速度计
    gapResetMs: 120,      // 采样间隔超过这个值视为断点，重置积分器
    beta: 0.06            // 互补滤波中加速度计的权重
  }, options || {});

  const RAD_PER_DEG = Math.PI / 180;

  const state = {
    samples: 0,
    lastT: null,
    accelScale: 1,
    unitFixed: false,
    unitSamples: [],
    g0: GRAVITY,
    gHat: [0, 0, 1],
    // 陀螺仪单位未在接口文档里写明（rad/s 或 deg/s），同时跑两个假设并自动选优
    gyroScale: 1,
    gyroScaleAlt: RAD_PER_DEG,
    gHatAlt: [0, 0, 1],
    judgeCount: 0,
    judgeErrMain: 0,
    judgeErrAlt: 0,
    judgeRotation: 0,
    gyroBias: null,
    noise: 0.05,
    noiseVar: 0.0004,
    threshold: cfg.onsetAbs,
    quietMs: 0,
    over: 0,
    calm: 0,
    phase: 'idle',
    stroke: null,
    lastEndAt: -1e9,
    preBuffer: [],
    rejected: 0,
    lastRateAt: null,
    rateWindow: [],
    rateHz: 0
  };

  const strokes = [];

  function resetStrokes() {
    strokes.length = 0;
    interrupt();
  }

  function interrupt() {
    state.preBuffer.length = 0;
    state.lastT = null;
    state.lastEndAt = -1e9;
    state.over = 0;
    state.calm = 0;
    state.phase = 'idle';
    state.stroke = null;
  }

  function pushPreSample(accel, dt) {
    state.preBuffer.push({ accel: accel, dt: dt });
    if (state.preBuffer.length > 8) state.preBuffer.shift();
  }

  function finalizeStroke(endTime) {
    const stroke = state.stroke;
    if (!stroke) return;
    const speed = stroke.vPeak;
    const direction = normalize3(stroke.dPeak);
    let lateralSum = 0;
    let peakAccel = 0;
    for (let i = 0; i < stroke.accel.length; i += 1) {
      const accel = stroke.accel[i];
      const magnitude = length3(accel);
      if (magnitude > peakAccel) peakAccel = magnitude;
      const along = dot3(accel, direction);
      const lateralSq = Math.max(0, magnitude * magnitude - along * along);
      lateralSum += lateralSq;
    }
    const lateralRms = stroke.accel.length ? Math.sqrt(lateralSum / stroke.accel.length) : 0;
    const lateralRatio = peakAccel > 1e-6 ? clamp(lateralRms / peakAccel, 0, 1) : 0;
    const record = {
      endedAt: endTime,
      startedAt: stroke.t0,
      durations: stroke.duration,
      speed: speed,
      direction: direction,
      peakAccel: peakAccel,
      lateralRatio: lateralRatio
    };
    if (speed >= cfg.minSpeed && speed <= cfg.maxSpeed && stroke.accel.length >= 3) {
      strokes.push(record);
    } else {
      state.rejected += 1;
    }
    state.stroke = null;
  }

  function feed(sample) {
    if (!sample) return;
    const values = [sample.ax, sample.ay, sample.az, sample.gx || 0, sample.gy || 0, sample.gz || 0];
    for (let i = 0; i < values.length; i += 1) {
      if (typeof values[i] !== 'number' || isNaN(values[i])) return;
    }
    const now = typeof sample.t === 'number' ? sample.t : Date.now();
    const rawGapMs = state.lastT === null ? 0 : now - state.lastT;
    const dt = state.lastT === null ? 0.02 : clamp(rawGapMs / 1000, 0.004, 0.25);
    state.lastT = now;
    state.samples += 1;

    // 采样断点（丢包/传感器暂停）：丢掉当前这一杆的积分，避免把断点当成一次冲击
    if (rawGapMs > cfg.gapResetMs) {
      state.phase = 'idle';
      state.stroke = null;
      state.preBuffer.length = 0;
      state.over = 0;
      state.calm = 0;
    }

    // 采样率诊断（最近 40 个间隔）
    if (state.lastRateAt !== null) {
      const gap = now - state.lastRateAt;
      if (gap > 0 && gap < 1000) {
        state.rateWindow.push(gap);
        if (state.rateWindow.length > 40) state.rateWindow.shift();
        const avgGap = mean(state.rateWindow);
        state.rateHz = avgGap > 0 ? Math.round(1000 / avgGap) : 0;
      }
    }
    state.lastRateAt = now;

    const rawAccel = [sample.ax, sample.ay, sample.az];
    const rawMag = length3(rawAccel);

    if (!state.unitFixed) {
      state.unitSamples.push(rawMag);
      if (state.unitSamples.length >= 25) {
        const avg = mean(state.unitSamples);
        if (avg > 6 && avg < 14) {
          state.accelScale = 1;
          state.unitFixed = true;
        } else if (avg > 0.6 && avg < 1.4) {
          state.accelScale = GRAVITY;
          state.unitFixed = true;
        } else if (state.unitSamples.length >= 100) {
          state.accelScale = 1;
          state.unitFixed = true;
        }
        if (state.unitFixed) state.g0 = avg * state.accelScale;
      }
    }

    const accel = [
      rawAccel[0] * state.accelScale,
      rawAccel[1] * state.accelScale,
      rawAccel[2] * state.accelScale
    ];
    const accelMag = rawMag * state.accelScale;

    if (!state.gyroBias) {
      state.gyroBias = [sample.gx || 0, sample.gy || 0, sample.gz || 0];
      state.gHat = normalize3(accel);
      state.gHatAlt = state.gHat.slice(0);
    }

    const omega = [
      (sample.gx || 0) - state.gyroBias[0],
      (sample.gy || 0) - state.gyroBias[1],
      (sample.gz || 0) - state.gyroBias[2]
    ];

    // 重力方向预测：两个单位假设各自用陀螺仪把上一帧的重力方向转到当前姿态
    const predicted = predictGravity(state.gHat, omega, dt * state.gyroScale);
    const predictedAlt = predictGravity(state.gHatAlt, omega, dt * state.gyroScaleAlt);
    // 只有加速度幅值接近 1g（即线性加速度很小）时才信任加速度计修正
    const trust = clamp(1 - Math.abs(accelMag / state.g0 - 1) / 0.12, 0, 1);
    const beta = cfg.beta * trust;
    const accelHat = normalize3(accel);
    const blend = (pred, truth) => normalize3([
      pred[0] * (1 - beta) + truth[0] * beta,
      pred[1] * (1 - beta) + truth[1] * beta,
      pred[2] * (1 - beta) + truth[2] * beta
    ]);
    state.gHat = blend(predicted, accelHat);
    state.gHatAlt = blend(predictedAlt, accelHat);

    // 两个假设打分：只有在加速度≈1g（可信重力参考）且确实在转动时才有区分度
    if (trust > 0.7) {
      state.judgeCount += 1;
      state.judgeErrMain += angleBetween(predicted, accelHat);
      state.judgeErrAlt += angleBetween(predictedAlt, accelHat);
      state.judgeRotation += length3(omega) * dt * state.gyroScale;
    }
    if (state.judgeCount >= 40 && state.judgeRotation > 1.0) {
      if (state.judgeErrAlt < state.judgeErrMain * 0.7) {
        // 备选单位明显更贴合实测重力方向 → 切换
        const scale = state.gyroScale;
        state.gyroScale = state.gyroScaleAlt;
        state.gyroScaleAlt = scale;
        state.gHat = accelHat.slice(0);
        state.gHatAlt = accelHat.slice(0);
      }
      state.judgeCount = 0;
      state.judgeErrMain = 0;
      state.judgeErrAlt = 0;
      state.judgeRotation = 0;
    }

    const linear = [
      accel[0] - state.g0 * state.gHat[0],
      accel[1] - state.g0 * state.gHat[1],
      accel[2] - state.g0 * state.gHat[2]
    ];
    const linearMag = length3(linear);

    // 标定完成前不做检出：此时重力幅值还没确定，线性加速度不可信
    if (!state.unitFixed) return 'calibrating';

    if (state.phase === 'idle') {
      // 静止噪声基线（自适应阈值来源）
      // 向下更新快、向上更新慢，且做上限保护：单次异常不会把阈值抬到检测不到出杆
      const noiseGain = linearMag < state.noise ? 0.05 : 0.002;
      state.noise += noiseGain * (linearMag - state.noise);
      state.noise = clamp(state.noise, 0, 2.0);
      state.noiseVar += 0.002 * (Math.pow(linearMag - state.noise, 2) - state.noiseVar);
      const sigma = clamp(Math.sqrt(Math.max(state.noiseVar, 0)), 0, 1.0);
      state.threshold = clamp(
        Math.max(cfg.onsetAbs, state.noise + 6 * sigma + 0.6),
        cfg.onsetAbs,
        cfg.maxThreshold
      );

      // 连续安静时把重力方向重新对齐到加速度计，清掉姿态估计的漂移
      if (linearMag < Math.max(1.0, state.threshold * 0.4)) {
        state.quietMs += dt * 1000;
        if (state.quietMs >= cfg.quietRelockMs) {
          state.gHat = normalize3(accel);
          state.quietMs = 0;
        }
      } else {
        state.quietMs = 0;
      }

      // 静止时缓慢更新陀螺仪零偏
      state.gyroBias = [
        state.gyroBias[0] * 0.995 + (sample.gx || 0) * 0.005,
        state.gyroBias[1] * 0.995 + (sample.gy || 0) * 0.005,
        state.gyroBias[2] * 0.995 + (sample.gz || 0) * 0.005
      ];

      if (linearMag > state.threshold) {
        state.over += 1;
        if (state.over >= cfg.onsetHold && now - state.lastEndAt > cfg.refractoryMs) {
          state.phase = 'stroke';
          state.calm = 0;
          state.stroke = {
            t0: now - dt * 1000 * (cfg.onsetHold - 1),
            accel: [],
            velocity: [0, 0, 0],
            vPeak: 0,
            dPeak: [0, 0, 0],
            duration: 0
          };
          // 把起杆前的缓存样本补进积分，避免漏掉起杆最初 40ms
          for (let i = 0; i < state.preBuffer.length; i += 1) {
            const pre = state.preBuffer[i];
            state.stroke.velocity = [
              state.stroke.velocity[0] + pre.accel[0] * pre.dt,
              state.stroke.velocity[1] + pre.accel[1] * pre.dt,
              state.stroke.velocity[2] + pre.accel[2] * pre.dt
            ];
            state.stroke.accel.push(pre.accel);
          }
          state.preBuffer.length = 0;
        }
      } else {
        state.over = 0;
      }
      if (state.phase === 'idle') pushPreSample(linear, dt);
    }

    if (state.phase === 'stroke' && state.stroke) {
      const stroke = state.stroke;
      stroke.accel.push(linear);
      stroke.velocity = [
        stroke.velocity[0] + linear[0] * dt,
        stroke.velocity[1] + linear[1] * dt,
        stroke.velocity[2] + linear[2] * dt
      ];
      const velocityMag = length3(stroke.velocity);
      if (velocityMag > stroke.vPeak) {
        stroke.vPeak = velocityMag;
        stroke.dPeak = [stroke.velocity[0], stroke.velocity[1], stroke.velocity[2]];
      }
      stroke.duration = now - stroke.t0;
      if (linearMag < state.threshold * 0.5) {
        state.calm += 1;
      } else {
        state.calm = 0;
      }
      if (state.calm >= cfg.releaseHold || stroke.duration > cfg.maxStrokeMs) {
        finalizeStroke(now);
        state.phase = 'idle';
        state.lastEndAt = now;
        state.over = 0;
      }
    }
    return state.phase;
  }

  function snapshot() {
    const count = strokes.length;
    const speeds = [];
    const directions = [];
    let lateralRatioSum = 0;
    for (let i = 0; i < count; i += 1) {
      speeds.push(strokes[i].speed);
      directions.push(strokes[i].direction);
      lateralRatioSum += strokes[i].lateralRatio;
    }
    const result = {
      count: count,
      speedLast: count ? speeds[count - 1] : null,
      speedMax: count ? Math.max.apply(null, speeds) : null,
      speedAvg: count ? mean(speeds) : null,
      stability: null,
      smoothness: null,
      speedSpread: null,
      positionStability: null,
      deviationDeg: null,
      threshold: state.threshold,
      noise: state.noise,
      accelScale: state.accelScale,
      gyroScale: state.gyroScale,
      gyroUnit: state.gyroScale === 1 ? 'rad/s' : 'deg/s',
      ready: state.unitFixed,
      rateHz: state.rateHz,
      samples: state.samples,
      rejected: state.rejected,
      hint: ''
    };
    if (count === 0) {
      result.hint = '还没有检测到出杆';
      return result;
    }
    if (count < 3) {
      result.hint = '再出 ' + (3 - count) + ' 杆后给出稳定性评分';
      return result;
    }
    const avg = mean(speeds);
    const spread = stdDev(speeds, avg);
    const cv = avg > 1e-6 ? spread / avg : 1;
    const consistency = clamp(1 - cv / 0.45, 0, 1);
    const smoothness = clamp(1 - (lateralRatioSum / count) / 0.6, 0, 1);
    result.stability = Math.round(100 * (0.65 * consistency + 0.35 * smoothness));
    result.smoothness = Math.round(100 * smoothness);
    result.speedSpread = Math.round(cv * 100);

    let sum = [0, 0, 0];
    for (let i = 0; i < count; i += 1) {
      sum = [sum[0] + directions[i][0], sum[1] + directions[i][1], sum[2] + directions[i][2]];
    }
    const meanDirection = normalize3(sum);
    let deviationSq = 0;
    for (let i = 0; i < count; i += 1) {
      const cos = clamp(dot3(directions[i], meanDirection), -1, 1);
      deviationSq += Math.pow(Math.acos(cos) * 180 / Math.PI, 2);
    }
    const deviationDeg = Math.sqrt(deviationSq / count);
    result.deviationDeg = Math.round(deviationDeg * 10) / 10;
    result.positionStability = Math.round(100 * clamp(1 - deviationDeg / 25, 0, 1));
    result.hint = '基于 ' + count + ' 杆实时计算';
    return result;
  }

  return {
    feed: feed,
    snapshot: snapshot,
    resetStrokes: resetStrokes,
    interrupt: interrupt,
    strokes: strokes,
    debug: state
  };
}

/**
 * Keytel 心率-能量消耗方程（J Sports Sci, 2005），输出 kcal/min。
 * 需要心率、体重、年龄、性别；缺少任一项时返回 null（界面显示“—”，不猜值）。
 */
export function keytelPerMinute(heartRate, weightKg, ageYears, gender) {
  if (!heartRate || !weightKg || !ageYears) return null;
  if (heartRate < 35 || heartRate > 220) return null;
  if (weightKg < 25 || weightKg > 250) return null;
  if (ageYears < 10 || ageYears > 100) return null;
  const rate = gender === 'female'
    ? (-20.4022 + 0.4472 * heartRate - 0.1263 * weightKg + 0.074 * ageYears) / 4.184
    : (-55.0969 + 0.6309 * heartRate + 0.1988 * weightKg + 0.2017 * ageYears) / 4.184;
  if (rate <= 0) return 0;
  return rate;
}

/** 米每秒 → 公里每小时 */
export function toKmh(metersPerSecond) {
  if (metersPerSecond === null || metersPerSecond === undefined) return null;
  return metersPerSecond * 3.6;
}
