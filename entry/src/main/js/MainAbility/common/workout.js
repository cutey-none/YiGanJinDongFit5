// Workout timing and bounded history. No generated measurements.
export function createWorkout(mode, now) {
  return { mode: mode, elapsed: 0, resumedAt: now, paused: false, shots: [], kcal: null };
}
export function elapsedWorkout(workout, now) {
  return workout ? workout.elapsed + (workout.paused ? 0 : Math.max(0, now - workout.resumedAt)) : 0;
}
export function pauseWorkout(workout, now) {
  if (!workout || workout.paused) return;
  workout.elapsed = elapsedWorkout(workout, now);
  workout.resumedAt = now;
  workout.paused = true;
}
export function resumeWorkout(workout, now) {
  if (!workout || !workout.paused) return;
  workout.resumedAt = now;
  workout.paused = false;
  workout.breakBeforeNext = true;
}
function totals() { return { count: 0, speed: 0, speedSq: 0, lateral: 0, gaps: 0, gapSum: 0, gapSq: 0, lastAt: null }; }
function add(t, shot) {
  if (t.lastAt !== null && !shot.afterPause) {
    const gap = (shot.startedAt - t.lastAt) / 1000;
    if (gap > 0) { t.gaps += 1; t.gapSum += gap; t.gapSq += gap * gap; }
  }
  t.count += 1; t.speed += shot.speed; t.speedSq += shot.speed * shot.speed;
  t.lateral += shot.lateralRatio; t.lastAt = shot.startedAt;
}
export function prepareWorkout(workout) {
  if (!workout.shots) workout.shots = [];
  // Older saved workouts predate speedSq. Rebuild once so their stability score
  // uses the same speed-consistency + smoothness formula as new workouts.
  if (!workout.totals || workout.totals.speedSq === undefined) {
    workout.totals = totals(); workout.shots.forEach((shot) => add(workout.totals, shot));
  }
  return workout;
}
export function appendShot(workout, shot) {
  prepareWorkout(workout);
  // Persist only fields used by the UI and aggregate calculations. Raw peaks
  // and duration remain in the live detector; retaining them for every saved
  // game would make the single storage value grow without benefit.
  const record = { startedAt: shot.startedAt, speed: shot.speed,
    lateralRatio: shot.lateralRatio, direction: shot.direction.slice(0) };
  if (workout.breakBeforeNext) { record.afterPause = true; workout.breakBeforeNext = false; }
  add(workout.totals, record);
  record.number = workout.totals.count;
  workout.shots.push(record);
  if (workout.shots.length > 120) workout.shots.shift();
}
export function archiveWorkout(workout) {
  prepareWorkout(workout);
  // History charts display the latest 20 strokes. Totals retain the complete
  // game's count, averages, rhythm and stability after older details are cut.
  return Object.assign({}, workout, { shots: workout.shots.slice(-20) });
}
export function analyzeShots(shots, aggregate) {
  const t = aggregate || totals();
  if (!aggregate) shots.forEach((shot) => add(t, shot));
  const intervals = [], intervalNumbers = [];
  for (let i = 1; i < shots.length; i += 1) {
    const gap = (shots[i].startedAt - shots[i - 1].startedAt) / 1000;
    if (gap > 0 && !shots[i].afterPause) { intervals.push(gap); intervalNumbers.push(shots[i].number || i + 1); }
  }
  const recent = shots.slice(-20), avg = t.gaps ? t.gapSum / t.gaps : 0;
  const rhythm = t.gaps < 2 ? null : Math.round(100 * Math.max(0, 1 - Math.sqrt(Math.max(0, t.gapSq / t.gaps - avg * avg)) / avg));
  const speedAvg = t.count ? t.speed / t.count : 0;
  const speedSpread = t.count ? Math.sqrt(Math.max(0, t.speedSq / t.count - speedAvg * speedAvg)) : 0;
  const consistency = speedAvg > 0 ? Math.max(0, 1 - (speedSpread / speedAvg) / 0.45) : 0;
  const smoothness = t.count ? Math.max(0, 1 - (t.lateral / t.count) / 0.6) : 0;
  return {
    count: t.count, average: t.count ? speedAvg : null, rhythm: rhythm,
    speeds: recent.map((s) => s.speed), numbers: recent.map((s,i) => s.number || shots.length - recent.length + i + 1),
    intervals: intervals.slice(-20), intervalNumbers: intervalNumbers.slice(-20),
    directions: recent.map((s) => s.direction),
    stability: t.count < 3 ? null : Math.round(100 * (0.65 * consistency + 0.35 * smoothness))
  };
}
