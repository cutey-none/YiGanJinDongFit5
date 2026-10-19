/**
 * 应用级 JS：持有真实传感器订阅 + 出杆算法引擎 + 会话统计 + 本地持久化。
 *
 * 为什么放在 app.js：Lite Wearable 运行时限制「单个 JS 文件不得超过 48KB」
 * （见 ACELite 源码 FILE_CONTENT_LENGTH_MAX = 1024 * 48），超限会把页面当成
 * 快照字节码并加载失败。把算法与大块逻辑放在应用级文件里，页面脚本才能保持在限制内。
 *
 * 页面通过 lite 运行时的全局 $app 访问这里的方法。
 */
import storage from '@system.storage';
import sensor from '@system.sensor';
import battery from '@system.battery';
import vibrator from '@system.vibrator';
import { createCueEngine, keytelPerMinute, toKmh } from './common/metrics.js';

import { createWorkout, elapsedWorkout, pauseWorkout, resumeWorkout, analyzeShots, prepareWorkout, appendShot, archiveWorkout } from './common/workout.js';

const STATE_KEY = 'yigangjindong.fit5.state';

function defaultProfile() {
  return { gender: 'male', age: 30, weight: 68 };
}

function defaultSettings() {
  return { vibrate: true, motion: true };
}

function emptySession() {
  return {
    startedAt: Date.now(),
    hr: null,
    hrMin: null,
    hrMax: null,
    hrSum: 0,
    hrCount: 0,
    kcal: 0,
    kcalReady: false
  };
}

