import { getKey, setKey, clearKey } from './api.js';
import { DIFFICULTY, generateCase, judgeDiagnosis, askCustomer } from './cases.js';
import * as Rating from './rating.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let profile = Rating.load();
let state = null;   // active job
let difficulty = Rating.recommendedLevel(profile.rating);
let focus = localStorage.getItem('sts_focus') || 'mixed';

/* The active job survives a reload too — losing a half-diagnosed car to an
   accidental refresh would mean paying to generate it again. */
const JOB_KEY = 'sts_active_job';
function saveState() {
  if (state && !state.done) localStorage.setItem(JOB_KEY, JSON.stringify(state));
  else localStorage.removeItem(JOB_KEY);
}
function loadState() {
  try {
    const raw = localStorage.getItem(JOB_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.case && s.case.tests ? s : null;
  } catch {
    return null;
  }
}

/* ---------------- shell ---------------- */

function renderBar() {
  $('bar-stats').innerHTML = `
    <span class="stat">RATING <b>${profile.rating}</b></span>
    <span class="stat">${esc(Rating.titleFor(profile.rating))}</span>
    <span class="stat">JOBS <b>${profile.jobs.length}</b></span>
    <span class="stat">FIXED <b>${profile.jobs.filter((j) => j.correct).length}</b></span>`;
}

function showError(msg) {
  $('error').textContent = msg;
  $('error').classList.remove('hidden');
}
function clearError() { $('error').classList.add('hidden'); }

function busy(on, msg = 'Working…') {
  $('busy').classList.toggle('hidden', !on);
  $('busy-msg').textContent = msg;
}

/* ---------------- setup screen ---------------- */

function renderSetup() {
  $('screen-setup').classList.remove('hidden');
  $('screen-job').classList.add('hidden');
  $('key-input').value = getKey();
  $('key-status').textContent = getKey() ? 'Key saved in this browser.' : 'No key saved.';

  $('diffgrid').innerHTML = Object.entries(DIFFICULTY).map(([n, d]) => `
    <button data-d="${n}" class="${Number(n) === difficulty ? 'sel' : ''}">
      <span class="n">${n}</span><span class="t">${esc(d.name)}</span>
    </button>`).join('');
  $('diffgrid').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { difficulty = Number(b.dataset.d); renderSetup(); };
  });
  $('diff-desc').textContent = DIFFICULTY[difficulty].desc;
  $('rec-note').textContent = `Recommended for your rating: level ${Rating.recommendedLevel(profile.rating)}.`;
  $('focus-select').value = focus;

  renderHistory();
}

function renderHistory() {
  const jobs = profile.jobs.slice().reverse().slice(0, 20);
  if (!jobs.length) { $('history-wrap').classList.add('hidden'); return; }
  $('history-wrap').classList.remove('hidden');
  $('history').innerHTML = `
    <thead><tr><th>Vehicle</th><th>Lvl</th><th>Root cause</th><th>Result</th><th>Δ</th></tr></thead>
    <tbody>${jobs.map((j) => `
      <tr>
        <td>${esc(j.vehicle)}</td>
        <td>${j.difficulty}</td>
        <td>${esc(j.rootCause)}</td>
        <td class="${j.correct ? 'ok' : 'bad'}">${j.correct ? (j.comeback ? 'Comeback' : 'Fixed') : 'Missed'}</td>
        <td class="${j.delta >= 0 ? 'ok' : 'bad'}">${j.delta >= 0 ? '+' : ''}${j.delta}</td>
      </tr>`).join('')}</tbody>`;
}

/* ---------------- job flow ---------------- */

async function startJob() {
  clearError();
  if (!getKey()) { showError('Enter your Anthropic API key first.'); return; }

  busy(true, `Writing a level ${difficulty} repair order…`);
  $('start-btn').disabled = true;
  try {
    const c = await generateCase({
      difficulty, focus, avoid: profile.recentCauses.slice(-6),
      onProgress: (n) => busy(true, `Writing a level ${difficulty} repair order… ${(n / 1000).toFixed(1)}k`),
    });
    state = {
      case: c,
      difficulty,
      testsRun: [],
      log: [],
      minutes: 0,
      cost: 0,
      asked: [],
      done: false,
    };
    pushLog('sys', 'Service Writer', `Work order opened. Door rate $${c.ro.labor_rate}/hr. ${c.ro.writer_notes}`);
    renderJob();
  } catch (e) {
    showError(e.message);
  } finally {
    busy(false);
    $('start-btn').disabled = false;
  }
}

function pushLog(kind, who, txt, costLabel = '') {
  state.log.push({ kind, who, txt, costLabel });
}

function parMinutes() {
  // Par = the time a clean diagnostic path would take: roughly the decisive
  // half of the test menu.
  const all = state.case.tests.map((t) => t.minutes).sort((a, b) => a - b);
  return all.slice(0, Math.ceil(all.length / 2)).reduce((a, b) => a + b, 0);
}

