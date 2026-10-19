/**
 * 页面脚本：只负责界面状态与用户操作。
 * 真实传感器订阅、出杆算法、会话统计、本地持久化都在应用级 app.js 里，
 * 页面通过 lite 运行时的全局 $app 调用（`$app` 由引擎为 app.js 的实例注册）。
 */
import app from '@system.app';
import router from '@system.router';

const APPLICATION = (typeof $app !== 'undefined') ? $app : null;

function pad(value) {
  return value < 10 ? '0' + value : '' + value;
}

function clock(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  return pad(Math.floor(total / 60)) + ':' + pad(total % 60);
}

function newMatch(mode, opponent, race) {
  return {
    mode: mode,
    opponent: opponent,
    race: race,
    me: 0,
    them: 0,
    rack: 1,
    fouls: 0,
    clears: 0,
    seconds: 0,
    time: '00:00',
    lastEvent: '',
    events: []
  };
}

function newTraining() {
  return { active: false, label: '开始训练', time: '00:00', seconds: 0, success: 0, fail: 0 };
}

function emptyLive() {
  return {
    hrText: '--',
    hrRange: '等待心率',
    kcalText: '--',
    kcalNote: '热量 kcal',
    strokeText: '0',
    speedText: '--',
    speedNote: '最近一杆 km/h',
    speedMaxText: '最快 --',
    stabilityText: '--',
    stabilityNote: '出杆稳定性',
    positionText: '--',
    positionNote: '入位稳定性',
    sensorText: '正在连接传感器…',
    sensorDetail: '',
    rawText: '',
    sensorOk: false,
    wornText: '佩戴状态未知',
    rateText: '--',
    hint: ''
  };
}