export default {
  onCreate() {
    this.engine = createCueEngine();
    this.ready = false;
    this.storageState = '正在保存';
    this.engineSeen = 0;
    this.profile = defaultProfile();
    this.settings = defaultSettings();
    this.sessions = [];
    this.workout = null;
    this.workouts = [];
    this.match = null;
    this.training = null;
    this.session = emptySession();
    this.hr = null;
    this.hrAt = 0;
    this.worn = null;
    this.batteryText = '--';
    this.lastGyro = null;
    this.lastAccel = null;
    this.accelCount = 0;
    this.gyroCount = 0;
    this.hrCount = 0;
    this.sensorErrors = [];
    this.sensorsOn = false;
    this.foreground = true;
    this.lastKcalAt = Date.now();
    this.lastLogAt = Date.now();
    this.readBattery();
    this.restore();
    // 引擎里 @system.storage 的回调可能几秒后才到、甚至不来：不能让界面一直卡在未就绪，
    // 超时后按「存储暂不可用」继续，本地记录仍可在内存里工作。
    this.restoreTimer = setTimeout(() => this.finishRestore('存储未响应，暂存内存'), 1500);
    this.timer = setInterval(() => this.tick(), 1000);
    console.info('[yigangjindong] 应用启动，等待真实传感器数据');
  },

  onDestroy() {
    if (this.workout) this.pauseSport();
    if (this.restoreTimer) { clearTimeout(this.restoreTimer); this.restoreTimer = null; }
    if (this.writeTimer) { clearTimeout(this.writeTimer); this.writeTimer = null; this.writing = false; }
    this.stopSensors();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  // ---------------- 本地持久化 ----------------

  restore() {
    storage.get({
      key: STATE_KEY,
      success: (value) => {
        // The timeout may already have made the app usable. A late read must
        // never replace a workout the user started after that timeout.
        if (this.ready) return;
        if (!value) { this.finishRestore(); return; }
        try {
          const saved = JSON.parse(value);
          this.sessions = saved.sessions || [];
          this.workouts = saved.workouts || [];
          this.workout = saved.workout || null;
          if (this.workout) {
            prepareWorkout(this.workout);
            this.workout.paused = true;
            this.workout.breakBeforeNext = true;
            this.workout.resumedAt = Date.now();
            this.engine.resetStrokes();
            (this.workout.shots || []).forEach((shot) => this.engine.strokes.push(shot));
            this.engineSeen = this.engine.strokes.length;
            this.session.kcal = this.workout.kcal || 0;
            this.session.kcalReady = this.workout.kcal !== null;
          }
          this.match = saved.match || null;
          this.training = saved.training || null;
          this.profile = Object.assign(defaultProfile(), saved.profile || {});
          this.settings = Object.assign(defaultSettings(), saved.settings || {});
          if (!this.settings.motion) this.stopSensors();
          console.info('[yigangjindong] 已恢复本地记录 ' + this.sessions.length + ' 条');
        } catch (error) {
          console.info('[yigangjindong] 本地记录解析失败，按空记录启动');
        }
        this.storageState = '已保存';
        this.finishRestore();
      },
      fail: () => { if (!this.ready) this.finishRestore('存储不可用，暂存内存'); }
    });
  },

  finishRestore(note) {
    if (this.restoreTimer) { clearTimeout(this.restoreTimer); this.restoreTimer = null; }
    if (this.ready) return;
    this.ready = true;
    this.storageState = note || '已保存';
    this.startSensors();
  },

  persist() {
    if (!this.ready) return;
    this.pendingWrite = JSON.stringify({ sessions: this.sessions, workout: this.workout, workouts: this.workouts,
      match: this.match, training: this.training, profile: this.profile, settings: this.settings });
    this.flushWrite();
  },

  flushWrite() {
    if (this.writing || !this.pendingWrite) return;
    const value = this.pendingWrite;
    this.pendingWrite = null; this.writing = true; this.storageState = '正在保存';
    const done = (ok, note) => {
      if (this.writeTimer) { clearTimeout(this.writeTimer); this.writeTimer = null; }
      if (!this.writing) return;
      this.writing = false;
      this.storageState = note || (ok ? '已保存' : '保存失败，暂存内存');
      if (this.pendingWrite) this.flushWrite();
    };
    // 引擎里 storage.set 的回调不保证回来：超时后按「已写入」继续，否则写队列会永久卡住，
    // 后面的记录一条都存不下去（真机上同样是这个风险）。
    this.writeTimer = setTimeout(() => {
      done(true, '已提交，待重启确认');
    }, 800);
    try { storage.set({ key: STATE_KEY, value: value, success: () => done(true), fail: () => done(false) }); }
    catch (error) { done(false); }
  },

  getState() {
    return {
      sessions: this.sessions.slice(0),
      match: this.match,
      training: this.training,
      profile: Object.assign({}, this.profile),
      settings: Object.assign({}, this.settings),
      batteryText: this.batteryText
    };
  },

  setProfile(profile) {
    this.profile = Object.assign(defaultProfile(), profile);
    this.persist();
  },

  setSettings(settings) {
    const previous = this.settings.motion;
    this.settings = Object.assign(defaultSettings(), settings);
    this.persist();
    if (this.settings.motion !== previous) {
      if (this.settings.motion) {
        this.startSensors();
      } else {
        this.stopSensors();
      }
    }
  },

  setMatch(match) {
    this.match = match;
    this.persist();
  },

  setTraining(training) {
    this.training = training;
    this.persist();
  },

  addSession(session) {
    this.sessions = [session].concat(this.sessions).slice(0, 40);
    this.match = null;
    this.persist();
  },

  clearAll() {
    this.sessions = [];
    this.match = null;
    this.training = null;
    this.workout = null; this.workouts = []; this.engine.resetStrokes();
    this.persist();
  },

  readBattery() {
    try {
      battery.getStatus({
        success: (data) => {
          if (!data || typeof data.level !== 'number') return;
          this.batteryText = (data.charging ? '充电 ' : '') + Math.round(data.level * 100) + '%';
        },
        fail: () => { this.batteryText = '--'; }
      });
    } catch (error) {
      this.batteryText = '--';
    }
  },

  // ---------------- 真实手表传感器 ----------------

  startSensors() {
    if (!this.ready || this.sensorsOn || !this.settings.motion) return;
    const self = this;
    this.sensorErrors = [];
    const supported = (name) => !!sensor && typeof sensor[name] === 'function';
    try {
      // 每个传感器独立探测：手表没有的传感器不影响其它传感器（例如心率）
      if (supported('subscribeHeartRate')) {
        sensor.subscribeHeartRate({
          success: (data) => self.onHeartRate(data),
          fail: (message) => self.onSensorFail('心率', message)
        });
      } else {
        this.sensorErrors.push('心率');
      }
      if (supported('subscribeAccelerometer')) {
        sensor.subscribeAccelerometer({
          interval: 'game',
          success: (data) => self.onAccel(data),
          fail: (message) => self.onSensorFail('加速度计', message)
        });
      } else {
        this.sensorErrors.push('加速度计');
      }
      if (supported('subscribeGyroscope')) {
        sensor.subscribeGyroscope({
          interval: 'game',
          success: (data) => self.onGyro(data),
          fail: (message) => self.onSensorFail('陀螺仪', message)
        });
      } else {
        this.sensorErrors.push('陀螺仪');
      }
      if (supported('subscribeOnBodyState')) {
        sensor.subscribeOnBodyState({
          success: (data) => { self.worn = !!(data && data.value); },
          fail: () => { self.worn = null; }
        });
      }
      this.sensorsOn = true;
      console.info('[yigangjindong] 传感器订阅完成，不可用：' + (this.sensorErrors.join('、') || '无'));
    } catch (error) {
      this.sensorErrors.push('订阅异常');
      console.info('[yigangjindong] 传感器订阅异常: ' + (error && error.message ? error.message : error));
    }
  },

  stopSensors() {
    if (!this.sensorsOn) return;
    try {
      if (sensor && typeof sensor.unsubscribeHeartRate === 'function') sensor.unsubscribeHeartRate();
      if (sensor && typeof sensor.unsubscribeAccelerometer === 'function') sensor.unsubscribeAccelerometer();
      if (sensor && typeof sensor.unsubscribeGyroscope === 'function') sensor.unsubscribeGyroscope();
      if (sensor && typeof sensor.unsubscribeOnBodyState === 'function') sensor.unsubscribeOnBodyState();
    } catch (error) {
      // 部分固件不支持取消订阅
    }
    this.sensorsOn = false;
    console.info('[yigangjindong] 已停止传感器订阅');
  },

  setForeground(foreground) {
    this.foreground = !!foreground;
    if (this.foreground) this.startSensors();
    else { if (this.workout) this.pauseSport(); this.stopSensors(); }
  },

  onSensorFail(name, message) {
    if (this.sensorErrors.indexOf(name) < 0) this.sensorErrors.push(name);
    console.info('[yigangjindong] ' + name + '订阅失败: ' + (message || ''));
  },

  onAccel(data) {
    if (!data || !this.ready || !this.settings.motion || !this.sensorsOn) return;
    // 明确「未佩戴」时不采信运动数据：手表放在桌上/包里不应产生出杆
    if (this.worn === false || (this.workout && this.workout.paused)) return;
    this.lastAccel = { x: data.x, y: data.y, z: data.z };
    this.accelCount += 1;
    if (!this.lastGyro || Date.now() - this.gyroAt > 250) { this.engine.interrupt(); return; }
    const gyro = this.lastGyro;
    this.engine.feed({
      t: Date.now(),
      ax: data.x,
      ay: data.y,
      az: data.z,
      gx: gyro.x,
      gy: gyro.y,
      gz: gyro.z
    });
  },

  onGyro(data) {
    if (!data || !this.settings.motion || !this.sensorsOn) return;
    this.gyroAt = Date.now();
    this.gyroCount += 1;
    this.lastGyro = { x: data.x, y: data.y, z: data.z };
  },

  onHeartRate(data) {
    if (!this.settings.motion || !this.sensorsOn || this.worn === false) return;
    const value = data && data.heartRate;
    // lite wearable 心率无效值为 0 或 255
    if (!value || value === 255 || value < 30 || value > 220) return;
    this.hrCount += 1;
    this.hr = value;
    this.hrAt = Date.now();
    if (this.workout && this.workout.paused) return;
    const session = this.session;
    session.hr = value;
    session.hrMin = session.hrMin === null ? value : Math.min(session.hrMin, value);
    session.hrMax = session.hrMax === null ? value : Math.max(session.hrMax, value);
    session.hrSum += value;
    session.hrCount += 1;
  },

  // ---------------- 每秒汇总 ----------------

  tick() {
    const now = Date.now();
    const elapsed = Math.max(0.2, (now - this.lastKcalAt) / 1000);
    this.lastKcalAt = now;
    this.accumulateCalories(elapsed);
    if (this.workout) {
      this.syncWorkout();
      if (!this.lastSportSave || now - this.lastSportSave >= 5000) { this.persist(); this.lastSportSave = now; }
    }
    if (now - this.lastLogAt > 10000) {
      this.lastLogAt = now;
      const snapshot = this.engine.snapshot();
      console.info('[yigangjindong] 采样 acc=' + this.accelCount + ' gyro=' + this.gyroCount +
        ' hr=' + this.hrCount + ' | 出杆=' + snapshot.count +
        ' 采样率=' + snapshot.rateHz + 'Hz 阈值=' + snapshot.threshold.toFixed(2) +
        ' | 心率=' + (this.hr === null ? '--' : this.hr) +
        ' 热量=' + this.session.kcal.toFixed(2) + 'kcal' +
        ' | 就绪=' + (this.ready ? '是' : '否') + ' 存储=' + this.storageState +
        ' 出杆记录=' + (this.workout ? this.workout.shots.length : 0));
    }
  },

  accumulateCalories(elapsedSeconds) {
    const session = this.session;
    if (!this.settings.motion || !this.sensorsOn || this.worn === false || (this.workout && this.workout.paused)) return;
    const fresh = this.hr !== null && (Date.now() - this.hrAt) < 30000;
    if (!fresh) return;
    const perMinute = keytelPerMinute(this.hr, this.profile.weight, this.profile.age, this.profile.gender);
    session.kcalReady = perMinute !== null;
    if (perMinute === null) return;
    session.kcal += perMinute / 60 * Math.min(2, Math.max(0, elapsedSeconds));
  },

  startSession() {
    this.engine.resetStrokes();
    this.engineSeen = 0;
    this.session = emptySession();
    this.lastKcalAt = Date.now();
  },

  sessionRaw() {
    const snapshot = this.engine.snapshot();
    const session = this.session;
    return {
      strokes: snapshot.count,
      speedMax: snapshot.speedMax === null ? null : Math.round(toKmh(snapshot.speedMax) * 10) / 10,
      speedAvg: snapshot.speedAvg === null ? null : Math.round(toKmh(snapshot.speedAvg) * 10) / 10,
      stability: snapshot.stability,
      positionStability: snapshot.positionStability,
      deviationDeg: snapshot.deviationDeg,
      hrMin: session.hrMin,
      hrMax: session.hrMax,
      hrAvg: session.hrCount ? Math.round(session.hrSum / session.hrCount) : null,
      kcal: Math.round(session.kcal * 10) / 10,
      samples: snapshot.samples,
      rateHz: snapshot.rateHz
    };
  },

  beginWorkout(mode) {
    if (this.workout) return;
    this.startSession();
    this.workout = prepareWorkout(createWorkout(mode, Date.now()));
    this.persist(); this.vibrate();
  },

  syncWorkout() {
    if (!this.workout) return;
    const strokes = this.engine.strokes;
    for (let i = this.engineSeen; i < strokes.length; i += 1) appendShot(this.workout, strokes[i]);
    if (strokes.length > 120) strokes.splice(0, strokes.length - 120);
    this.engineSeen = strokes.length;
    if (this.session.kcalReady) this.workout.kcal = this.session.kcal;
    const now = Date.now();
    this.workout.elapsed = elapsedWorkout(this.workout, now);
    this.workout.resumedAt = now;
  },

  pauseSport() {
    if (!this.workout || this.workout.paused) return;
    this.syncWorkout();
    pauseWorkout(this.workout, Date.now());
    this.engine.interrupt(); this.persist();
  },

  resumeSport() {
    if (!this.workout || !this.workout.paused) return;
    resumeWorkout(this.workout, Date.now());
    this.engine.interrupt(); this.lastKcalAt = Date.now();
    this.persist();
  },

  finishSport() {
    if (!this.workout) return null;
    this.pauseSport();
    const record = archiveWorkout(this.workout);
    record.date = new Date().toISOString(); record.id = Date.now();
    this.workouts = [record].concat(this.workouts).slice(0, 20);
    this.workout = null; this.startSession(); this.persist(); this.vibrate();
    return record;
  },

  sportData(record) {
    this.syncWorkout();
    const w = record || this.workout;
    if (w) prepareWorkout(w);
    return { workout: w, history: this.workouts, ready: this.ready, storageState: this.storageState,
      analysis: analyzeShots(w ? w.shots : [], w ? w.totals : null) };
  },

  // 给界面用的展示数据（全部来自真实采样，无采样时显示 "--"）
  getMetrics() {
    const snapshot = this.engine.snapshot();
    const session = this.session;
    const fresh = this.hr !== null && (Date.now() - this.hrAt) < 30000;
    const speedLast = toKmh(snapshot.speedLast);
    const speedMax = toKmh(snapshot.speedMax);
    const metrics = {
      hrText: fresh ? '' + this.hr : '--',
      hrRange: '等待心率数据',
      kcalText: '--',
      kcalNote: '热量 kcal',
      strokeText: '' + snapshot.count,
      speedText: '--',
      speedNote: '最近一杆 km/h',
      speedMaxText: '最快 --',
      stabilityText: snapshot.stability === null ? '--' : '' + snapshot.stability,
      stabilityNote: snapshot.speedSpread === null
        ? '出杆稳定性'
        : '出杆稳定性 · 力度差 ' + snapshot.speedSpread + '%',
      positionText: '--',
      positionNote: '入位需球位追踪',
      sensorText: '传感器：等待采样',
      sensorDetail: '',
      rawText: '',
      sensorOk: false,
      wornText: this.worn === null ? '佩戴状态未知' : (this.worn ? '已佩戴' : '未佩戴'),
      rateText: snapshot.rateHz ? snapshot.rateHz + 'Hz' : '--',
      hint: snapshot.hint || '',
      batteryText: this.batteryText
    };

    if (session.hrMin !== null && session.hrMax !== null) {
      metrics.hrRange = '最低 ' + session.hrMin + ' · 最高 ' + session.hrMax;
    } else if (this.sensorErrors.indexOf('心率') >= 0) {
      metrics.hrRange = '心率不可用';
    } else {
      metrics.hrRange = '等待心率数据';
    }

    if (session.kcal > 0) {
      metrics.kcalText = session.kcal < 10 ? session.kcal.toFixed(1) : '' + Math.round(session.kcal);
      metrics.kcalNote = '热量 kcal';
    } else if (!this.settings.motion) {
      metrics.kcalNote = '热量 kcal（已关闭）';
    } else if (fresh) {
      metrics.kcalNote = '热量 kcal 累计中';
    }

    if (speedLast !== null) {
      metrics.speedText = speedLast.toFixed(1);
      metrics.speedMaxText = '最快 ' + speedMax.toFixed(1) + ' km/h';
    }

    const problems = this.sensorErrors.slice(0);
    if (!this.settings.motion) problems.push('运动数据已关闭');
    metrics.sensorOk = problems.length === 0 && snapshot.samples > 0;
    if (problems.length) {
      metrics.sensorText = '传感器：' + problems.join('、') + ' 不可用';
    } else if (snapshot.samples === 0) {
      metrics.sensorText = '传感器：等待采样';
    } else if (!snapshot.ready) {
      metrics.sensorText = '传感器：标定中…';
    } else {
      metrics.sensorText = '传感器：真实采样 ' + snapshot.rateHz + 'Hz · 累计 ' + snapshot.samples + ' 点';
    }
    // 逐个传感器的自检结果，真机上直接看这一行就能确认哪些传感器可用
    const accelUnit = snapshot.accelScale === 1 ? 'm/s²' : 'g';
    metrics.sensorDetail = '心率 ' + (this.hrCount > 0 ? this.hrCount + ' 次' : '无数据') +
      ' · 加速 ' + (this.accelCount > 0
        ? this.accelCount + ' 点/' + (snapshot.rateHz || 0) + 'Hz ' + accelUnit
        : '不可用') +
      ' · 陀螺 ' + (this.gyroCount > 0
        ? this.gyroCount + ' 点 ' + snapshot.gyroUnit
        : '不可用');
    // 原始读数（真机上用这一行确认「确实读到了手表的数据」）
    const accel = this.lastAccel;
    const gyro = this.lastGyro;
    const fmt = (v) => (v >= 0 ? ' ' : '') + v.toFixed(2);
    metrics.rawText = (accel ? 'a(' + fmt(accel.x) + ',' + fmt(accel.y) + ',' + fmt(accel.z) + ')' : 'a(--,--,--)') +
      ' ' + accelUnit +
      ' · ' + (gyro ? 'ω(' + fmt(gyro.x) + ',' + fmt(gyro.y) + ',' + fmt(gyro.z) + ')' : 'ω(--,--,--)') +
      ' ' + snapshot.gyroUnit;
    return metrics;
  },

  vibrate() {
    if (!this.settings.vibrate) return;
    try {
      vibrator.vibrate();
    } catch (error) {
      // 不支持振动时忽略
    }
  },

  // 首页/设置页用的简短传感器状态，全部来自真实订阅与采样计数
  getSensorLine() {
    if (!this.settings.motion) return '运动传感器：已关闭';
    const parts = [];
    parts.push('心率 ' + (this.hr === null ? '无数据' : this.hr + ' bpm'));
    const snapshot = this.engine.snapshot();
    if (snapshot.samples > 0) {
      parts.push('出杆采样 ' + snapshot.samples + ' 点/' + snapshot.rateHz + 'Hz');
    } else if (this.sensorErrors.length) {
      parts.push('加速度计/陀螺仪不可用');
    } else {
      parts.push('等待加速度计数据');
    }
    return parts.join(' · ');
  }
};