function renderJob() {
  saveState();
  $('screen-setup').classList.add('hidden');
  $('screen-job').classList.remove('hidden');

  const c = state.case, v = c.vehicle;
  $('ro-head').innerHTML = `
    <div>
      <div class="vehicle">${v.year} ${esc(v.make)} ${esc(v.model)}</div>
      <div class="vin">${esc(v.vin)} &nbsp;·&nbsp; ${v.mileage.toLocaleString()} mi</div>
      <div class="tags">
        <span class="tag">${esc(v.engine)}</span>
        <span class="tag">${esc(v.trans)}</span>
        <span class="tag warn">Level ${state.difficulty} — ${esc(DIFFICULTY[state.difficulty].name)}</span>
      </div>
    </div>
    <div style="text-align:right">
      <div class="stat">TIME ON JOB <b>${(state.minutes / 60).toFixed(1)} hr</b></div>
      <div class="stat">BILLED <b>$${(state.minutes / 60 * c.ro.labor_rate + state.cost).toFixed(0)}</b></div>
      <div class="stat">TESTS <b>${state.testsRun.length}/${c.tests.length}</b></div>
    </div>`;

  $('complaint').innerHTML = `<blockquote class="complaint">"${esc(c.ro.complaint)}"</blockquote>` +
    (c.ro.history.length
      ? `<div class="hint" style="margin-top:10px"><b>Vehicle history:</b> ${c.ro.history.map(esc).join(' · ')}</div>`
      : '');

  renderLog();
  renderTests();

  $('commit-wrap').classList.toggle('hidden', state.done);
}

function renderLog() {
  $('log').innerHTML = state.log.map((e) => `
    <div class="entry ${e.kind}">
      <div class="who">${esc(e.who)}${e.costLabel ? `<span class="cost">${esc(e.costLabel)}</span>` : ''}</div>
      <div class="txt">${esc(e.txt)}</div>
    </div>`).join('');
  $('log').scrollTop = $('log').scrollHeight;
}

function renderTests() {
  if (state.done) { $('tests').innerHTML = '<div class="hint">Job closed.</div>'; return; }
  const groups = {};
  state.case.tests.forEach((t) => { (groups[t.group] ||= []).push(t); });

  $('tests').innerHTML = Object.entries(groups).map(([g, list]) => `
    <div class="groupname">${esc(g)}</div>
    <div class="testlist">
      ${list.map((t) => {
        const done = state.testsRun.includes(t.id);
        const price = t.parts_cost
          ? `${t.minutes}m · $${t.parts_cost}`
          : `${t.minutes}m`;
        return `<button class="testbtn ${done ? 'done' : ''}" data-t="${t.id}" ${done ? 'disabled' : ''}>
          <span class="nm">${esc(t.name)}</span><span class="px">${price}</span></button>`;
      }).join('')}
    </div>`).join('');

  $('tests').querySelectorAll('button[data-t]').forEach((b) => {
    b.onclick = () => runTest(b.dataset.t);
  });
}

function runTest(id) {
  const t = state.case.tests.find((x) => x.id === id);
  if (!t || state.testsRun.includes(id)) return;
  state.testsRun.push(id);
  state.minutes += t.minutes;
  state.cost += t.parts_cost;
  pushLog(
    t.group === 'Interview' ? 'cust' : 'test',
    t.group === 'Interview' ? `Customer — ${t.name}` : t.name,
    t.result,
    `${t.minutes}m${t.parts_cost ? ` · $${t.parts_cost}` : ''}`,
  );
  renderJob();
}

async function doAsk() {
  const q = $('ask-input').value.trim();
  if (!q || state.done) return;
  $('ask-input').value = '';
  $('ask-btn').disabled = true;
  state.minutes += 3;
  pushLog('sys', 'You ask the customer', q, '3m');
  renderJob();
  try {
    const a = await askCustomer({ theCase: state.case, question: q, asked: state.asked });
    state.asked.push(q);
    pushLog('cust', 'Customer', a);
  } catch (e) {
    showError(e.message);
  } finally {
    $('ask-btn').disabled = false;
    renderJob();
  }
}

async function commit() {
  const diagnosis = $('diagnosis').value.trim();
  const repair = $('repair').value.trim();
  if (!diagnosis || !repair) { showError('Write both your diagnosis and the repair you performed.'); return; }
  clearError();
  busy(true, 'Foreman is reviewing your work…');
  $('commit-btn').disabled = true;
  try {
    const verdict = await judgeDiagnosis({
      theCase: state.case, diagnosis, repair, testsRun: state.testsRun,
      onProgress: (n) => busy(true, `Foreman is reviewing your work… ${(n / 1000).toFixed(1)}k`),
    });
    finishJob(verdict, diagnosis);
  } catch (e) {
    showError(e.message);
    $('commit-btn').disabled = false;
  } finally {
    busy(false);
  }
}