export default {
  data: {
    view: 'home',
    mode: '8球',
    race: 3,
    opponent: '球友',
    sessions: [],
    hasSessions: false,
    noSessions: true,
    lastSession: {},
    batteryText: '--',
    sensorLine: '传感器状态读取中',
    profile: { gender: 'male', genderText: '男', age: 30, ageText: '30 岁', weight: 68, weightText: '68 kg' },
    settings: { vibrate: true, motion: true, vibrateText: '开', motionText: '开' },
    match: newMatch('8球', '球友', 3),
    training: newTraining(),
    live: emptyLive()
  },

  onInit() {
    this.engineApp = APPLICATION;
    this.loadState();
    this.refresh();
    this.timer = setInterval(() => this.tick(), 1000);
    if (!this.engineApp) {
      console.info('[yigangjindong] 未拿到应用实例，传感器数据不可用');
    }
  },

  onShow() {
    if (this.engineApp) this.engineApp.setForeground(true);
    this.loadState();
    this.refresh();
  },

  onHide() {
    if (this.engineApp) this.engineApp.setForeground(false);
  },

  onDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  // ---------------- 状态 ----------------

  loadState() {
    if (!this.engineApp) return;
    const state = this.engineApp.getState();
    this.sessions = state.sessions || [];
    this.lastSession = this.sessions[0] || {};
    if (state.match) this.match = state.match;
    if (state.training) this.training = state.training;
    this.profile = Object.assign({ gender: 'male', age: 30, weight: 68 }, state.profile || {});
    this.settings = Object.assign({ vibrate: true, motion: true }, state.settings || {});
    this.batteryText = state.batteryText || '--';
    this.refreshProfileText();
    this.refreshSettingsText();
  },

  refreshProfileText() {
    this.profile = Object.assign({}, this.profile, {
      genderText: this.profile.gender === 'female' ? '女' : '男',
      ageText: this.profile.age + ' 岁',
      weightText: this.profile.weight + ' kg'
    });
  },

  refreshSettingsText() {
    this.settings = Object.assign({}, this.settings, {
      vibrateText: this.settings.vibrate ? '开' : '关',
      motionText: this.settings.motion ? '开' : '关'
    });
  },

  refresh() {
    if (this.engineApp) {
      const metrics = this.engineApp.getMetrics();
      const live = emptyLive();
      Object.keys(live).forEach((key) => {
        if (metrics[key] !== undefined) live[key] = metrics[key];
      });
      this.live = live;
      if (metrics.batteryText) this.batteryText = metrics.batteryText;
      this.sensorLine = this.engineApp.getSensorLine();
    }
    this.hasSessions = this.sessions.length > 0;
    this.noSessions = this.sessions.length === 0;
  },

  tick() {
    if (this.view === 'match') {
      this.match.seconds = (this.match.seconds || 0) + 1;
      this.match.time = clock(this.match.seconds);
      this.engineApp && this.engineApp.setMatch(this.match);
    }
    if (this.view === 'training' && this.training.active) {
      this.training.seconds += 1;
      this.training.time = clock(this.training.seconds);
    }
    this.refresh();
  },

  // ---------------- 视图切换 ----------------

  openSetup() { this.view = 'setup'; },
  openTraining() { this.view = 'training'; this.refresh(); },
  openHistory() { this.view = 'history'; },
  openLive() { this.view = 'live'; this.refresh(); },
  openSettings() { this.view = 'settings'; this.refresh(); },
  goHome() { this.view = 'home'; },
  openSport() { router.replace({ uri: 'pages/sport/sport' }); },
  choose8() { this.mode = '8球'; },
  choose9() { this.mode = '9球'; },
  chooseOne() { this.race = 1; },
  chooseThree() { this.race = 3; },
  chooseFive() { this.race = 5; },
  changeOpponent(event) { this.opponent = event.text || '球友'; },

  // ---------------- 对局 ----------------

  startMatch() {
    if (this.engineApp && this.engineApp.sportData().workout) { this.openSport(); return; }
    if (this.engineApp) this.engineApp.startSession();
    this.match = newMatch(this.mode, this.opponent || '球友', this.race);
    this.view = 'match';
    this.refresh();
    if (this.engineApp) this.engineApp.setMatch(this.match);
  },

  addEvent(type, text) {
    this.match.events.push({ type: type, text: text });
    this.match.lastEvent = text;
    if (this.engineApp) this.engineApp.setMatch(this.match);
  },

  winMe() {
    this.match.me += 1;
    this.match.rack = this.match.me + this.match.them + 1;
    this.addEvent('me', '我赢下一局');
    if (this.engineApp) this.engineApp.vibrate();
    this.finishIfNeeded();
  },

  winThem() {
    this.match.them += 1;
    this.match.rack = this.match.me + this.match.them + 1;
    this.addEvent('them', this.match.opponent + ' 赢下一局');
    if (this.engineApp) this.engineApp.vibrate();
    this.finishIfNeeded();
  },

  foul() { this.match.fouls += 1; this.addEvent('foul', '记录一次犯规'); },
  clearRack() { this.match.clears += 1; this.addEvent('clear', '记录一次清台'); },

  undo() {
    const event = this.match.events.pop();
    if (!event) return;
    if (event.type === 'me') this.match.me = Math.max(0, this.match.me - 1);
    if (event.type === 'them') this.match.them = Math.max(0, this.match.them - 1);
    if (event.type === 'foul') this.match.fouls = Math.max(0, this.match.fouls - 1);
    if (event.type === 'clear') this.match.clears = Math.max(0, this.match.clears - 1);
    this.match.rack = this.match.me + this.match.them + 1;
    this.match.lastEvent = '已撤销上一步';
    if (this.engineApp) this.engineApp.setMatch(this.match);
  },

  endMatch() { this.saveMatch(); },

  finishIfNeeded() {
    if (this.match.me >= this.match.race || this.match.them >= this.match.race) this.saveMatch();
  },

  saveMatch() {
    const raw = this.engineApp ? this.engineApp.sessionRaw() : {};
    const session = {
      mode: this.match.mode,
      opponent: this.match.opponent,
      me: this.match.me,
      them: this.match.them,
      duration: Math.max(1, Math.round((this.match.seconds || 1) / 60)) + '分钟',
      seconds: this.match.seconds || 0,
      date: '刚刚',
      result: this.match.me >= this.match.them ? '胜' : '负',
      fouls: this.match.fouls,
      clears: this.match.clears,
      strokes: raw.strokes || 0,
      speedMax: raw.speedMax || null,
      stability: raw.stability === undefined ? null : raw.stability,
      positionStability: raw.positionStability === undefined ? null : raw.positionStability,
      hrMax: raw.hrMax || null,
      hrAvg: raw.hrAvg || null,
      kcal: raw.kcal || 0
    };
    session.metricText = this.buildMetricText(session);
    if (this.engineApp) this.engineApp.addSession(session);
    this.sessions = [session].concat(this.sessions).slice(0, 40);
    this.lastSession = session;
    this.view = 'summary';
    this.match = newMatch(session.mode, session.opponent, this.race);
    if (this.engineApp) this.engineApp.startSession();
    this.refresh();
  },

  buildMetricText(session) {
    const parts = [];
    if (session.strokes) parts.push('出杆 ' + session.strokes + ' 次');
    if (session.speedMax) parts.push('最快 ' + session.speedMax + ' km/h');
    if (session.stability !== null && session.stability !== undefined) parts.push('稳定性 ' + session.stability);
    if (session.hrMax) parts.push('最高心率 ' + session.hrMax);
    if (session.kcal) parts.push('热量 ' + session.kcal + ' kcal');
    return parts.length ? parts.join(' · ') : '本次未采集到传感器数据';
  },

  // ---------------- 训练 ----------------

  toggleTraining() {
    if (this.engineApp && this.engineApp.sportData().workout) { this.openSport(); return; }
    this.training.active = !this.training.active;
    this.training.label = this.training.active ? '暂停训练' : '开始训练';
    if (this.training.active) {
      if (this.engineApp) {
        this.engineApp.startSession();
        this.engineApp.vibrate();
      }
    }
    if (this.engineApp) this.engineApp.setTraining(this.training);
    this.refresh();
  },

  trainingSuccess() {
    this.training.success += 1;
    if (this.engineApp) {
      this.engineApp.vibrate();
      this.engineApp.setTraining(this.training);
    }
  },

  trainingFail() {
    this.training.fail += 1;
    if (this.engineApp) this.engineApp.setTraining(this.training);
  },

  // ---------------- 设置 ----------------

  setGenderMale() { this.profile.gender = 'male'; this.afterProfileChange(); },
  setGenderFemale() { this.profile.gender = 'female'; this.afterProfileChange(); },
  ageDown() { this.profile.age = Math.max(10, this.profile.age - 1); this.afterProfileChange(); },
  ageUp() { this.profile.age = Math.min(100, this.profile.age + 1); this.afterProfileChange(); },
  weightDown() { this.profile.weight = Math.max(30, this.profile.weight - 1); this.afterProfileChange(); },
  weightUp() { this.profile.weight = Math.min(200, this.profile.weight + 1); this.afterProfileChange(); },

  afterProfileChange() {
    this.profile = Object.assign({}, this.profile);
    this.refreshProfileText();
    if (this.engineApp) {
      this.engineApp.setProfile({ gender: this.profile.gender, age: this.profile.age, weight: this.profile.weight });
    }
    this.refresh();
  },

  toggleVibrate() {
    this.settings.vibrate = !this.settings.vibrate;
    this.afterSettingsChange();
  },

  toggleMotion() {
    this.settings.motion = !this.settings.motion;
    this.afterSettingsChange();
  },

  afterSettingsChange() {
    this.settings = Object.assign({}, this.settings);
    this.refreshSettingsText();
    if (this.engineApp) {
      this.engineApp.setSettings({ vibrate: this.settings.vibrate, motion: this.settings.motion });
    }
    this.refresh();
  },

  // ---------------- 手势 ----------------

  onSwipe(event) {
    if (event.direction !== 'right') return;
    if (this.view === 'home') {
      app.terminate();
    } else {
      this.goHome();
    }
  }
};
