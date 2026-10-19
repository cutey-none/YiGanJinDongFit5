import router from '@system.router';
const APPLICATION = typeof $app !== 'undefined' ? $app : null;
function duration(ms) { const t = Math.floor(ms / 1000); return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map((v) => v < 10 ? '0' + v : '' + v).join(':'); }
function number(v, digits) { return v === null || v === undefined ? '--' : v.toFixed(digits || 0); }
export default {
  data: {
    view: 'home', mode: '中式八球', time: '00:00:00', now: '', active: false,
    speed: '--', rhythm: '--', stability: '--', position: '--', kcal: '--', caption: '等待采集',
    title: '', value: '--', unit: '%', note: '', shotLabel: '暂无出杆', shotSpeed: '--', shotStability: '--',
    shotPosition: '--', noShot: true, yTop: '2.0', yMid: '1.0', yBottom: '0',
    backVisible: false, empty: true, history: [], summaryMode: '', summaryTime: '00:00:00', chartVisible: false,
    summaryShots: '0', savedNotice: '', axisText: '', selectedShot: -1, topTitle: '台球', mainDots: '●  ○  ○',
    analysisDots: '○  ●  ○', poseDots: '○  ○  ●', detailPhoto: '/common/images/pool-hero.png',
    /* 画布内部绘制尺寸：canvas 元素是 386×132 / 318×132，绘制区留出纵向余量 */
    chartW: 386, chartH: 110, ballW: 308, ballH: 110
  },
  onInit() { this.engineApp = APPLICATION; this.refresh(); this.timer = setInterval(() => this.refresh(), 1000); },
  onShow() { if (this.engineApp) this.engineApp.setForeground(true); this.refresh(); if (this.active && this.workout.paused && this.view === 'workout') this.change('paused'); },
  onHide() { if (this.engineApp) this.engineApp.setForeground(false); },
  onDestroy() { if (this.timer) clearInterval(this.timer); },
  refresh() { try { this.refreshState(); } catch (error) { console.info('[sport] refresh failed: ' + error.message); } },
  refreshState() {
    const d = new Date(); this.now = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    const state = this.engineApp ? this.engineApp.sportData(this.review) : { workout: null, history: [], analysis: { count: 0, speeds: [], intervals: [], directions: [], numbers: [], intervalNumbers: [] } };
    this.workout = state.workout; this.analytics = state.analysis;
    this.active = !this.review && !!this.workout;
    this.time = duration(this.workout ? this.workout.elapsed + (this.workout.paused ? 0 : Math.max(0, Date.now() - this.workout.resumedAt)) : 0);
    // 总结页只关心有没有写下去：保存中/已保存都表示记录留在本地，失败时如实说明。
    const storage = state.storageState || '';
    this.savedNotice = (storage.indexOf('存储') === 0 || storage.indexOf('失败') >= 0) ? '未保存到本地' : '已保存';
    this.speed = number(this.analytics.average, 2); this.rhythm = number(this.analytics.rhythm);
    this.stability = number(this.analytics.stability); this.kcal = number(this.workout ? this.workout.kcal : null);
    this.position = '--';
    this.history = state.history.map((r, i) => ({ index: i, mode: r.mode, time: duration(r.elapsed), date: r.date.slice(0, 10) }));
    this.empty = this.history.length === 0;
    this.topTitle = this.view === 'home' ? '台球' : (this.view === 'workout' ? (this.workout ? this.workout.mode : this.mode) : '');
    this.backVisible = this.view !== 'home' && this.view !== 'workout';
    this.refreshDetails();
  },
  refreshDetails() {
    const titles = { speed: '出杆速度', rhythm: '行律', stability: '出杆稳定性', position: '入位稳定性', posture: '姿势检测', analysis: '本杆分析', calories: '热量' };
    this.title = titles[this.view] || '';
    this.value = this.view === 'speed' ? this.speed : (this.view === 'rhythm' ? this.rhythm : (this.view === 'stability' ? this.stability : (this.view === 'calories' ? this.kcal : '--')));
    this.unit = this.view === 'speed' ? 'm/s' : (this.view === 'calories' ? 'kcal' : '%');
    this.caption = this.view === 'speed' ? '平均值' : (this.value === '--' ? '等待采集' : (Number(this.value) >= 90 ? '稳定' : (Number(this.value) >= 75 ? '较稳定' : '有待改善')));
    this.speedMax = Math.max(2, Math.ceil(Math.max.apply(null, [0].concat(this.analytics.speeds || []))));
    this.yTop = this.view === 'speed' ? this.speedMax.toFixed(1) : '快';
    this.yMid = this.view === 'speed' ? (this.speedMax / 2).toFixed(1) : '标准';
    this.yBottom = this.view === 'speed' ? '0' : '慢';
    this.chartVisible = this.view === 'speed' || this.view === 'rhythm';
    const ns = this.view === 'rhythm' ? this.analytics.intervalNumbers : this.analytics.numbers;
    this.axisText = ns && ns.length ? ns[0] + '                                      第 ' + ns[ns.length - 1] + ' 杆' : '1                5                10                15                20';
    const shots = this.workout ? this.workout.shots : [];
    this.noShot = shots.length === 0;
    this.note = this.noShot
      ? (this.engineApp ? this.engineApp.getSensorLine() : '传感器不可用')
      : (this.view === 'rhythm' ? '按真实出杆间隔分析 · 至少需要三杆' : (this.view === 'stability' ? '基于腕部运动方向的稳定性分布' : '最近 20 杆 · IMU 估算速度'));
    const i = this.selectedShot < 0 ? shots.length - 1 : Math.min(this.selectedShot, shots.length - 1);
    const shot = shots[i];
    this.shotLabel = shot ? '第 ' + (shot.number || i + 1) + ' 杆' : '暂无出杆';
    this.shotSpeed = shot ? number(shot.speed, 2) : '--';
    this.shotStability = shot ? number(Math.max(0, 1 - shot.lateralRatio / 0.6) * 100) : '--';
    if (this.chartVisible) this.drawChart();
    if (this.view === 'stability') this.drawBall();
  },
  change(view) {
    this.view = view;
    this.refresh();
    if (this.chartVisible || this.view === 'stability') {
      setTimeout(() => { if (this.chartVisible) this.drawChart(); if (this.view === 'stability') this.drawBall(); }, 120);
    }
  },
  choose8() { this.mode = '中式八球'; this.change('detail'); },
  choose9() { this.mode = '中式九球'; this.change('detail'); },
  chooseSnooker() { this.mode = '斯诺克'; this.change('detail'); },
  start() { this.review = null; this.selectedShot = -1; if (this.engineApp) this.engineApp.beginWorkout(this.mode); this.refresh(); if (this.workout) this.change(this.workout.paused ? 'paused' : 'workout'); },
  pause() { if (this.review) { this.change('summary'); return; } if (this.engineApp) this.engineApp.pauseSport(); this.change('paused'); },
  resume() { if (!this.workout) { this.change('detail'); return; } if (this.engineApp) this.engineApp.resumeSport(); this.change('workout'); },
  finish() { const r = this.engineApp ? this.engineApp.finishSport() : null; if (!r) { this.change('home'); return; } this.showSummary(r); },
  showSummary(r) { if (!r) return; this.review = r; this.selectedShot = -1; this.summaryMode = r.mode; this.summaryTime = duration(r.elapsed); this.summaryShots = '' + (r.totals ? r.totals.count : r.shots.length); this.change('summary'); },
  openRecord(index) { if (this.engineApp) this.showSummary(this.engineApp.sportData().history[index]); },
  home() { this.review = null; this.selectedShot = -1; this.change('home'); },
  back() { if (this.view === 'detail' || this.view === 'history' || this.view === 'summary') this.home(); else this.change(this.review ? 'summary' : (this.workout && this.workout.paused ? 'paused' : 'workout')); },
  openHistory() { this.change('history'); },
  openMore() { if (this.active && this.engineApp) this.engineApp.pauseSport(); router.replace({ uri: 'pages/index/index' }); },
  openSpeed() { this.change('speed'); }, openRhythm() { this.change('rhythm'); },
  openStability() { this.change('stability'); }, openPosition() { this.change('position'); },
  openCalories() { this.change('calories'); }, openAnalysis() { this.change('analysis'); },
  openWorkout() { this.change('workout'); }, openPosture() { this.change('posture'); },
  previous() { const n = this.workout ? this.workout.shots.length : 0; if (!n) return; this.selectedShot = Math.max(0, (this.selectedShot < 0 ? n - 1 : this.selectedShot) - 1); this.refresh(); },
  next() { const n = this.workout ? this.workout.shots.length : 0; if (!n) return; this.selectedShot = this.selectedShot < 0 ? -1 : Math.min(n - 1, this.selectedShot + 1); this.refresh(); },
  onSwipe(e) {
    if (this.view === 'analysis' && (e.direction === 'up' || e.direction === 'down')) { if (e.direction === 'up') this.previous(); else this.next(); return; }
    const cycle = ['workout', 'analysis', 'posture']; const i = cycle.indexOf(this.view);
    if (i >= 0 && (e.direction === 'left' || e.direction === 'right')) this.change(cycle[(i + (e.direction === 'left' ? 1 : 2)) % 3]);
    else if (e.direction === 'right') this.back();
  },
  drawChart() {
    // ACELite canvas: only basic path/rect/arc APIs are used (no text/font).
    const refs = this.$refs;
    const el = refs ? refs.chart : null; if (!el) return;
    const c = el.getContext('2d'); if (!c) return;
    // 方屏 392×150；圆屏窄一点（286×110），所有坐标按 W 等比缩放，方屏结果与之前完全一致。
    const W = this.chartW, H = this.chartH, unit = W / 392;
    const x0 = 4 * unit, x1 = W - 6 * unit, y0 = 8 * unit, y1 = H - 22 * unit;
    c.fillStyle = '#000000'; c.fillRect(0, 0, W, H);
    const line = (ax,ay,bx,by,color,width) => {
      c.strokeStyle = color; c.lineWidth = width || 1;
      c.beginPath(); c.moveTo(ax,ay); c.lineTo(bx,by); c.stroke();
    };
    const dash = (ax,ay,bx,by,color,width) => {
      // 简易虚线：ACELite 不支持 setLineDash，按段绘制。
      const len = 8, gap = 7;
      const dx = bx-ax, dy = by-ay, total = Math.sqrt(dx*dx+dy*dy);
      const steps = Math.max(1, Math.floor(total/(len+gap)));
      c.strokeStyle = color; c.lineWidth = width || 1;
      for (let i=0;i<=steps;i+=1) {
        const s = i*(len+gap)/total, e = Math.min(1, s+len/total);
        c.beginPath(); c.moveTo(ax+dx*s, ay+dy*s); c.lineTo(ax+dx*e, ay+dy*e); c.stroke();
      }
    };
    if (this.view === 'speed') {
      for (let v=0; v<=2; v+=1) { const y = y1-(v/2)*(y1-y0); line(x0,y,x1,y,'#242b28'); }
      line(x0,y0,x0,y1,'#5a6062'); line(x0,y1,x1,y1,'#5a6062');
      const values = this.analytics.speeds || [];
      const step = (x1-x0)/20;
      values.forEach((v,i) => {
        const h = Math.min(1, v/this.speedMax)*(y1-y0);
        c.fillStyle = '#5aa9f0';
        c.fillRect(x0+step*i+step*0.22, y1-h, step*0.56, h);
      });
      return;
    }
    for (let i=0;i<3;i+=1) { const y = y0+((y1-y0)*i/2); line(x0,y,x1,y,'#242b28'); }
    line(x0,y0,x0,y1,'#5a6062'); line(x0,y1,x1,y1,'#5a6062');
    const beats = this.barBeats();
    if (beats.length >= 2) {
      const mid = (y0+y1)/2, step = (x1-x0)/(beats.length-1);
      const at = (v,i) => [x0+step*i, mid-Math.max(-1, Math.min(1, (v-1)*2))*((y1-y0)*0.48)];
      /* 曲线下方填色：ACELite 的 path fill 不生效，改用等宽竖线拼出面积 */
      c.strokeStyle = '#123a26'; c.lineWidth = step + 1;
      beats.forEach((v,i) => {
        const p = at(v,i);
        c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0], y1); c.stroke();
      });
      c.strokeStyle = '#3cde83'; c.lineWidth = 3; c.beginPath();
      beats.forEach((v,i) => {
        const p = at(v,i);
        if (i === 0) c.moveTo(p[0],p[1]); else c.lineTo(p[0],p[1]);
      });
      c.stroke();
    }
  },
  // 标准 = 本场平均间隔；更短在快侧，更长在慢侧。
  barBeats() {
    const intervals = this.analytics.intervals || [];
    if (intervals.length < 2) return [];
    const avg = intervals.reduce((a,b)=>a+b,0)/intervals.length;
    return intervals.map((v) => avg / v);
  },
  drawBall() {
    const refs = this.$refs;
    const el = refs ? refs.ballChart : null; if (!el) return;
    const c = el.getContext('2d'); if (!c) return;
    // 方屏 352×150；圆屏 240×110。半径、偏移、散点都按 unit 等比缩放。
    const W = this.ballW, H = this.ballH, unit = W / 352, cx = W / 2, cy = H / 2;
    c.fillStyle = '#000000'; c.fillRect(0, 0, W, H);
    const dash = (ax,ay,bx,by,color) => {
      const len = 9, gap = 8, dx = bx-ax, dy = by-ay;
      const total = Math.sqrt(dx*dx+dy*dy), steps = Math.max(1, Math.floor(total/(len+gap)));
      c.strokeStyle = color; c.lineWidth = 1;
      for (let i=0;i<=steps;i+=1) {
        const s = i*(len+gap)/total, e = Math.min(1, s+len/total);
        c.beginPath(); c.moveTo(ax+dx*s, ay+dy*s); c.lineTo(ax+dx*e, ay+dy*e); c.stroke();
      }
    };
    dash(0, cy, W, cy, '#6a706e');
    dash(cx, 0, cx, H, '#6a706e');
    /* ACELite 的 arc+fill 不生效，实心圆改用「粗描边」画：半径 R/2、线宽 R 正好填满半径 R 的圆 */
    const disc = (x, y, r, color) => {
      c.strokeStyle = color; c.lineWidth = r;
      c.beginPath(); c.arc(x, y, r/2, 0, Math.PI*2, false); c.stroke();
    };
    disc(cx, cy, 46 * unit, '#d8d6c8');
    disc(cx-11 * unit, cy-14 * unit, 26 * unit, '#efeee2');
    const dirs = this.analytics.directions || [];
    const mean = [0,0,0];
    dirs.forEach((d) => { for (let i=0;i<3;i+=1) mean[i]+=d[i]; });
    const len = Math.sqrt(mean[0]*mean[0]+mean[1]*mean[1]+mean[2]*mean[2]);
    if (!len) return;
    for (let i=0;i<3;i+=1) mean[i]/=len;
    const base = Math.abs(mean[2]) < 0.9 ? [0,0,1] : [0,1,0];
    const u = [mean[1]*base[2]-mean[2]*base[1],mean[2]*base[0]-mean[0]*base[2],mean[0]*base[1]-mean[1]*base[0]];
    const ul = Math.sqrt(u[0]*u[0]+u[1]*u[1]+u[2]*u[2]);
    for (let i=0;i<3;i+=1) u[i]/=ul;
    const v = [mean[1]*u[2]-mean[2]*u[1],mean[2]*u[0]-mean[0]*u[2],mean[0]*u[1]-mean[1]*u[0]];
    dirs.forEach((d) => {
      const dx=d[0]*u[0]+d[1]*u[1]+d[2]*u[2], dy=d[0]*v[0]+d[1]*v[1]+d[2]*v[2];
      const aligned=d[0]*mean[0]+d[1]*mean[1]+d[2]*mean[2] >= Math.cos(10*Math.PI/180);
      c.fillStyle=aligned?'#37d97e':'#e8453c';
      c.fillRect(cx+dx*130*unit-3.4*unit, cy-dy*66*unit-3.4*unit, 6.8*unit, 6.8*unit);
    });
  }
};