function finishJob(verdict, diagnosis) {
  state.done = true;
  const score = Rating.scoreJob({
    verdict, minutesUsed: state.minutes, parMinutes: parMinutes(),
  });
  const move = Rating.applyResult(profile, {
    difficulty: state.difficulty, score, comeback: verdict.comeback.happens,
  });

  const c = state.case, v = c.vehicle;
  profile.jobs.push({
    vehicle: `${v.year} ${v.make} ${v.model}`,
    difficulty: state.difficulty,
    rootCause: c.truth.root_cause,
    correct: verdict.correct,
    comeback: verdict.comeback.happens,
    delta: move.delta,
    at: Date.now(),
  });
  profile.recentCauses.push(c.truth.root_cause);
  profile.recentCauses = profile.recentCauses.slice(-12);
  Rating.save(profile);
  renderBar();

  pushLog('sys', 'Your diagnosis', diagnosis);
  pushLog('cust', 'Customer at pickup', verdict.customer_reaction);
  if (verdict.comeback.happens) {
    pushLog('verdict-bad', `Comeback — ${verdict.comeback.days_later} days later`, verdict.comeback.new_complaint);
  }
  renderLog();

  const ok = verdict.correct && !verdict.comeback.happens;
  $('result').innerHTML = `
    <div class="scorecard">
      <div class="top ${ok ? 'ok' : 'bad'}">
        <div class="grade">${ok ? 'FIXED' : verdict.correct ? 'COMEBACK' : 'MISSED'}</div>
        <div class="sub">${esc(verdict.accuracy_note)}</div>
      </div>
      <div class="rows">
        <div class="srow"><span class="k">Actual root cause</span><span class="v">${esc(c.truth.root_cause)}</span></div>
        <div class="srow"><span class="k">Correct repair</span><span class="v">${esc(c.truth.correct_repair)}</span></div>
        ${c.truth.contributing.length ? `<div class="srow"><span class="k">Also required</span><span class="v">${c.truth.contributing.map(esc).join(', ')}</span></div>` : ''}
        ${c.truth.red_herrings.length ? `<div class="srow"><span class="k">Red herrings</span><span class="v">${c.truth.red_herrings.map(esc).join(', ')}</span></div>` : ''}
        <div class="srow"><span class="k">Completeness</span><span class="v">${verdict.completeness}%</span></div>
        <div class="srow"><span class="k">Time on job</span><span class="v">${(state.minutes / 60).toFixed(1)} hr (par ${(parMinutes() / 60).toFixed(1)})</span></div>
        <div class="srow"><span class="k">Rating</span><span class="v">${move.before} → ${move.after} <span class="delta ${move.delta >= 0 ? 'up' : 'down'}">${move.delta >= 0 ? '+' : ''}${move.delta}</span></span></div>
      </div>
    </div>
    <div class="panel" style="margin-top:14px">
      <h2>Why this one bites</h2>
      <div class="body">
        <p style="margin-top:0">${esc(verdict.teaching)}</p>
        <p style="color:var(--ink-dim)"><b>Commonly misdiagnosed because:</b> ${esc(c.truth.why_missed)}</p>
        ${verdict.missed_steps.length ? `<p style="color:var(--ink-dim)"><b>Tests that would have nailed it:</b><br>${verdict.missed_steps.map((s) => '· ' + esc(s)).join('<br>')}</p>` : ''}
      </div>
    </div>
    <div class="row-actions" style="margin-top:14px">
      <button class="primary" id="again-btn">Next job (level ${state.difficulty})</button>
      <button id="back-btn">Back to shop</button>
    </div>`;
  $('result').classList.remove('hidden');
  $('again-btn').onclick = () => { difficulty = state.difficulty; startJob(); };
  $('back-btn').onclick = () => { state = null; saveState(); $('result').classList.add('hidden'); renderSetup(); };

  renderJob();
}

/* ---------------- wiring ---------------- */

function init() {
  renderBar();
  renderSetup();

  const resumed = loadState();
  if (resumed) {
    state = resumed;
    difficulty = state.difficulty;
    renderJob();
  }

  $('key-save').onclick = () => {
    const k = $('key-input').value.trim();
    if (!k) { clearKey(); } else { setKey(k); }
    clearError();
    renderSetup();
  };
  $('focus-select').onchange = (e) => {
    focus = e.target.value;
    localStorage.setItem('sts_focus', focus);
  };
  $('start-btn').onclick = startJob;
  $('commit-btn').onclick = commit;
  $('ask-btn').onclick = doAsk;
  $('ask-input').onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doAsk(); }
  };
  $('abandon-btn').onclick = () => {
    if (state && !state.done && !confirm('Abandon this job? It will not be rated.')) return;
    state = null;
    saveState();
    $('result').classList.add('hidden');
    renderSetup();
  };
  $('reset-btn').onclick = () => {
    if (!confirm('Erase your rating and job history? Your API key is kept.')) return;
    localStorage.removeItem('sts_profile');
    profile = Rating.load();
    difficulty = Rating.recommendedLevel(profile.rating);
    renderBar();
    renderSetup();
  };
}

init();
