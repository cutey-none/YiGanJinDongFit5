/** Pure workout lifecycle and aggregation regression tests. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '../entry/src/main/js/MainAbility/common/workout.js'), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const {
  createWorkout, elapsedWorkout, pauseWorkout, resumeWorkout,
  prepareWorkout, appendShot, archiveWorkout, analyzeShots
} = await import(moduleUrl);

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) { passed += 1; console.log('PASS  ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failed += 1; console.error('FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}
function shot(at, speed = 1, lateral = 0.06) {
  return { startedAt: at, endedAt: at + 200, speed, lateralRatio: lateral, direction: [1, 0, 0] };
}

const timed = createWorkout('中式八球', 1000);
check('运动计时累计', elapsedWorkout(timed, 4500) === 3500);
pauseWorkout(timed, 4500);
check('暂停冻结计时', elapsedWorkout(timed, 9000) === 3500 && timed.paused);
resumeWorkout(timed, 10000);
check('恢复后继续累计', elapsedWorkout(timed, 12500) === 6000 && !timed.paused);

const steady = prepareWorkout(createWorkout('中式八球', 0));
[0, 2000, 4000, 6000].forEach((at) => appendShot(steady, shot(at)));
let analysis = analyzeShots(steady.shots, steady.totals);
check('一致出杆稳定性较高', analysis.stability >= 90, 'stability=' + analysis.stability);
check('稳定节奏得到满分', analysis.rhythm === 100, 'rhythm=' + analysis.rhythm);
check('平均速度来自全部出杆', analysis.average === 1);

const mixed = prepareWorkout(createWorkout('中式八球', 0));
[0.5, 1.5, 0.5, 1.5].forEach((speed, i) => appendShot(mixed, shot(i * 2000, speed)));
analysis = analyzeShots(mixed.shots, mixed.totals);
check('力度不一致会降低稳定性', analysis.stability < 50, 'stability=' + analysis.stability);

const paused = prepareWorkout(createWorkout('中式八球', 0));
appendShot(paused, shot(0)); appendShot(paused, shot(2000));
pauseWorkout(paused, 3000); resumeWorkout(paused, 100000);
appendShot(paused, shot(100000)); appendShot(paused, shot(102000));
analysis = analyzeShots(paused.shots, paused.totals);
check('跨暂停的长间隔不计入行律', analysis.rhythm === 100 && paused.totals.gaps === 2,
  'rhythm=' + analysis.rhythm + ', gaps=' + paused.totals.gaps);

const longGame = prepareWorkout(createWorkout('斯诺克', 0));
for (let i = 0; i < 130; i += 1) appendShot(longGame, shot(i * 2000, 1 + (i % 3) * 0.01));
analysis = analyzeShots(longGame.shots, longGame.totals);
check('逐杆明细限制为最近 120 杆', longGame.shots.length === 120);
check('长局总计保留全部出杆', analysis.count === 130 && longGame.shots.at(-1).number === 130);
check('图表只返回最近 20 杆', analysis.speeds.length === 20 && analysis.numbers[0] === 111);
const archived = archiveWorkout(longGame);
check('历史只保存可回看的最近 20 杆', archived.shots.length === 20 && archived.totals.count === 130);
const worstHistory = JSON.stringify(Array(20).fill(archived)).length;
check('20 场长局历史保持轻量', worstHistory < 80000, 'bytes=' + worstHistory);

const legacy = { shots: [shot(0, 0.8), shot(2000, 1.2), shot(4000, 1)] };
prepareWorkout(legacy);
analysis = analyzeShots(legacy.shots, legacy.totals);
check('旧记录可补齐聚合字段', legacy.totals.speedSq !== undefined && analysis.count === 3);

console.log('\n' + passed + '/' + (passed + failed) + ' 通过');
process.exit(failed ? 1 : 0);
