// Club Pilates Sippy Downs: studio dashboard
// One-file Cloudflare Worker. Pulls read-only data from ClubReady in small
// batches, keeps only counts plus a few minimal cached fields, and serves a
// shared dashboard with a team to-do list.
//
// Secrets (set in Cloudflare, never in this file):
//   CR_API_KEY      the ClubReady API key
//   DASH_PASSCODE   the passcode the team types to open the dashboard
// Storage binding: STUDIO (a Workers KV namespace)

const STORE_ID = 13521;
const CR_BASE = 'https://www.clubready.com/api';
const AEST_OFFSET_MS = 10 * 60 * 60 * 1000; // Queensland: UTC+10, no daylight saving
const DAY = 24 * 60 * 60 * 1000;
const SUBREQUEST_BUDGET = 34; // ClubReady calls per run; Cloudflare's free plan allows 50 in total, including our storage reads and writes
const USER_PAGES_PER_RUN = 2; // keeps each run small enough for the free plan's CPU limit // Cloudflare's free plan allows 50 outbound calls per run
const OWNERS = ['Anna', 'Tyson', 'Nichola', 'Simone', 'Anyone'];

// Which ClubReady lead sources count as Meta. Edit this line to change it.
const META_RE = /facebook|instagram|\bmeta\b|ffm social/i;
// Package names that mean "paid up front".
const PREPAID_RE = /\bpif\b|paid in full|split from invoice|12 week paid/i;
const PREPAID_AMOUNT = 400; // any single invoice at or above this also counts as prepaid

// ---------- small helpers ----------

function parseDate(s) {
  if (!s) return null;
  const str = String(s);
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // ClubReady's member list uses month/day/year
  if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2]);
  const t = Date.parse(str);
  return Number.isNaN(t) ? null : t;
}
const aest = (ms) => new Date(ms + AEST_OFFSET_MS);
// ClubReady writes dates in the studio's own time, so read the calendar day straight off
// the text instead of shifting it by ten hours (that pushed late-afternoon leads into the next day).
function studioDay(s) {
  if (!s) return null;
  const str = String(s);
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
  const t = Date.parse(str);
  return Number.isNaN(t) ? null : aestDate(t);
}
const aestDate = (ms) => aest(ms).toISOString().slice(0, 10);
const aestMonth = (ms) => aest(ms).toISOString().slice(0, 7);
const aestHour = (ms) => aest(ms).getUTCHours();

function lastMonths(now, n) {
  const d = aest(now);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
}

function sourceGroup(name) {
  const s = (name || '').trim();
  if (!s) return 'No source recorded';
  if (META_RE.test(s)) return 'Meta (Facebook and Instagram)';
  if (/google/i.test(s)) return 'Google';
  if (/website|microsite|landing|account creation|mobile app|free intro/i.test(s)) return 'Website and app';
  if (/friend|family|member referral|referral/i.test(s)) return 'Referrals';
  if (/walk/i.test(s)) return 'Walk-ins';
  return 'Other';
}

async function getJSON(env, key) {
  const v = await env.STUDIO.get(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}
const putJSON = (env, key, val) => env.STUDIO.put(key, JSON.stringify(val));

// ---------- ClubReady (read-only GET requests only) ----------

async function cr(env, path, params) {
  if (!env.CR_API_KEY) throw new Error('CR_API_KEY is not set');
  const q = new URLSearchParams({ ...params, ApiKey: env.CR_API_KEY });
  const r = await fetch(`${CR_BASE}${path}?${q}`, {
    method: 'GET',
    headers: { Accept: 'application/json', 'X-Forwarded-For': '127.0.0.1' },
  });
  // Never put the URL (which holds the key) into an error message.
  if (!r.ok) throw new Error(`ClubReady ${path.split('/').slice(0, 3).join('/')} returned ${r.status}`);
  return r.json();
}

// ---------- refresh job (runs in small steps, every 10 minutes) ----------

function newAgg(now) {
  return {
    startedAt: now,
    people: 0,
    months: lastMonths(now, 6),
    addedByMonth: {},
    joinedByMonth: {},
    last30: {}, prev30: {}, stage30: {},
    last30Total: 0, prev30Total: 0,
    mtd: {}, prevMtd: {}, stageMtd: {}, mtdTotal: 0, prevMtdTotal: 0,
    mtdMonth: aestMonth(now), mtdDay: aest(now).getUTCDate(),
  };
}

function absorbUser(job, u, now) {
  const a = job.agg;
  a.people++;
  const added = parseDate(u.DateAdded);
  const addedDay = studioDay(u.DateAdded);
  if (added !== null && addedDay) {
    const mk = addedDay.slice(0, 7);
    // Month to date, and the same days of last month for a fair comparison.
    if (a.mtdMonth) {
      if (mk === a.mtdMonth && addedDay <= aestDate(now)) {
        const g = sourceGroup(u.ReferralTypeName);
        a.mtd[g] = (a.mtd[g] || 0) + 1;
        a.mtdTotal++;
        // ClubReady's "Current Leads" view leaves out anyone who is now a member.
        if (u.Member) a.mtdJoined = (a.mtdJoined || 0) + 1;
        else a.mtdCurrent = (a.mtdCurrent || 0) + 1;
        const st = (u.ProspectTypeName || 'No status').trim() || 'No status';
        a.stageMtd[st] = (a.stageMtd[st] || 0) + 1;
      } else if (mk === prevMonthKey(a.mtdMonth) && +addedDay.slice(8, 10) <= a.mtdDay) {
        const g = sourceGroup(u.ReferralTypeName);
        a.prevMtd[g] = (a.prevMtd[g] || 0) + 1;
        a.prevMtdTotal++;
      }
    }
    if (a.months.includes(mk)) a.addedByMonth[mk] = (a.addedByMonth[mk] || 0) + 1;
    const age = now - added;
    if (age >= 0 && age <= 30 * DAY) {
      const g = sourceGroup(u.ReferralTypeName);
      a.last30[g] = (a.last30[g] || 0) + 1;
      a.last30Total++;
      const st = (u.ProspectTypeName || 'No status').trim() || 'No status';
      a.stage30[st] = (a.stage30[st] || 0) + 1;
    } else if (age > 30 * DAY && age <= 60 * DAY) {
      const g = sourceGroup(u.ReferralTypeName);
      a.prev30[g] = (a.prev30[g] || 0) + 1;
      a.prev30Total++;
    }
  }
  const sinceDay = studioDay(u.MemberSinceDate);
  if (sinceDay) {
    const mk = sinceDay.slice(0, 7);
    if (a.months.includes(mk)) a.joinedByMonth[mk] = (a.joinedByMonth[mk] || 0) + 1;
  }
  if (u.Member) {
    const ended = parseDate(u.MembershipEndedDate);
    const expires = parseDate(u.MembershipExpiresDate);
    if (ended === null || (expires !== null && expires >= now)) {
      job.cands.push({ id: u.UserId, ex: expires });
    }
  }
}

function classifyMember(res, cand, now) {
  if (res.st === 'F') return 'frozen';
  if (res.n !== null && res.n !== undefined) return 'recurring';
  if (res.l && now - res.l <= 14 * DAY) return 'recurring';
  if (res.p && cand.ex !== null && cand.ex !== undefined && cand.ex >= now) return 'prepaid';
  return 'review';
}

async function checkMember(env, id, now) {
  const r = await cr(env, `/sales/members/${id}/status`, { StoreId: STORE_ID });
  let next = null, last = null, prepaid = 0;
  for (const v of r.Invoices || []) {
    const due = parseDate(v.PaymentDue);
    if (due !== null && due > now && (next === null || due < next)) next = due;
    const paid = parseDate(v.PaymentMade);
    if (paid !== null && (last === null || paid > last)) last = paid;
    if (PREPAID_RE.test(v.PackageName || '') || (v.AmountDue || 0) >= PREPAID_AMOUNT) prepaid = 1;
  }
  // Only dates and flags are kept. No names, emails or phone numbers.
  return { st: r.MemberStatus === 'Frozen' ? 'F' : 'M', n: next, l: last, p: prepaid };
}

async function finalise(env, job, now) {
  const counts = { recurring: 0, prepaid: 0, frozen: 0, review: 0 };
  const memberIds = [];
  for (const c of job.cands) {
    const res = job.res[c.id];
    if (!res) continue;
    const kind = classifyMember(res, c, now);
    counts[kind]++;
    if (kind !== 'review') memberIds.push(c.id);
  }
  const a = job.agg;
  const today = aestDate(now);

  // Daily snapshot of member IDs (no names), used to work out who joined and who left.
  const snaps = (await getJSON(env, 'snaps')) || { byDate: {}, log: [] };
  const dates = Object.keys(snaps.byDate).sort();
  const prevDate = dates.filter((d) => d < today).pop();
  if (prevDate) {
    const prev = new Set(snaps.byDate[prevDate]);
    const cur = new Set(memberIds);
    let joined = 0, left = 0;
    for (const id of cur) if (!prev.has(id)) joined++;
    for (const id of prev) if (!cur.has(id)) left++;
    snaps.log = snaps.log.filter((x) => x.date !== today);
    snaps.log.push({ date: today, joined, left });
  }
  snaps.byDate[today] = memberIds;
  // Month to date: compare today's members with the last snapshot before the 1st
  // (or the first one this month), so someone who drops off and comes back is not counted twice.
  let mtd = null;
  {
    const month = today.slice(0, 7);
    const all = Object.keys(snaps.byDate).sort();
    const base = all.filter((d) => d < month + '-01').pop() || all.find((d) => d.startsWith(month) && d < today);
    if (base) {
      const was = new Set(snaps.byDate[base]);
      const cur = new Set(memberIds);
      let joined = 0, left = 0;
      for (const id of cur) if (!was.has(id)) joined++;
      for (const id of was) if (!cur.has(id)) left++;
      mtd = { month, base, joined, left, startCount: was.size, nowCount: cur.size };
    }
  }
  for (const d of Object.keys(snaps.byDate).sort().slice(0, -120)) delete snaps.byDate[d];
  snaps.log = snaps.log.slice(-400);
  if (!snaps.since) snaps.since = today;
  await putJSON(env, 'snaps', snaps);

  const summary = {
    generatedAt: now,
    members: {
      active: counts.recurring + counts.prepaid,
      recurring: counts.recurring,
      prepaid: counts.prepaid,
      frozen: counts.frozen,
      review: counts.review,
    },
    movement: { since: snaps.since, log: snaps.log, mtd },
    joinedByMonth: a.joinedByMonth,
    leads: leadsFromAgg(a),
  };
  await putJSON(env, 'summary', summary);
  const meta = (await getJSON(env, 'meta')) || {};
  meta.lastDoneDate = today;
  meta.lastDoneAt = now;
  meta.lastError = null;
  await putJSON(env, 'meta', meta);
}

function leadsFromAgg(a) {
  return {
      months: a.months,
      addedByMonth: a.addedByMonth,
      last30: a.last30, prev30: a.prev30,
      last30Total: a.last30Total, prev30Total: a.prev30Total,
      stage30: a.stage30,
      mtd: a.mtd, prevMtd: a.prevMtd, stageMtd: a.stageMtd,
      mtdTotal: a.mtdTotal, prevMtdTotal: a.prevMtdTotal,
      mtdCurrent: a.mtdCurrent || 0, mtdJoined: a.mtdJoined || 0,
      mtdMonth: a.mtdMonth, mtdDay: a.mtdDay,
  };
}

// Leads only need the member list, not the slower per-member payment checks,
// so put them on the dashboard as soon as the list has been read.
async function publishLeadsEarly(env, job, now) {
  const summary = await getJSON(env, 'summary');
  if (!summary) return;
  summary.leads = leadsFromAgg(job.agg);
  summary.joinedByMonth = job.agg.joinedByMonth;
  summary.leadsAt = now;
  await putJSON(env, 'summary', summary);
}

// Month-to-date member movement straight from the nightly member lists.
function movementMtd(snaps, now) {
  if (!snaps || !snaps.byDate) return null;
  const today = aestDate(now), month = today.slice(0, 7);
  const all = Object.keys(snaps.byDate).sort();
  const latest = all[all.length - 1];
  if (!latest || !latest.startsWith(month)) return null;
  const base = all.filter((d) => d < month + '-01').pop() || all.find((d) => d.startsWith(month) && d < latest);
  if (!base) return null;
  const was = new Set(snaps.byDate[base]), cur = new Set(snaps.byDate[latest]);
  let joined = 0, left = 0;
  for (const id of cur) if (!was.has(id)) joined++;
  for (const id of was) if (!cur.has(id)) left++;
  return { month, base, latest, joined, left, startCount: was.size, nowCount: cur.size };
}

async function refreshClasses(env, now) {
  const from = aestDate(now);
  const to = aestDate(now + 7 * DAY);
  const rows = await cr(env, '/scheduling/class-schedule', { StoreID: STORE_ID, FromDate: from, ToDate: to });
  const list = (Array.isArray(rows) ? rows : []).map((c) => ({
    date: parseDate(c.Date) !== null ? aestDateFromUtcDay(parseDate(c.Date)) : null,
    start: c.StartTime || '',
    title: c.Title || '',
    who: [c.InstructorFirstName, (c.InstructorLastName || '').slice(0, 1)].filter(Boolean).join(' '),
    free: c.FreeSpots,
    max: c.MaxSpots,
  }));
  await putJSON(env, 'classes', { generatedAt: now, list });
}
// ClubReady gives a calendar date with no time zone. Treat it as the studio's own date.
const aestDateFromUtcDay = (utcMs) => new Date(utcMs).toISOString().slice(0, 10);

// ---------- LAZE: Leads, Appointments, Shows, Enrolments ----------
// Leads and Enrolments come from the member job. Appointments and Shows come from the
// rosters of the intro classes in the month. Only counts are stored, never names or IDs.
const LAZE_MAX_CLASSES = 22;

async function computeLaze(env, monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const rows = await cr(env, '/scheduling/class-schedule', { StoreID: STORE_ID, FromDate: monthKey + '-01', ToDate: monthKey + '-' + String(last).padStart(2, '0') });
  const intros = (Array.isArray(rows) ? rows : []).filter((c) => /intro/i.test(c.Title || '') && (c.MaxSpots - c.FreeSpots) > 0);
  const use = intros.slice(0, LAZE_MAX_CLASSES);
  const people = new Map();
  for (let i = 0; i < use.length; i += 10) {
    const batch = use.slice(i, i + 10);
    const rosters = await Promise.all(batch.map((c) => cr(env, '/scheduling/class-roster', { ClassScheduleId: c.ScheduleId, StoreID: STORE_ID })));
    for (const j of rosters) {
      for (const x of (j && Array.isArray(j.ClassRoster) ? j.ClassRoster : [])) {
        // Existing members using an intro class are not sales appointments.
        if (!(x.FirstTimeBooking === true || x.IsMember === false)) continue;
        const rec = people.get(x.UserId) || { showed: false, noShow: false };
        if (x.BookingStatusId === 5) rec.showed = true;
        else if (x.BookingStatusId === 6) rec.noShow = true;
        people.set(x.UserId, rec);
      }
    }
  }
  let shows = 0, noShows = 0;
  for (const r of people.values()) { if (r.showed) shows++; else if (r.noShow) noShows++; }
  return { appointments: people.size, shows, noShows, upcoming: people.size - shows - noShows, classes: use.length, truncated: intros.length > use.length };
}

async function maybeLaze(env, meta, now, hour, force) {
  if (!force && !(hour >= 5 && hour < 21)) return;
  const laze = (await getJSON(env, 'laze')) || { months: {} };
  const cur = aestDate(now).slice(0, 7);
  const prev = prevMonthKey(cur);
  let target = null;
  if (!laze.months[cur] || now - laze.months[cur].at > 60 * 60 * 1000) target = cur;
  else if (!laze.months[prev]) target = prev;
  if (!target) return;
  try {
    laze.months[target] = { at: now, ...(await computeLaze(env, target)) };
    await putJSON(env, 'laze', laze);
  } catch (e) {
    meta.lastError = { at: now, message: 'LASER: ' + String(e.message || e).slice(0, 180) };
    laze.months[target] = { ...(laze.months[target] || {}), at: now - 50 * 60 * 1000 }; // try again in ~10 minutes
    await putJSON(env, 'laze', laze);
    await putJSON(env, 'meta', meta);
  }
}
const prevMonthKey = (k) => { const [y, m] = k.split('-').map(Number); return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0'); };

async function runRefresh(env, opts = {}) {
  const now = Date.now();
  const today = aestDate(now);
  const meta = (await getJSON(env, 'meta')) || {};
  let job = await getJSON(env, 'job');
  let budget = SUBREQUEST_BUDGET;

  try {
    // Class numbers change all day, so refresh them every 30 minutes between 5am and 9pm.
    const h = aestHour(now);
    if ((opts.force || (h >= 5 && h < 21)) && (!meta.classesAt || now - meta.classesAt > 30 * 60 * 1000 || opts.force)) {
      try {
        await refreshClasses(env, now);
        meta.classesAt = now;
      } catch (e) {
        meta.lastError = { at: now, message: 'Classes: ' + String(e.message || e).slice(0, 180) };
        meta.classesAt = now; // do not hammer ClubReady if it keeps failing
      }
      budget--;
      await putJSON(env, 'meta', meta);
    }

    // Start the daily member job after 4am, or when forced.
    if (!job || job.phase === 'done') {
      const due = opts.force || meta.lastDoneDate !== today && h >= 4;
      if (!due) { await maybeLaze(env, meta, now, h, opts.force); return 'idle'; }
      job = { phase: 'users', page: 1, agg: newAgg(now), cands: [], res: {}, idx: 0, errors: 0 };
    }
    // Heartbeat: if a run is cut off by Cloudflare, the page can say so.
    meta.runStart = now; meta.runEnd = null;
    await putJSON(env, 'meta', meta);

    if (job.phase === 'users') {
      let pages = 0;
      while (budget > 0 && job.phase === 'users' && pages < USER_PAGES_PER_RUN) {
        pages++;
        const rows = await cr(env, `/club/${STORE_ID}/Users/all`, { StoreId: STORE_ID, PageSize: 500, PageNumber: job.page });
        budget--;
        const arr = Array.isArray(rows) ? rows : [];
        for (const u of arr) absorbUser(job, u, now);
        if (arr.length < 500) { job.phase = 'status'; job.idx = 0; await publishLeadsEarly(env, job, now); } else job.page++;
        if (job.page > 60) throw new Error('Member list was longer than expected');
      }
    }

    if (job.phase === 'status' && budget > 0) {
      const batch = job.cands.slice(job.idx, job.idx + budget);
      for (let i = 0; i < batch.length; i += 10) {
        const part = batch.slice(i, i + 10);
        const out = await Promise.all(part.map((c) => checkMember(env, c.id, now)));
        part.forEach((c, k) => { job.res[c.id] = out[k]; });
      }
      job.idx += batch.length;
      if (job.idx >= job.cands.length) job.phase = 'finish';
    }

    if (job.phase === 'finish') {
      await finalise(env, job, now);
      job = { phase: 'done' };
    }
    job.errors = 0;
  } catch (e) {
    meta.lastError = { at: now, message: String(e.message || e).slice(0, 200) };
    await putJSON(env, 'meta', meta);
    if (job) {
      job.errors = (job.errors || 0) + 1;
      if (job.errors > 12) job = { phase: 'done' }; // give up on this attempt, try again tomorrow
    }
  }
  if (job) await putJSON(env, 'job', job);
  if (meta.runStart === now) { const fresh = (await getJSON(env, 'meta')) || {}; fresh.runEnd = Date.now(); await putJSON(env, 'meta', fresh); }
  return job ? job.phase : 'idle';
}

// ---------- login ----------

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function isSignedIn(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)sd=([a-f0-9]+)/);
  if (!m || !env.DASH_PASSCODE) return false;
  return safeEqual(m[1], await hmacHex(env.DASH_PASSCODE, 'studio-dashboard-v1'));
}

const pageShell = (title, body) => `<!doctype html><html lang="en-AU"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f1e9;color:#3b2a20;display:grid;place-items:center;min-height:100vh;margin:0}
.box{background:#fffdf9;border:1px solid #e3d9c8;border-radius:12px;padding:28px;max-width:340px;width:calc(100% - 32px)}
input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid #cdbfa8;width:100%;box-sizing:border-box;margin-top:10px}
button{background:#8a6a43;color:#fff;border-color:#8a6a43;cursor:pointer}p{color:#7a6a5c;font-size:14px}</style></head>
<body><div class="box">${body}</div></body></html>`;

const loginPage = (msg = '') => pageShell('Studio dashboard', `<h2 style="margin:0 0 6px">Studio dashboard</h2>
<p>Club Pilates Sippy Downs</p>${msg ? `<p style="color:#a33">${msg}</p>` : ''}
<form method="post" action="/login"><input type="password" name="passcode" placeholder="Passcode" autofocus autocomplete="current-password">
<button type="submit">Open</button></form>`);

// ---------- to-do list ----------

const PEOPLE = ['Anna', 'Tyson', 'Nichola', 'Simone'];

async function handleTodos(request, env) {
  const body = await request.json().catch(() => ({}));
  let list = (await getJSON(env, 'todos')) || [];
  let log = (await getJSON(env, 'todolog')) || [];
  const now = Date.now();
  const who = cleanWho(body);
  const note = (action, t, extra) => log.unshift({ at: now, who, action, id: t.id, text: String(t.text || '').slice(0, 120), ...(extra ? { detail: String(extra).slice(0, 300) } : {}) });
  if (body.action === 'add') {
    const text = String(body.text || '').trim().slice(0, 300);
    if (!text) return Response.json({ error: 'Add some text first' }, { status: 400 });
    const t = {
      id: crypto.randomUUID(), text,
      owner: OWNERS.includes(body.owner) ? body.owner : 'Anyone',
      due: /^\d{4}-\d{2}-\d{2}$/.test(body.due || '') ? body.due : '',
      notes: String(body.notes || '').trim().slice(0, 1000),
      done: false, created: now, createdBy: who, doneAt: null, doneBy: '', shared: body.shared === true,
      high: body.high === true,
    };
    list.unshift(t);
    trimTodos(list);
    note('added', t, [t.high ? 'High priority' : '', t.notes ? 'Notes: ' + t.notes : ''].filter(Boolean).join('. '));
  } else if (body.action === 'toggle') {
    const t = list.find((x) => x.id === body.id);
    if (!t) return Response.json({ error: 'Task not found' }, { status: 404 });
    t.done = !t.done;
    t.doneAt = t.done ? now : null;
    t.doneBy = t.done ? who : '';
    note(t.done ? 'completed' : 'reopened', t);
  } else if (body.action === 'delete') {
    const t = list.find((x) => x.id === body.id);
    if (!t) return Response.json({ error: 'Task not found' }, { status: 404 });
    list = list.filter((x) => x.id !== body.id);
    note('removed', t);
  } else if (body.action === 'share') {
    const t = list.find((x) => x.id === body.id);
    if (!t) return Response.json({ error: 'Task not found' }, { status: 404 });
    t.shared = !t.shared;
    note(t.shared ? 'shared with instructors' : 'unshared', t);
  } else if (body.action === 'owner') {
    const t = list.find((x) => x.id === body.id);
    if (!t) return Response.json({ error: 'Task not found' }, { status: 404 });
    if (!OWNERS.includes(body.owner)) return Response.json({ error: 'Choose who the task is for' }, { status: 400 });
    const was = t.owner;
    const hand = String(body.handover || '').trim().slice(0, 300);
    t.owner = body.owner;
    if (hand) {
      const stamp = 'Handed from ' + was + ' to ' + body.owner + (who ? ' by ' + who : '') + ': ' + hand;
      t.notes = (t.notes ? t.notes + '\n' : '') + stamp;
      t.notes = t.notes.slice(-1000);
    }
    note('reassigned', t, 'From ' + was + ' to ' + body.owner + (hand ? '. Note: ' + hand : ''));
  } else if (body.action === 'priority') {
    const t = list.find((x) => x.id === body.id);
    if (!t) return Response.json({ error: 'Task not found' }, { status: 404 });
    t.high = !t.high;
    note(t.high ? 'marked high priority' : 'removed high priority', t);
  } else if (body.action === 'notes') {
    const t = list.find((x) => x.id === body.id);
    if (!t) return Response.json({ error: 'Task not found' }, { status: 404 });
    t.notes = String(body.notes || '').trim().slice(0, 1000);
    note('notes updated', t, t.notes);
  } else {
    return Response.json({ error: 'Unknown action' }, { status: 400 });
  }
  log = log.slice(0, 1000);
  await putJSON(env, 'todos', list);
  await putJSON(env, 'todolog', log);
  return Response.json({ todos: list, log });
}

// ---------- daily checklist ----------

const DEFAULT_CHECKLIST = [{"id":"an01","text":"Check ClubReady lost members report and identify cancellations requiring follow-up","owner":"Anna","note":"","days":{"1":1,"2":1,"3":1,"4":1,"5":1}},{"id":"an02","text":"Check ClubReady member tasks and action all outstanding items","owner":"Anna","note":"","days":{"1":2,"2":2,"3":2,"4":2,"5":2}},{"id":"an03","text":"Check all new leads and the first visits report. Call and send SMS follow-ups, including anyone who attended but has not joined","owner":"Anna","note":"","days":{"1":3,"2":3,"3":3,"4":3,"5":3}},{"id":"an04","text":"Check overdue accounts and follow the past-due process","owner":"Anna","note":"Overdue payment procedure: call the member, send an SMS, issue the appropriate Gmail payment reminder and record the outcome in WorkIt/ClubReady as applicable. Unresolved accounts stay on the follow-up list.","days":{"1":4,"2":4,"3":4,"4":4,"5":4}},{"id":"an05","text":"Send the 24-hour missed-sale offer of Unlimited at $59.20 to eligible non-converters","owner":"Anna","note":"","days":{"1":5,"2":5,"3":5,"4":5,"5":5}},{"id":"an06","text":"Check and respond to emails","owner":"Anna","note":"","days":{"1":6,"2":6,"3":6,"4":6,"5":6}},{"id":"an07","text":"Check and respond to ClubReady SMS messages","owner":"Anna","note":"","days":{"1":7,"2":7,"3":7,"4":7,"5":7}},{"id":"an08","text":"Review every class from the previous day and call all no-shows","owner":"Anna","note":"","days":{"1":8,"2":8,"3":8,"4":8,"5":8}},{"id":"an09","text":"Check the ClubReady class schedule for changes, cancellations and booking issues","owner":"Anna","note":"","days":{"1":9,"2":9,"3":9,"4":9,"5":9}},{"id":"an10","text":"Update ClubReady member notes after calls, SMS and follow-ups","owner":"Anna","note":"","days":{"1":10,"2":10,"3":10,"4":10,"5":10}},{"id":"ty01","text":"Check voicemail and respond to messages or allocate follow-ups","owner":"Tyson","note":"","days":{"1":101,"2":101,"3":101,"4":101,"5":101}},{"id":"ty02","text":"Post three Instagram Stories from the studio","owner":"Tyson","note":"","days":{"1":102,"2":102,"3":102,"4":102,"5":102}},{"id":"ty03","text":"Check bathroom supplies, including toilet rolls, and studio stock","owner":"Tyson","note":"","days":{"1":103,"2":103,"3":103,"4":103,"5":103}},{"id":"ty04","text":"Restock Sippy Social coffee as required","owner":"Tyson","note":"","days":{"1":104,"2":104,"3":104,"4":104,"5":104}},{"id":"ty05","text":"Check promotional cards at local businesses","owner":"Tyson","note":"","days":{"1":105,"2":105,"3":105,"4":105,"5":105}},{"id":"ty06","text":"Check upcoming member milestones, update profile alerts, add names to whiteboard and put up milestone bags","owner":"Tyson","note":"","days":{"1":106,"2":106,"3":106,"4":106,"5":106}},{"id":"ni01","text":"Check cost per lead (CPL) and campaign performance","owner":"Nichola","note":"","days":{"1":201,"2":201,"3":201,"4":201,"5":201}},{"id":"ni02","text":"Check and respond to Meta comments and messages","owner":"Nichola","note":"","days":{"1":202,"2":202,"3":202,"4":202,"5":202}},{"id":"ni03","text":"Post class or introductory offers in relevant Facebook groups","owner":"Nichola","note":"","days":{"1":203,"2":203,"3":203,"4":203,"5":203}}];
const CHECKLIST_VER = "2026-10-30d";
async function loadChecklist(env) {
  const stored = await getJSON(env, "checklist"), ver = await getJSON(env, "checklistver");
  if (ver === CHECKLIST_VER && Array.isArray(stored)) return stored;
  const mine = Array.isArray(stored) ? stored.filter((i) => /^u/.test(String(i.id))) : []; // jobs added on the page are kept
  const items = DEFAULT_CHECKLIST.concat(mine);
  await putJSON(env, "checklist", items); await putJSON(env, "checklistver", CHECKLIST_VER);
  return items;
}

async function handleChecklist(request, env) {
  const body = await request.json().catch(() => ({}));
  const now = Date.now(), today = aestDate(now);
  const who = PEOPLE.includes(body.who) ? body.who : '';
  let items = await loadChecklist(env);
  let checks = (await getJSON(env, 'checks')) || {};
  let itemsChanged = false;
  if (body.action === 'tick') {
    if (!items.some((i) => i.id === body.id)) return Response.json({ error: 'Job not found' }, { status: 404 });
    const day = checks[today] || (checks[today] = {});
    if (day[body.id]) delete day[body.id]; else day[body.id] = { by: who, at: now };
    const keys = Object.keys(checks).sort();
    while (keys.length > 60) delete checks[keys.shift()];
  } else if (body.action === 'add') {
    const text = String(body.text || '').trim().slice(0, 200);
    const days = {};
    (Array.isArray(body.days) ? body.days : []).forEach((d) => { d = parseInt(d, 10); if (d >= 1 && d <= 6) days[d] = 1000 + items.length; });
    if (!text) return Response.json({ error: 'Add the job first' }, { status: 400 });
    if (!Object.keys(days).length) return Response.json({ error: 'Choose at least one day' }, { status: 400 });
    items.push({ id: 'u' + crypto.randomUUID().slice(0, 8), text, owner: OWNERS.includes(body.owner) ? body.owner : 'Anna', note: String(body.note || '').trim().slice(0, 500), days });
    items = items.slice(0, 150); itemsChanged = true;
  } else if (body.action === 'delete') {
    items = items.filter((i) => i.id !== body.id); itemsChanged = true;
  } else if (body.action === 'owner') {
    const it = items.find((i) => i.id === body.id);
    if (it && OWNERS.includes(body.owner)) { it.owner = body.owner; itemsChanged = true; }
  } else {
    return Response.json({ error: 'Unknown action' }, { status: 400 });
  }
  if (itemsChanged) await putJSON(env, 'checklist', items);
  await putJSON(env, 'checks', checks);
  return Response.json({ checklist: items, checks });
}

// ---------- recurring tasks ----------

const DEFAULT_RECURRING = [
  { id: "m-plan-socials", text: "Plan socials", owner: "Nichola", notes: '', freq: 'monthly', day: 1, anchor: '', dueDays: 3, paused: false },
  { id: "m-training-schedule", text: "Staff training schedule", owner: "Tyson", notes: '', freq: 'monthly', day: 1, anchor: '', dueDays: 3, paused: false },
  { id: "m-maintenance", text: "Maintenance schedule", owner: "Tyson", notes: '', freq: 'monthly', day: 1, anchor: '', dueDays: 3, paused: false },
  { id: "m-grassroots", text: "Plan grassroots", owner: "Tyson", notes: '', freq: 'monthly', day: 1, anchor: '', dueDays: 3, paused: false },
  { id: "m-newsletter", text: "Newsletter", owner: "Tyson", notes: '', freq: 'monthly', day: 15, anchor: '', dueDays: 3, paused: false },
  { id: "m-top-attendees", text: "Schedule a post: top attendees", owner: "Nichola", notes: '', freq: 'monthly', day: 15, anchor: '', dueDays: 3, paused: false },
  { id: "m-reel", text: "Create a reel of all milestones for the month", owner: "Nichola", notes: '', freq: 'monthly', day: 0, anchor: '', dueDays: 1, paused: false },
  { id: "m-audits", text: "Instructor audits", owner: "Tyson", notes: '', freq: 'monthly', day: 0, anchor: '', dueDays: 1, paused: false },
  { id: "m-long-pauses", text: "Check long pauses", owner: "Anna", notes: '', freq: 'monthly', day: 0, anchor: '', dueDays: 1, paused: false },
  { id: 'm-instructor-update', text: 'Monthly instructor update (staff newsletter)', owner: 'Tyson', notes: '', freq: 'monthly', day: 10, anchor: '', dueDays: 3, paused: false },
  { id: 'f-payroll', text: 'Run payroll', owner: 'Nichola', notes: 'Fortnightly, every second Tuesday. Last run Tue 27 Oct 2026.', freq: 'fortnightly', day: 2, anchor: '2026-11-10', dueDays: 0, paused: false },
  { id: "m-retention-review", text: "Monthly retention review", owner: "Anna", notes: "Review cancellation trends and the most common reasons for leaving. Review member retention and MIA activity. Check completion rates for all scheduled member check-ins.", freq: "monthly", day: 1, anchor: '', dueDays: 3, paused: false },
  { id: "m-sales-review", text: "Monthly intro class review", owner: "Anna", notes: "Review introductory class bookings, attendance and conversions.", freq: "monthly", day: 1, anchor: '', dueDays: 3, paused: false },
  { id: "w-report", text: "Weekly report to Nichola", owner: "Anna", notes: "Calls: total calls made and conversations completed. New leads: contacted and outstanding. Intro classes: booked, attended, no-shows. Conversions: intro attendees who became members. Cancellations: requested, processed, saved, reasons. MIA members: identified, contacted, re-engaged. Member check-ins: due, completed, overdue. Overdue payments: followed up and unresolved. Lost Member reconciliation: discrepancies found and corrected. Outstanding issues needing Tyson or Nichola.", freq: "weekly", day: 5, anchor: '', dueDays: 0, paused: false },
  { id: 'w-pif', text: 'Check paid-in-full (PIF) memberships', owner: 'Anna', notes: '', freq: 'weekly', day: 1, anchor: '', dueDays: 1, paused: false },
  { id: 'w-google-reviews', text: 'Schedule Google Review requests', owner: 'Anna', notes: '', freq: 'weekly', day: 2, anchor: '', dueDays: 1, paused: false },
  { id: 'w-lost-sheep', text: 'Run ClubReady Lost Sheep report (MIA members)', owner: 'Anna', notes: '', freq: 'weekly', day: 3, anchor: '', dueDays: 1, paused: false },
  { id: 'm-member-audit', text: 'Run full member audit and accuracy check', owner: 'Anna', notes: 'Run the full member audit report. Check that ClubReady records and tracking sheets are accurate, list any recurring operational problems and recommend improvements.', freq: 'monthly', day: 1, anchor: '', dueDays: 3, paused: false },
  { id: 'w-gbp-photo', text: 'Update Google Business Profile with a photo', owner: 'Nichola', notes: '', freq: 'weekly', day: 3, anchor: '', dueDays: 1, paused: false },
  { id: 'w-fb-cover', text: 'Review Facebook cover photo and change it if a campaign or promotion has changed', owner: 'Nichola', notes: 'As required: only change it when a campaign or promotion changes.', freq: 'weekly', day: 3, anchor: '', dueDays: 1, paused: false },
]; // the studio's monthly admin list; added once, then managed on the Recurring page
const FREQS = ['daily', 'weekly', 'fortnightly', 'monthly'];
const dayMs = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const msDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d, n) => msDay(dayMs(d) + n * 86400000);
const dow = (d) => new Date(dayMs(d)).getUTCDay();
const lastOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12

// The most recent date on or before `today` that this template should have fired, or null.
function occurrence(tpl, today) {
  if (tpl.freq === 'daily') {
    const w = dow(today);
    return w === 0 ? addDays(today, -2) : w === 6 ? addDays(today, -1) : today;
  }
  if (tpl.freq === 'weekly') return addDays(today, -((dow(today) - tpl.day + 7) % 7));
  if (tpl.freq === 'fortnightly') {
    const diff = Math.round((dayMs(today) - dayMs(tpl.anchor)) / 86400000);
    if (diff < 0) return null;
    return addDays(tpl.anchor, Math.floor(diff / 14) * 14);
  }
  if (tpl.freq === 'monthly') {
    let y = +today.slice(0, 4), m = +today.slice(5, 7);
    const pick = (yy, mm) => { const last = lastOfMonth(yy, mm); const d = tpl.day === 0 ? last : Math.min(tpl.day, last); return yy + '-' + String(mm).padStart(2, '0') + '-' + String(d).padStart(2, '0'); };
    let occ = pick(y, m);
    if (occ > today) { m -= 1; if (m === 0) { m = 12; y -= 1; } occ = pick(y, m); }
    return occ;
  }
  return null;
}

function trimTodos(list) {
  while (list.length > 300) {
    let i = -1;
    for (let k = list.length - 1; k >= 0; k--) if (list[k].done) { i = k; break; }
    list.splice(i === -1 ? list.length - 1 : i, 1);
  }
  return list;
}

async function runRecurring(env, nowMs) {
  const now = nowMs || Date.now();
  if (aestHour(now) < 5) return 0;
  const today = aestDate(now);
  let recs = await getJSON(env, 'recurring');
  if (!Array.isArray(recs)) recs = [];
  let seeded = [];
  try { const p = JSON.parse((await env.STUDIO.get('recseed')) || '[]'); seeded = Array.isArray(p) ? p : (p === 1 ? DEFAULT_RECURRING.slice(0, 11).map((r) => r.id) : []); } catch (e) { seeded = []; }
  const fresh = DEFAULT_RECURRING.filter((r) => !seeded.includes(r.id)); // each starter job is added once, so removing one sticks
  if (fresh.length) {
    const have = new Set(recs.map((r) => r.id));
    for (const r of fresh) if (!have.has(r.id)) recs.push(Object.assign({ start: today, lastCreated: '', created: now }, r));
    await putJSON(env, 'recurring', recs);
    await env.STUDIO.put('recseed', JSON.stringify(DEFAULT_RECURRING.map((r) => r.id)));
  }
  if ((await env.STUDIO.get('recmig')) !== '3') { // tidy-up of overlapping jobs, 30 Oct 2026
    recs = recs.filter((r) => !['m-pif', 'm-admin-accuracy', 'm-staff-newsletter'].includes(r.id));
    const ren = { 'm-audits': 'Instructor audits', 'm-instructor-update': 'Monthly instructor update (staff newsletter)', 'm-member-audit': 'Run full member audit and accuracy check', 'w-lost-sheep': 'Run ClubReady Lost Sheep report (MIA members)' };
    for (const r of recs) if (ren[r.id]) r.text = ren[r.id];
    const ma = recs.find((r) => r.id === 'm-member-audit'); if (ma) ma.notes = 'Run the full member audit report. Check that ClubReady records and tracking sheets are accurate, list any recurring operational problems and recommend improvements.';
    await putJSON(env, 'recurring', recs); await env.STUDIO.put('recmig', '3');
  }
  const due = [];
  for (const r of recs) {
    if (r.paused) continue;
    const occ = occurrence(r, today);
    if (occ && occ >= (r.start || '') && occ > (r.lastCreated || '')) due.push([r, occ]);
  }
  if (!due.length) return 0;
  let todos = (await getJSON(env, 'todos')) || [];
  let log = (await getJSON(env, 'todolog')) || [];
  let made = 0;
  for (const [r, occ] of due) {
    r.lastCreated = occ;
    if (todos.some((t) => t.recurId === r.id && !t.done)) continue; // last one still open: do not pile up
    const t = {
      id: crypto.randomUUID(), text: r.text, owner: OWNERS.includes(r.owner) ? r.owner : 'Anyone',
      due: addDays(occ, r.dueDays || 0), notes: r.notes || '', done: false, created: now, createdBy: 'Auto', doneAt: null, doneBy: '', recurId: r.id,
    };
    todos.unshift(t);
    log.unshift({ at: now, who: 'Auto', action: 'added', id: t.id, text: t.text.slice(0, 120), detail: 'Repeating task (' + r.freq + ')' });
    made++;
  }
  trimTodos(todos);
  await putJSON(env, 'todos', todos);
  await putJSON(env, 'todolog', log.slice(0, 1000));
  await putJSON(env, 'recurring', recs);
  return made;
}

async function handleRecurring(request, env) {
  const body = await request.json().catch(() => ({}));
  let recs = (await getJSON(env, 'recurring')) || [];
  const now = Date.now(), today = aestDate(now);
  if (body.action === 'add') {
    const text = String(body.text || '').trim().slice(0, 300);
    if (!text) return Response.json({ error: 'Add the task first' }, { status: 400 });
    if (!FREQS.includes(body.freq)) return Response.json({ error: 'Choose how often' }, { status: 400 });
    let day = parseInt(body.day, 10);
    const r = { id: crypto.randomUUID(), text, owner: OWNERS.includes(body.owner) ? body.owner : 'Anyone', notes: String(body.notes || '').trim().slice(0, 1000), freq: body.freq, day: 0, anchor: '', dueDays: [0, 1, 2, 3, 7].includes(parseInt(body.dueDays, 10)) ? parseInt(body.dueDays, 10) : 0, paused: false, start: today, lastCreated: '', created: now };
    if (r.freq === 'weekly' || r.freq === 'fortnightly') {
      if (!(day >= 0 && day <= 6)) return Response.json({ error: 'Choose a day' }, { status: 400 });
      r.day = day;
      if (r.freq === 'fortnightly') { let a = today; while (dow(a) !== day) a = addDays(a, 1); r.anchor = a; }
    } else if (r.freq === 'monthly') {
      if (!(day >= 0 && day <= 28)) return Response.json({ error: 'Choose a day of the month' }, { status: 400 });
      r.day = day;
    }
    recs.push(r);
    recs = recs.slice(0, 100);
  } else if (body.action === 'delete') {
    recs = recs.filter((r) => r.id !== body.id);
  } else if (body.action === 'pause') {
    const r = recs.find((x) => x.id === body.id);
    if (r) r.paused = !r.paused;
  } else {
    return Response.json({ error: 'Unknown action' }, { status: 400 });
  }
  await putJSON(env, 'recurring', recs);
  // make today's task straight away if one is due
  await runRecurring(env, now);
  const todos = (await getJSON(env, 'todos')) || [];
  const rr = (await getJSON(env, 'recurring')) || [];
  return Response.json({ recurring: rr, todos });
}

// ---------- meetings ----------

async function handleMeetings(request, env) {
  const body = await request.json().catch(() => ({}));
  let list = (await getJSON(env, 'meetings')) || [];
  const now = Date.now();
  const who = PEOPLE.includes(body.who) ? body.who : '';
  if (body.action === 'add') {
    const title = String(body.title || '').trim().slice(0, 120) || 'Team meeting';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : aestDate(now);
    const summary = String(body.summary || '').trim().slice(0, 3000);
    if (!summary) return Response.json({ error: 'Add a short summary first' }, { status: 400 });
    const decisions = String(body.decisions || '').trim().slice(0, 2000);
    const attendees = (Array.isArray(body.attendees) ? body.attendees : []).filter((a) => PEOPLE.includes(a));
    let todos = (await getJSON(env, 'todos')) || [];
    let log = (await getJSON(env, 'todolog')) || [];
    const id = crypto.randomUUID();
    const actions = [];
    for (const a of (Array.isArray(body.actions) ? body.actions : []).slice(0, 15)) {
      const text = String((a && a.text) || '').trim().slice(0, 300);
      if (!text) continue;
      const t = {
        id: crypto.randomUUID(), text,
        owner: OWNERS.includes(a.owner) ? a.owner : 'Anyone',
        due: /^\d{4}-\d{2}-\d{2}$/.test(a.due || '') ? a.due : '',
        notes: 'From meeting: ' + title + ' (' + date + ')',
        done: false, created: now, createdBy: who, doneAt: null, doneBy: '', meetingId: id,
      };
      todos.unshift(t);
      log.unshift({ at: now, who, action: 'added', id: t.id, text: t.text.slice(0, 120), detail: 'From meeting: ' + title });
      actions.push({ taskId: t.id, text, owner: t.owner, due: t.due });
    }
    trimTodos(todos);
    log = log.slice(0, 1000);
    list.unshift({ id, date, title, attendees, summary, decisions, actions, created: now, createdBy: who });
    list = list.slice(0, 200);
    await putJSON(env, 'todos', todos);
    await putJSON(env, 'todolog', log);
    await putJSON(env, 'meetings', list);
    return Response.json({ meetings: list, todos, log });
  } else if (body.action === 'delete') {
    list = list.filter((m) => m.id !== body.id); // tasks already created stay on the to-do list
    await putJSON(env, 'meetings', list);
    return Response.json({ meetings: list });
  }
  return Response.json({ error: 'Unknown action' }, { status: 400 });
}

// ---------- useful links ----------
const DEFAULT_LINKS = [
  { id: 'merch', label: 'Club Pilates merchandise store', url: 'https://shop.boutiquefitnessstudios.com.au/', note: 'Official store', added: 0 },
  { id: 'intro', label: 'Intro class booking link', url: 'https://tinyurl.com/Club-Pilates-Sippy', note: 'Link for the intro class', added: 0 },
];

async function handleLinks(request, env) {
  const body = await request.json().catch(() => ({}));
  let list = await getJSON(env, 'links');
  if (!Array.isArray(list)) list = DEFAULT_LINKS.slice();
  if (body.action === 'add') {
    const label = String(body.label || '').trim().slice(0, 80);
    let url = String(body.url || '').trim();
    if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
    let ok = false;
    try { const u = new URL(url); ok = u.protocol === 'https:' || u.protocol === 'http:'; url = u.toString(); } catch (e) { ok = false; }
    if (!label || !ok) return Response.json({ error: 'Add a name and a web address' }, { status: 400 });
    list.push({ id: crypto.randomUUID(), label, url, note: String(body.note || '').trim().slice(0, 120), added: Date.now() });
    list = list.slice(0, 50);
  } else if (body.action === 'delete') {
    list = list.filter((l) => l.id !== body.id);
  } else {
    return Response.json({ error: 'Unknown action' }, { status: 400 });
  }
  await putJSON(env, 'links', list);
  return Response.json({ links: list });
}

// ---------- the page ----------

const DASHBOARD_HTML = `<!doctype html><html lang="en-AU"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Studio dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#f6f1e9;--card:#fffdf9;--line:#e3d9c8;--ink:#3b2a20;--mute:#7a6a5c;--accent:#8a6a43;--ok:#4d7a4d;--warn:#b0701f;--bad:#a33a2e;--t-people:#6f8f6a;--t-leads:#b5703f;--t-studio:#5f7f95;--t-tasks:#8a6a43;--t-meet:#8a7396;--t-links:#a69888;--o-Anna:#b5703f;--o-Tyson:#5f7f95;--o-Nichola:#6f8f6a;--o-Simone:#8a7396;--o-Anyone:#8a7f74}
@media (prefers-color-scheme:dark){:root{--bg:#1c1713;--card:#251f1a;--line:#3a3128;--ink:#efe6d8;--mute:#a69888;--accent:#c79a63;--ok:#8fbf8f;--warn:#e0a85a;--bad:#e07b6d;--t-people:#8fb48a;--t-leads:#d79a68;--t-studio:#86a9bf;--t-tasks:#c79a63;--t-meet:#b39cc2;--t-links:#7d7164;--o-Anna:#d79a68;--o-Tyson:#86a9bf;--o-Nichola:#8fb48a;--o-Simone:#b39cc2;--o-Anyone:#a69888}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Poppins,system-ui,sans-serif;font-weight:400;line-height:1.5}
header{padding:20px 16px 4px;max-width:1100px;margin:0 auto;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline;justify-content:space-between}
h1{font-size:20px;font-weight:500;margin:0}h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;font-weight:500;color:var(--mute);margin:0 0 10px}
.sub{color:var(--mute);font-size:13px}main{max-width:1100px;margin:0 auto;padding:12px 16px 40px;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}.wide{grid-column:1/-1}
.big{font-size:44px;font-weight:300;line-height:1.1}.row{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid var(--line);font-size:14px}
.row:last-child{border-bottom:0}.mute{color:var(--mute)}.note{font-size:12px;color:var(--mute);margin-top:10px}
.up{color:var(--ok)}.down{color:var(--bad)}.warn{color:var(--warn)}.blank{color:var(--mute)}
.bars{display:flex;gap:6px;align-items:flex-end;height:70px;margin:10px 0 2px}.bar{flex:1;background:var(--accent);opacity:.8;border-radius:3px 3px 0 0;min-height:2px;position:relative}
.bar span{position:absolute;top:-16px;left:0;right:0;text-align:center;font-size:11px;color:var(--mute)}.lbl{display:flex;gap:6px;font-size:11px;color:var(--mute)}.lbl div{flex:1;text-align:center}
button,select,input,textarea{font:inherit;font-size:14px}button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:8px 14px;cursor:pointer}
button.ghost{background:transparent;color:var(--mute);border:1px solid var(--line)}input[type=text],input[type=date],select{padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
.todo{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)}.todo .body{flex:1;min-width:0}.todo .t{word-break:break-word}.todo.done .t{text-decoration:line-through;color:var(--mute)}
.todo .meta{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0}.todo textarea{width:100%;margin-top:4px;min-height:34px;resize:vertical;font:inherit;font-size:13px;padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
.add{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}.add input[type=text]{flex:1;min-width:200px}.add .notesin{flex-basis:100%}.who{display:flex;gap:8px;align-items:center;margin-bottom:10px;font-size:13px;color:var(--mute)}
.laze{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:6px 0 4px}.laze .k{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)}.laze .n{font-size:38px;font-weight:300;line-height:1.15}
.lk{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)}.lk a{color:var(--accent);font-weight:500;word-break:break-word}.lk .nt{font-size:12px;color:var(--mute)}.linkadd{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.linkadd input[type=text]{flex:1;min-width:160px}
.ta{width:100%;min-height:84px;resize:vertical;font:inherit;font-size:14px;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);margin:4px 0 10px}.lblx{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)}
.chk{display:flex;gap:14px;flex-wrap:wrap;margin:6px 0 10px;font-size:14px}.chk label{display:flex;gap:6px;align-items:center}.arow{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}.arow input[type=text]{flex:1;min-width:180px}
.pre{white-space:pre-wrap;word-break:break-word}
.card{border-top:3px solid var(--tc,var(--line))}.t-people{--tc:var(--t-people)}.t-leads{--tc:var(--t-leads)}.t-studio{--tc:var(--t-studio)}.t-tasks{--tc:var(--t-tasks)}.t-meet{--tc:var(--t-meet)}.t-links{--tc:var(--t-links)}
.pill.own{color:var(--oc);border-color:var(--oc);background:color-mix(in srgb,var(--oc) 12%,transparent)}.o-Anna{--oc:var(--o-Anna)}.o-Tyson{--oc:var(--o-Tyson)}.o-Nichola{--oc:var(--o-Nichola)}.o-Simone{--oc:var(--o-Simone)}.o-Anyone{--oc:var(--o-Anyone)}
.todo{border-left:3px solid transparent;padding-left:10px}.todo.od{border-left-color:var(--bad)}.todo.dt{border-left-color:var(--warn)}.todo.done{opacity:.75}.todo.hi{border-left:5px solid var(--bad);background:color-mix(in srgb,var(--bad) 6%,transparent)}.pill.hi{color:#fff;background:var(--bad);border-color:var(--bad);font-weight:500}.todo select.own{font-size:12px;padding:3px 8px;border-radius:99px;width:auto}.hilbl{display:flex;gap:6px;align-items:center;font-size:13px;color:var(--bad)}
.stack{display:flex;height:10px;border-radius:99px;overflow:hidden;margin:10px 0 4px;background:var(--line)}.stack div{height:100%}.leg{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--mute)}.leg i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:baseline}
.meter{height:8px;border-radius:99px;background:var(--line);overflow:hidden;margin:6px 0 2px}.meter div{height:100%;border-radius:99px}
.chip{display:inline-block;font-size:11px;padding:2px 9px;border-radius:99px;margin-left:8px;vertical-align:middle;color:var(--c);border:1px solid var(--c);background:color-mix(in srgb,var(--c) 12%,transparent)}.chip.g{--c:var(--ok)}.chip.a{--c:var(--warn)}.chip.r{--c:var(--bad)}
.k-L{color:var(--t-leads)}.k-A{color:var(--t-studio)}.k-S{color:var(--t-people)}.k-E{color:var(--t-tasks)}
.ck{display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--line)}.ck:last-child{border-bottom:0}.ck .body{flex:1;min-width:0}.ck .t{word-break:break-word}.ck.done .t{text-decoration:line-through;color:var(--mute)}.ck .nt{font-size:12px;color:var(--mute)}.ck .meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
details.mg summary{cursor:pointer;color:var(--accent);font-weight:500;margin:6px 0}.tabs{display:flex;gap:8px;flex-wrap:wrap}.tabs button.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.hrow{display:grid;grid-template-columns:150px 1fr;gap:4px 12px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}.hrow .when{color:var(--mute);font-size:13px}.hrow .what{min-width:0;word-break:break-word}
@media(max-width:560px){.hrow{grid-template-columns:1fr}}
.pill{font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);color:var(--mute);white-space:nowrap}
.cls{display:grid;grid-template-columns:62px 1fr auto;gap:8px;padding:5px 0;border-bottom:1px solid var(--line);font-size:14px}.cls:last-child{border-bottom:0}
</style></head><body>
<header><div><h1>Club Pilates Sippy Downs</h1><div class="sub" id="status">Loading...</div></div>
<div class="tabs"><button class="ghost" id="navDash">Dashboard</button><button class="ghost" id="navMeet">Meetings</button><button class="ghost" id="navRec">Recurring</button><button class="ghost" id="navInstr">Instructors</button><button class="ghost" id="navHist">To-do history</button><button class="ghost" id="refresh">Refresh now</button></div></header>
<main id="main"></main>
<script>
const $=(t,a={},...k)=>{const e=document.createElement(t);for(const[x,v]of Object.entries(a)){if(x==='class')e.className=v;else if(x.startsWith('on'))e.addEventListener(x.slice(2),v);else e.setAttribute(x,v)}for(const c of k.flat())if(c!=null)e.append(c.nodeType?c:document.createTextNode(c));return e};
const fmtT=ms=>ms?new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Brisbane',weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(ms)):'';
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monLabel=k=>MON[+k.slice(5,7)-1];
const dash='\\u2014';
function clockMins(s){const m=/(\\d{1,2}):(\\d{2})(?::\\d{2})?\\s*([AaPp])?/.exec(s||'');if(!m)return 0;let h=+m[1];const ap=(m[3]||'').toLowerCase();if(ap==='p'&&h<12)h+=12;if(ap==='a'&&h===12)h=0;return h*60+ +m[2]}
function fmtClock(s){if(!/(\\d{1,2}):(\\d{2})/.test(s||''))return s||'';const t=clockMins(s),h=Math.floor(t/60),ap=h>=12?'pm':'am';return (h%12||12)+':'+String(t%60).padStart(2,'0')+ap}
function src(text,ts){return $('div',{class:'note'},'Source: '+text+(ts?'. Fetched '+fmtT(ts)+'.':'. No data yet.'))}
function blankPanel(title,why){return $('div',{class:'card'},$('h2',{},title),$('div',{class:'big blank'},dash),$('div',{class:'note'},why))}

function ownerPill(o,pre){return $('span',{class:'pill own o-'+(['Anna','Tyson','Nichola','Simone'].includes(o)?o:'Anyone')},(pre||'')+o)}
function tone(p,g,a){return p>=g?'g':(p>=a?'a':'r')}
function membersCard(s){
  if(!s)return blankPanel('Members','No data yet. The first refresh runs overnight, or press Refresh now.');
  const m=s.members;
  const tot=Math.max(1,m.recurring+m.prepaid+m.frozen+m.review),seg=(n,c)=>$('div',{style:'width:'+(n/tot*100)+'%;background:'+c});
  const dot=(c,t)=>$('span',{},$('i',{style:'background:'+c}),t);
  return $('div',{class:'card t-people'},$('h2',{},'Members'),$('div',{class:'big'},String(m.active)),$('div',{class:'mute'},'active members'),
    $('div',{class:'stack'},seg(m.recurring,'var(--t-people)'),seg(m.prepaid,'var(--t-studio)'),seg(m.frozen,'var(--t-links)'),seg(m.review,'var(--warn)')),
    $('div',{class:'leg'},dot('var(--t-people)','Recurring'),dot('var(--t-studio)','Paid up front'),dot('var(--t-links)','Frozen'),dot('var(--warn)','Needs a look')),
    $('div',{style:'margin-top:10px'}),
    $('div',{class:'row'},$('span',{},'On recurring invoices'),$('span',{},String(m.recurring))),
    $('div',{class:'row'},$('span',{},'Paid up front (PIF)'),$('span',{},String(m.prepaid))),
    $('div',{class:'row'},$('span',{},'Frozen (paused)'),$('span',{},String(m.frozen))),
    $('div',{class:'row'},$('span',{},'Needs a look (no invoice ahead, nothing recent)'),$('span',{class:m.review?'warn':'up'},String(m.review))),
    $('div',{class:'note'},'Active means a recurring invoice ahead, a payment in the last 14 days, or a paid-up-front plan that has not run out. The ClubReady end date is ignored.'),
    src('ClubReady API',s.generatedAt));
}

function movementCard(s){
  if(!s)return blankPanel('Net member movement','No data yet.');
  const log=(s.movement&&s.movement.log)||[];const thisMonth=new Date(Date.now()+10*3600e3).toISOString().slice(0,7);
  const mine=log.filter(x=>x.date.startsWith(thisMonth));let j=mine.reduce((a,x)=>a+x.joined,0),l=mine.reduce((a,x)=>a+x.left,0);
  const mt=s.movement&&s.movement.mtd&&s.movement.mtd.month===thisMonth?s.movement.mtd:null;if(mt){j=mt.joined;l=mt.left}
  const rows=[];
  if(log.length||mt){rows.push($('div',{class:'big '+(j-l>=0?'up':'down')},(j-l>0?'+':'')+(j-l)),$('div',{class:'mute'},'net month to date'+(mt?' ('+mt.startCount+' active at the start, '+mt.nowCount+' now)':'')),$('div',{style:'margin-top:10px'}),
    $('div',{class:'row'},$('span',{},'New or back on the active list'),$('span',{},String(j))),$('div',{class:'row'},$('span',{},'Off the active list (left, frozen or needs a look)'),$('span',{},String(l))))}
  else rows.push($('div',{class:'big blank'},dash),$('div',{class:'mute'},'Counting starts today. First figures tomorrow.'));
  rows.push($('div',{style:'margin-top:12px'},$('h2',{},'Joined by month (ClubReady join dates, approximate)')));
  const keys=s.leads.months;const max=Math.max(1,...keys.map(k=>s.joinedByMonth[k]||0));
  rows.push($('div',{class:'bars'},keys.map(k=>$('div',{class:'bar',style:'height:'+Math.round(((s.joinedByMonth[k]||0)/max)*100)+'%'},$('span',{},String(s.joinedByMonth[k]||0))))),$('div',{class:'lbl'},keys.map(k=>$('div',{},monLabel(k)))));
  rows.push($('div',{class:'note'},(mt?'Month to date compares today\\'s active members with the list at the start of the month ('+mt.base+'), so someone who drops off and comes back in the same month is not counted twice. ':'Net movement is worked out each night by comparing the list of current members with the night before. ')+'The bars use ClubReady join dates, so they only count brand-new memberships, not people coming back from a freeze or a late payment.'),src('ClubReady API',s.generatedAt));
  return $('div',{class:'card t-people'},$('h2',{},'Net member movement'),rows);
}

function leadsCard(s){
  if(!s)return blankPanel('New leads','No data yet.');
  const L0=s.leads,cm=new Date(Date.now()+10*3600e3).toISOString().slice(0,7);
  if(L0.mtdMonth===cm){
    const k2=Object.keys(Object.assign({},L0.mtd,L0.prevMtd)).sort((a,b)=>(L0.mtd[b]||0)-(L0.mtd[a]||0));
    const d2=L0.mtdTotal-L0.prevMtdTotal,p2=L0.prevMtdTotal?Math.round(d2/L0.prevMtdTotal*100):null;
    const hasCur=typeof L0.mtdCurrent==='number';
    return $('div',{class:'card t-leads'},$('h2',{},'New leads, month to date'),$('div',{class:'big'},String(hasCur?L0.mtdCurrent:L0.mtdTotal)),
      hasCur?$('div',{class:'mute'},'current leads added this month (matches ClubReady\\'s Leads Added report, Current Leads)'):null,
      hasCur&&L0.mtdJoined?$('div',{class:'row'},$('span',{},'Plus already joined as members'),$('span',{class:'up'},String(L0.mtdJoined))):null,
      hasCur?$('div',{class:'row'},$('span',{},'Everyone added this month'),$('span',{},String(L0.mtdTotal))):null,
      $('div',{class:d2>=0?'up':'down'},(d2>0?'+':'')+d2+(p2!==null?' ('+(p2>0?'+':'')+p2+'%)':'')+' everyone added, on the same days last month ('+L0.prevMtdTotal+' by day '+L0.mtdDay+')'),
      $('div',{style:'margin-top:10px'}),
      k2.map(k=>$('div',{class:'row'},$('span',{},k),$('span',{},(L0.mtd[k]||0)+' ',$('span',{class:'mute'},'(was '+(L0.prevMtd[k]||0)+')')))),
      $('div',{class:'note'},'The big number leaves out leads who have already joined, the same as ClubReady\\'s Current Leads view, so it can drop as people sign up. The comparison and sources use everyone added, so conversions do not make this month look worse. Sources are grouped from the ClubReady referral type; the Meta group is any source containing Facebook, Instagram or FFM Social.'),
      src('ClubReady API',s.leadsAt&&s.leadsAt>s.generatedAt?s.leadsAt:s.generatedAt));
  }
  const L=s.leads,keys=Object.keys(Object.assign({},L.last30,L.prev30)).sort((a,b)=>(L.last30[b]||0)-(L.last30[a]||0));
  const d=L.last30Total-L.prev30Total,pct=L.prev30Total?Math.round(d/L.prev30Total*100):null;
  const meta='Meta (Facebook and Instagram)';
  return $('div',{class:'card t-leads'},$('h2',{},'New leads, last 30 days'),$('div',{class:'big'},String(L.last30Total)),
    $('div',{class:d>=0?'up':'down'},(d>0?'+':'')+d+(pct!==null?' ('+(pct>0?'+':'')+pct+'%)':'')+' on the 30 days before ('+L.prev30Total+')'),
    $('div',{style:'margin-top:10px'}),
    keys.map(k=>$('div',{class:'row'},$('span',{},k),$('span',{},(L.last30[k]||0)+' ',$('span',{class:'mute'},'(was '+(L.prev30[k]||0)+')')))),
    $('div',{class:'note'},'Counts everyone added to ClubReady in the period. Sources are grouped from the ClubReady referral type; the Meta group is any source containing Facebook, Instagram or FFM Social.'),
    src('ClubReady API',s.generatedAt));
}

function stageCard(s){
  if(!s)return blankPanel('Where this month\\'s leads are now','No data yet.');
  const cm=new Date(Date.now()+10*3600e3).toISOString().slice(0,7),isM=s.leads.mtdMonth===cm&&s.leads.stageMtd;
  const st=isM?s.leads.stageMtd:s.leads.stage30,keys=Object.keys(st).sort((a,b)=>st[b]-st[a]);
  return $('div',{class:'card t-leads'},$('h2',{},isM?'Where this month\\'s leads are now':'Where the last 30 days of leads are now'),keys.map(k=>$('div',{class:'row'},$('span',{},k),$('span',{},String(st[k])))),src('ClubReady API (current lead status)',s.generatedAt));
}

function classesCard(c){
  if(!c)return blankPanel('Classes','No data yet.');
  const today=new Date(Date.now()+10*3600e3).toISOString().slice(0,10);const tomorrow=new Date(Date.now()+34*3600e3).toISOString().slice(0,10);
  const wk=c.list.filter(x=>x.max>0),booked=wk.reduce((a,x)=>a+(x.max-x.free),0),total=wk.reduce((a,x)=>a+x.max,0);
  const td=c.list.filter(x=>x.date===today).sort((a,b)=>clockMins(a.start)-clockMins(b.start));
  const quiet=c.list.filter(x=>(x.date===today||x.date===tomorrow)&&x.max>0&&x.free/x.max>=0.6);
  const bp=total?Math.round(booked/total*100):0,bt=tone(bp,70,50),bc={g:'var(--ok)',a:'var(--warn)',r:'var(--bad)'}[bt];
  return $('div',{class:'card t-studio'},$('h2',{},'Studio today'),
    $('div',{class:'row'},$('span',{},'Booked, next 7 days'),$('span',{},total?booked+' of '+total+' ('+bp+'%)':dash,total?$('span',{class:'chip '+bt},bt==='g'?'healthy':bt==='a'?'watch':'low'):null)),
    total?$('div',{class:'meter'},$('div',{style:'width:'+bp+'%;background:'+bc})):null,
    $('div',{class:'row'},$('span',{},'Quiet classes today or tomorrow (60%+ free)'),$('span',{class:quiet.length?'warn':'up'},String(quiet.length))),
    $('div',{style:'margin-top:8px'}),
    td.length?td.map(x=>$('div',{class:'cls'},$('span',{class:'mute'},fmtClock(x.start)),$('span',{},x.title+(x.who?' ('+x.who+')':'')),$('span',{class:x.max&&x.free/x.max>=0.6?'warn':(x.max&&x.free/x.max<=0.2?'up':'')},x.max?(x.max-x.free)+'/'+x.max:dash))):$('div',{class:'mute'},'No classes found for today.'),
    src('ClubReady API (class schedule)',c.generatedAt));
}

const fmtD=ms=>ms?new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Brisbane',weekday:'short',day:'numeric',month:'short'}).format(new Date(ms)):'';
const fmtDay=d=>d?new Intl.DateTimeFormat('en-AU',{timeZone:'UTC',weekday:'short',day:'numeric',month:'short'}).format(new Date(d+'T12:00:00Z')):'';
const todayAEST=()=>new Date(Date.now()+10*3600e3).toISOString().slice(0,10);
const HOT=/#hot\\s*-?\\s*leads?/i;
let curWho='';let addMsg='';
const getWho=()=>{if(curWho)return curWho;try{return localStorage.getItem('sdwho')||''}catch(e){return ''}};
const setWho=v=>{curWho=v;try{localStorage.setItem('sdwho',v)}catch(e){}};
let D={todos:[],todolog:[],laze:null,links:[],meetings:[],recurring:[],checklist:[],checks:{}};
const hotOpen=()=>D.todos.filter(t=>!t.done&&HOT.test((t.text||'')+' '+(t.notes||''))).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
const dueCount=()=>hotOpen().filter(t=>t.due&&t.due<=todayAEST()).length;
async function postTodo(b){
  const r=await fetch('/api/todos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({who:getWho()},b))});
  if(r.ok){const j=await r.json();D.todos=j.todos;D.todolog=j.log||D.todolog;render();return true}
  let m='Something went wrong';try{m=(await r.json()).error||m}catch(e){}alert(m);return false}

function hotLeadsCard(){
  const hot=hotOpen(),today=todayAEST();
  const rows=hot.map(t=>{
    const name=(t.text||'').replace(HOT,'').replace(/\\s+/g,' ').trim()||t.text;
    let when,cls='mute';
    if(!t.due){when='no follow-up date';cls='warn'}
    else if(t.due<today){when='overdue, was '+fmtDay(t.due);cls='down'}
    else if(t.due===today){when='follow up today';cls='warn'}
    else when='follow up '+fmtDay(t.due);
    const nt=(t.notes||'').replace(HOT,'').trim();
    return $('div',{class:'todo'},
      $('input',{type:'checkbox',title:'Tick when followed up',onchange:()=>postTodo({action:'toggle',id:t.id})}),
      $('div',{class:'body'},$('div',{class:'t'},name),
        $('div',{class:'meta'},t.high?$('span',{class:'pill hi'},'High priority'):null,ownerPill(t.owner,'For '),$('span',{class:'pill '+cls,style:cls==='down'?'color:var(--bad);border-color:var(--bad)':cls==='warn'?'color:var(--warn);border-color:var(--warn)':''},when)),
        nt?$('div',{class:'note'},nt):null))});
  const due=dueCount();
  return $('div',{class:'card t-leads'},$('h2',{},'Hot leads'),
    $('div',{class:'big '+(due?'warn':'')},String(hot.length)),
    $('div',{class:due?'warn':'mute'},hot.length?(due?due+' to follow up today or overdue':'open hot leads, none due yet'):'No hot leads. Add a task with #hotlead and a follow-up date.'),
    $('div',{style:'margin-top:10px'}),rows,
    $('div',{class:'note'},'Any open task with #hotlead in it appears here, soonest follow-up first. Tick it when followed up. Full names are fine, but never phone numbers, emails or health details. Those stay in ClubReady.'));
}

function todoCard(){
  const input=$('input',{type:'text',placeholder:'Add a task (add #hotlead for a hot lead)',maxlength:'300'});
  const owner=$('select',{},['Anna','Tyson','Nichola','Simone','Anyone'].map(o=>$('option',{value:o},o)));owner.value='Anyone';
  const due=$('input',{type:'date',title:'Follow-up or due date'});
  const notesIn=$('input',{type:'text',class:'notesin',placeholder:'Notes (optional)',maxlength:'1000'});
  const me=$('select',{},$('option',{value:''},'Choose your name'),['Anna','Tyson','Nichola','Simone'].map(o=>$('option',{value:o},o)));me.value=getWho();
  me.addEventListener('change',()=>setWho(me.value));
  const share=$('input',{type:'checkbox'});const shareLbl=$('label',{class:'mute',style:'display:flex;gap:6px;align-items:center;font-size:13px'},share,'Share with instructors');
  const hiIn=$('input',{type:'checkbox'});const hiLbl=$('label',{class:'hilbl'},hiIn,'High priority');
  const msg=$('div',{class:'note warn'},addMsg);
  const add=async()=>{
    if(!input.value.trim())return;
    if(HOT.test(input.value+' '+notesIn.value)&&!due.value){addMsg='A hot lead needs a follow-up date. Pick one in the date box, then press Add.';msg.textContent=addMsg;return}
    addMsg='';
    await postTodo({action:'add',text:input.value,owner:owner.value,due:due.value,notes:notesIn.value,shared:share.checked,high:hiIn.checked})};
  input.addEventListener('keydown',e=>{if(e.key==='Enter')add()});
  const list=$('div',{});
  const items=D.todos.slice().sort((a,b)=>(a.done-b.done)||(a.done?0:((b.high?1:0)-(a.high?1:0)))||((b.done?b.doneAt-a.doneAt:0)));
  list.append(...items.map(t=>{
    const notes=$('textarea',{placeholder:'Add a note (saves when you click away)',maxlength:'1000',rows:'1'});notes.value=t.notes||'';
    const ownSel=$('select',{class:'own pill own o-'+(['Anna','Tyson','Nichola','Simone'].includes(t.owner)?t.owner:'Anyone'),title:'Reassign this task'},['Anna','Tyson','Nichola','Simone','Anyone'].map(o=>$('option',{value:o},'For '+o)));ownSel.value=t.owner;
    ownSel.addEventListener('change',()=>{const to=ownSel.value;if(to===t.owner)return;const h=prompt('Reassign to '+to+'. Add a handover note? (optional)','');if(h===null){ownSel.value=t.owner;return}postTodo({action:'owner',id:t.id,owner:to,handover:h})});
    notes.addEventListener('change',()=>postTodo({action:'notes',id:t.id,notes:notes.value}));
    const tdy=new Date(Date.now()+10*3600e3).toISOString().slice(0,10),urg=(!t.done&&t.due)?(t.due<tdy?' od':(t.due===tdy?' dt':'')):'';
    return $('div',{class:'todo'+(t.done?' done':'')+urg+(t.high&&!t.done?' hi':'')},
      $('input',{type:'checkbox',title:'Tick when complete',...(t.done?{checked:''}:{}),onchange:()=>postTodo({action:'toggle',id:t.id})}),
      $('div',{class:'body'},$('div',{class:'t'},t.text),
        $('div',{class:'meta'},t.high&&!t.done?$('span',{class:'pill hi'},'High priority'):null,t.done?ownerPill(t.owner):ownSel,t.recurId?$('span',{class:'pill'},'repeating'):null,t.shared?$('span',{class:'pill',style:'color:var(--t-meet);border-color:var(--t-meet)'},'shared with instructors'):null,t.due?$('span',{class:'pill',style:urg===' od'?'color:var(--bad);border-color:var(--bad)':urg===' dt'?'color:var(--warn);border-color:var(--warn)':''},(urg===' od'?'overdue, was ':'due ')+fmtDay(t.due)):null,
          $('span',{class:'pill'},'added '+fmtD(t.created)+(t.createdBy?' by '+t.createdBy:'')),
          t.done?$('span',{class:'pill',style:'color:var(--ok);border-color:var(--ok)'},'completed '+fmtT(t.doneAt)+(t.doneBy?' by '+t.doneBy:'')):null),
        notes),
      $('div',{style:'display:grid;gap:6px'},t.done?null:$('button',{class:'ghost',style:t.high?'color:var(--bad);border-color:var(--bad)':'',onclick:()=>postTodo({action:'priority',id:t.id})},t.high?'Not urgent':'Urgent'),$('button',{class:'ghost',onclick:()=>postTodo({action:'share',id:t.id})},t.shared?'Unshare':'Share'),$('button',{class:'ghost',onclick:()=>postTodo({action:'delete',id:t.id})},'Remove')))}));
  if(!items.length)list.append($('div',{class:'mute'},'Nothing on the list.'));
  return $('div',{class:'card wide t-tasks'},$('h2',{},'Team to-do list'),
    $('div',{class:'who'},$('span',{},'Who is using this screen?'),me),
    $('div',{class:'add'},input,owner,due,notesIn,hiLbl,shareLbl,$('button',{onclick:add},'Add')),msg,list,
    $('div',{class:'note'},'Tick the box when a task is done and the date, time and name are recorded. To hand a task to someone else, change the name on it and add a handover note. Urgent tasks sit at the top in red. Removed tasks stay in the history. Changes show for everyone when the page is next opened or refreshed.'));
}

function lazeCard(){
  const s=D.summary,z=D.laze;
  if(!s||!z)return blankPanel('LASER: Leads, Appointments, Shows, Enrolments','No data yet. Leads and enrolments arrive with the member count; appointments and shows arrive a few minutes after it.');
  const cur=new Date(Date.now()+10*3600e3).toISOString().slice(0,7),pk=(k=>{const p=k.split('-').map(Number);return p[1]===1?(p[0]-1)+'-12':p[0]+'-'+String(p[1]-1).padStart(2,'0')})(cur);
  const get=k=>{const m=z.months&&z.months[k];if(!m)return null;return {L:(s.leads.addedByMonth&&s.leads.addedByMonth[k])||0,A:m.appointments,S:m.shows,E:(s.joinedByMonth&&s.joinedByMonth[k])||0,m}};
  const c=get(cur),p=get(pk);
  if(!c)return blankPanel('LASER: Leads, Appointments, Shows, Enrolments','This month has not been counted yet.');
  const pct=(a,b)=>b?Math.round(a/b*100)+'%':dash;
  const col=(k,n,sub)=>$('div',{},$('div',{class:'k k-'+k[0]},k),$('div',{class:'n'},String(n)),$('div',{class:'mute'},sub));
  const mname=new Intl.DateTimeFormat('en-AU',{timeZone:'UTC',month:'long'}).format(new Date(cur+'-15T12:00:00Z'));
  return $('div',{class:'card wide t-leads'},$('h2',{},'LASER this month ('+mname+')'),
    $('div',{class:'laze'},col('Leads',c.L,'added to ClubReady'),col('Appointments',c.A,pct(c.A,c.L)+' of leads'),col('Shows',c.S,pct(c.S,c.A)+' of appointments'),col('Enrolments',c.E,pct(c.E,c.S)+' of shows')),
    $('div',{class:'row'},$('span',{},'Booked intros still to come'),$('span',{},String(c.m.upcoming))),
    $('div',{class:'row'},$('span',{},'No-shows'),$('span',{class:c.m.noShows?'warn':'up'},String(c.m.noShows))),
    p?$('div',{class:'row'},$('span',{},'Last month'),$('span',{},p.L+' leads, '+p.A+' appointments, '+p.S+' shows, '+p.E+' enrolments')):null,
    $('div',{class:'note'},'Leads: people added to ClubReady this month. Appointments: people booked into an intro class dated this month. Shows: those marked as attended. Enrolments: memberships started this month (from ClubReady join dates, approximate). Each month is counted on its own, so a lead who books in one month and joins in the next counts in each month separately. Referrals will be added by hand later.'+(c.m.truncated?' Note: only the first '+c.m.classes+' intro classes were counted.':'')),
    src('ClubReady API (leads, join dates, intro class rosters)',c.m.at));
}

async function postLink(b){
  const r=await fetch('/api/links',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});
  if(r.ok){const j=await r.json();D.links=j.links;render();return true}
  let m='Something went wrong';try{m=(await r.json()).error||m}catch(e){}alert(m);return false}

function linksCard(){
  const name=$('input',{type:'text',placeholder:'Name, for example: Socks supplier',maxlength:'80'});
  const url=$('input',{type:'text',placeholder:'Web address',maxlength:'500'});
  const note=$('input',{type:'text',placeholder:'Note (optional)',maxlength:'120'});
  const add=async()=>{if(!name.value.trim()||!url.value.trim()){alert('Add a name and a web address');return}await postLink({action:'add',label:name.value,url:url.value,note:note.value})};
  url.addEventListener('keydown',e=>{if(e.key==='Enter')add()});
  const items=(D.links||[]).filter(l=>/^https?:\\/\\//i.test(l.url||''));
  return $('div',{class:'card wide t-links'},$('h2',{},'Useful links'),
    items.length?items.map(l=>$('div',{class:'lk'},$('div',{},$('a',{href:l.url,target:'_blank',rel:'noopener noreferrer'},l.label),l.note?$('div',{class:'nt'},l.note):null),$('button',{class:'ghost',onclick:()=>postLink({action:'delete',id:l.id})},'Remove'))):$('div',{class:'mute'},'No links yet.'),
    !items.some(l=>/sock/i.test(l.label))?$('div',{class:'note'},'No sock supplier saved yet. Add one below.'):null,
    $('div',{class:'linkadd'},name,url,note,$('button',{onclick:add},'Add link')));
}

function historyView(){
  const todos=D.todos,log=D.todolog||[];
  const open=todos.filter(t=>!t.done),done=todos.filter(t=>t.done).sort((a,b)=>b.doneAt-a.doneAt);
  const taskRow=t=>$('div',{class:'hrow'},$('div',{class:'when'},t.done?'Completed '+fmtT(t.doneAt)+(t.doneBy?' by '+t.doneBy:''):'Open'),
    $('div',{class:'what'},$('div',{},t.text),$('div',{class:'mute'},(t.high?'High priority. ':'')+'For '+t.owner+(t.due?', due '+t.due:'')+'. Added '+fmtD(t.created)+(t.createdBy?' by '+t.createdBy:'')+'.'),t.notes?$('div',{class:'note'},'Notes: '+t.notes):null));
  const evRow=e=>$('div',{class:'hrow'},$('div',{class:'when'},fmtT(e.at)),$('div',{class:'what'},$('strong',{},(e.who||'Someone')+' '+e.action),' ',e.text,e.detail?$('div',{class:'note'},e.detail):null));
  return [
    checklistHistory(),
    $('div',{class:'card wide t-tasks'},$('h2',{},'To-do summary'),$('div',{class:'row'},$('span',{},'Open'),$('span',{},String(open.length))),$('div',{class:'row'},$('span',{},'Completed'),$('span',{},String(done.length))),
      $('div',{class:'note'},'Everything below is kept so you can check who did what and when.')),
    $('div',{class:'card wide'},$('h2',{},'Open tasks'),open.length?open.map(taskRow):$('div',{class:'mute'},'Nothing open.')),
    $('div',{class:'card wide'},$('h2',{},'Completed tasks'),done.length?done.map(taskRow):$('div',{class:'mute'},'Nothing completed yet.')),
    $('div',{class:'card wide'},$('h2',{},'Activity log (newest first)'),log.length?log.slice(0,200).map(evRow):$('div',{class:'mute'},'No activity yet.'))
  ];
}

async function postMeeting(b){
  const r=await fetch('/api/meetings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({who:getWho()},b))});
  if(r.ok){const j=await r.json();D.meetings=j.meetings;if(j.todos)D.todos=j.todos;if(j.log)D.todolog=j.log;render();return true}
  let m='Something went wrong';try{m=(await r.json()).error||m}catch(e){}alert(m);return false}

function meetingForm(){
  const title=$('input',{type:'text',value:'Weekly team meeting',maxlength:'120'});
  const date=$('input',{type:'date'});date.value=todayAEST();
  const boxes=['Anna','Tyson','Nichola','Simone'].map(n=>{const c=$('input',{type:'checkbox',value:n});return {n,c}});
  const summary=$('textarea',{class:'ta',maxlength:'3000',placeholder:'Three to five lines on what was covered. Names are fine, but no phone numbers, emails or health details.'});
  const decisions=$('textarea',{class:'ta',maxlength:'2000',placeholder:'What was decided'});
  const rows=[];const arows=$('div',{});
  const addRow=()=>{const t=$('input',{type:'text',placeholder:'Action',maxlength:'300'});const o=$('select',{},['Anna','Tyson','Nichola','Simone','Anyone'].map(x=>$('option',{value:x},x)));o.value='Anyone';const d=$('input',{type:'date',title:'Due date'});rows.push({t,o,d});arows.append($('div',{class:'arow'},t,o,d))};
  addRow();addRow();addRow();
  const save=async()=>{
    const actions=rows.filter(x=>x.t.value.trim()).map(x=>({text:x.t.value,owner:x.o.value,due:x.d.value}));
    await postMeeting({action:'add',title:title.value,date:date.value,attendees:boxes.filter(b=>b.c.checked).map(b=>b.n),summary:summary.value,decisions:decisions.value,actions})};
  return $('div',{class:'card wide t-meet'},$('h2',{},'Add a meeting'),
    $('div',{class:'add'},title,date),
    $('div',{class:'lblx'},'Who was there'),$('div',{class:'chk'},boxes.map(b=>$('label',{},b.c,b.n))),
    $('div',{class:'lblx'},'Summary'),summary,$('div',{class:'lblx'},'Decisions'),decisions,
    $('div',{class:'lblx'},'Actions (each one goes onto the to-do list)'),arows,
    $('div',{class:'add'},$('button',{class:'ghost',onclick:addRow},'Add another action'),$('button',{onclick:save},'Save meeting')),
    $('div',{class:'note'},'Member and lead names are fine in meeting notes, but never phone numbers, emails or health details. Those stay in ClubReady.'));
}

function meetingsView(){
  const ms=D.meetings||[];const byId={};D.todos.forEach(t=>{byId[t.id]=t});
  const one=m=>{
    const acts=(m.actions||[]).map(a=>{const t=byId[a.taskId];const st=t?(t.done?'done '+fmtT(t.doneAt)+(t.doneBy?' by '+t.doneBy:''):'open'):'removed from the list';
      return $('div',{class:'row'},$('span',{},a.text+' ('+a.owner+(a.due?', due '+fmtDay(a.due):'')+')'),$('span',{class:t&&t.done?'up':(t?'warn':'mute')},st))});
    const open=(m.actions||[]).filter(a=>byId[a.taskId]&&!byId[a.taskId].done).length;
    return $('div',{class:'card wide t-meet'},$('h2',{},fmtDay(m.date)+': '+m.title),
      $('div',{class:'mute'},'Present: '+((m.attendees||[]).join(', ')||'not recorded')+(m.createdBy?'. Written up by '+m.createdBy:'')+'.'),
      $('div',{class:'lblx',style:'margin-top:10px'},'Summary'),$('div',{class:'pre'},m.summary),
      m.decisions?$('div',{},$('div',{class:'lblx',style:'margin-top:10px'},'Decisions'),$('div',{class:'pre'},m.decisions)):null,
      (m.actions||[]).length?$('div',{},$('div',{class:'lblx',style:'margin:10px 0 4px'},'Actions: '+open+' still open of '+m.actions.length),acts):null,
      $('div',{style:'margin-top:10px'},$('button',{class:'ghost',onclick:()=>{if(confirm('Remove this meeting from the page? Its actions stay on the to-do list.'))postMeeting({action:'delete',id:m.id})}},'Remove meeting')));
  };
  return [meetingForm()].concat(ms.length?ms.map(one):[$('div',{class:'card wide mute'},'No meetings recorded yet.')]);
}

const WD=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const ord=n=>n+(n%10===1&&n!==11?'st':n%10===2&&n!==12?'nd':n%10===3&&n!==13?'rd':'th');
function freqText(r){
  if(r.freq==='daily')return 'Every weekday';
  if(r.freq==='weekly')return 'Every '+WD[r.day];
  if(r.freq==='fortnightly')return 'Every second '+WD[r.day]+(r.anchor?' (first: '+fmtDay(r.anchor)+')':'');
  return r.day===0?'Monthly, on the last day':'Monthly, on the '+ord(r.day);
}
async function postRecurring(b){
  const r=await fetch('/api/recurring',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});
  if(r.ok){const j=await r.json();D.recurring=j.recurring;if(j.todos)D.todos=j.todos;render();return true}
  let m='Something went wrong';try{m=(await r.json()).error||m}catch(e){}alert(m);return false}

function recurringView(){
  const text=$('input',{type:'text',placeholder:'Task, for example: Check next week class cover',maxlength:'300'});
  const owner=$('select',{},['Anna','Tyson','Nichola','Simone','Anyone'].map(x=>$('option',{value:x},x)));owner.value='Anyone';
  const freq=$('select',{},[['weekly','Every week'],['fortnightly','Every second week'],['monthly','Every month'],['daily','Every weekday']].map(x=>$('option',{value:x[0]},x[1])));
  const day=$('select',{});
  const fill=()=>{day.replaceChildren();day.style.display=freq.value==='daily'?'none':'';
    if(freq.value==='monthly'){for(let i=1;i<=28;i++)day.append($('option',{value:String(i)},'on the '+ord(i)));day.append($('option',{value:'0'},'on the last day'))}
    else{[1,2,3,4,5,6,0].forEach(i=>day.append($('option',{value:String(i)},'on '+WD[i])))}};
  freq.addEventListener('change',fill);fill();
  const dueIn=$('select',{},[['0','Due the same day'],['1','Due the next day'],['2','Due in 2 days'],['3','Due in 3 days'],['7','Due in a week']].map(x=>$('option',{value:x[0]},x[1])));
  const notes=$('input',{type:'text',placeholder:'Notes (optional)',maxlength:'1000',class:'notesin'});
  const save=()=>postRecurring({action:'add',text:text.value,owner:owner.value,freq:freq.value,day:day.value,dueDays:dueIn.value,notes:notes.value});
  const form=$('div',{class:'card wide t-meet'},$('h2',{},'Add a repeating task'),
    $('div',{class:'add'},text,owner,freq,day,dueIn,notes,$('button',{onclick:save},'Add')),
    $('div',{class:'note'},'A new task appears on the to-do list each time it falls due (checked every ten minutes from 5am). If the last one has not been ticked off yet, a second one is not added, so the old one just stays overdue until it is done.'));
  const recs=D.recurring||[];
  const one=r=>$('div',{class:'row'},
    $('span',{},$('div',{},r.text),$('div',{class:'mute'},freqText(r)+' · '+r.owner+(r.dueDays?' · due '+r.dueDays+(r.dueDays===1?' day':' days')+' later':'')+(r.paused?' · paused':'')+(r.lastCreated?' · last added '+fmtDay(r.lastCreated):' · not added yet'))),
    $('span',{style:'display:flex;gap:6px;align-items:flex-start'},$('button',{class:'ghost',onclick:()=>postRecurring({action:'pause',id:r.id})},r.paused?'Resume':'Pause'),$('button',{class:'ghost',onclick:()=>{if(confirm('Remove this repeating task? Tasks already on the list stay.'))postRecurring({action:'delete',id:r.id})}},'Remove')));
  return [form,$('div',{class:'card wide t-meet'},$('h2',{},'Repeating tasks ('+recs.length+')'),recs.length?recs.map(one):$('div',{class:'mute'},'None yet.')),checklistManage()];
}

let CL_FILTER='Everyone';
async function postCheck(b){
  const r=await fetch('/api/checklist',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({who:getWho()},b))});
  if(r.ok){const j=await r.json();D.checklist=j.checklist;D.checks=j.checks;render();return true}
  let m='Something went wrong';try{m=(await r.json()).error||m}catch(e){}alert(m);return false}
const dayOf=ds=>new Date(ds+'T00:00:00Z').getUTCDay();
const itemsFor=(dw,f)=>(D.checklist||[]).filter(i=>i.days&&i.days[dw]!=null&&(!f||f==='Everyone'||i.owner===f)).sort((a,b)=>a.days[dw]-b.days[dw]);
const MON_FOCUS={Anna:"weekend leads, Friday to Sunday no-shows, first visits, overdue payments and outstanding member enquiries.",Tyson:"the Monday schedule, voicemail from the weekend, bathroom supplies, Sippy Social coffee, promotional cards and three Instagram Stories.",Nichola:"CPL and marketing performance, Meta comments and messages, and current class or introductory offers in Facebook groups."};
function mondayFocus(){return $('div',{class:'note',style:'margin:8px 0'},$('b',{},'Monday focus. '),...Object.keys(MON_FOCUS).filter(n=>CL_FILTER==='Everyone'||CL_FILTER===n).map(n=>$('span',{},n+': '+MON_FOCUS[n]+' ')))}
function checklistCard(){
  const today=todayAEST(),dw=dayOf(today),ticks=(D.checks&&D.checks[today])||{};
  const sel=$('select',{},['Everyone','Anna','Nichola','Tyson'].map(x=>$('option',{value:x},x==='Everyone'?'Everyone':x+' only')));sel.value=CL_FILTER;
  sel.addEventListener('change',()=>{CL_FILTER=sel.value;render()});
  const items=itemsFor(dw,CL_FILTER);
  const head=$('div',{style:'display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap'},$('h2',{},'Daily checklist: '+WD[dw]),sel);
  if(dw===0||!items.length)return $('div',{class:'card wide t-tasks'},head,$('div',{class:'mute'},dw===0?'No checklist on Sundays.':'Nothing on the checklist for this view today.'));
  const done=items.filter(i=>ticks[i.id]).length,p=Math.round(done/items.length*100);
  return $('div',{class:'card wide t-tasks'},head,
    $('div',{class:'row'},$('span',{},done+' of '+items.length+' done'),$('span',{class:'chip '+(done===items.length?'g':(p>=50?'a':'r'))},done===items.length?'all done':(p>=50?'in progress':'not started'))),
    $('div',{class:'meter'},$('div',{style:'width:'+p+'%;background:'+(done===items.length?'var(--ok)':'var(--warn)')})),
    dw===1?mondayFocus():null,
    $('div',{style:'margin-top:6px'}),
    items.map(i=>{const k=ticks[i.id];
      return $('div',{class:'ck'+(k?' done':'')},$('input',{type:'checkbox',...(k?{checked:''}:{}),onchange:()=>postCheck({action:'tick',id:i.id})}),
        $('div',{class:'body'},$('div',{class:'t'},i.text),i.note?$('div',{class:'nt'},i.note):null),
        $('div',{class:'meta'},k?$('span',{class:'mute',style:'font-size:12px'},(k.by?k.by+', ':'')+fmtT(k.at)):null,ownerPill(i.owner)))}),
    $('div',{class:'note'},'Ticks reset every morning. Anything left unticked stays visible in the To-do history.'));
}
function checklistHistory(){
  const rows=[];const t0=Date.now()+10*3600e3;
  for(let n=0;n<14;n++){const ds=new Date(t0-n*864e5).toISOString().slice(0,10),dw=dayOf(ds);if(dw===0)continue;
    const its=itemsFor(dw),tk=(D.checks&&D.checks[ds])||{};if(!its.length)continue;
    const miss=its.filter(i=>!tk[i.id]);
    if(n===0&&!Object.keys(tk).length)continue;
    rows.push($('div',{class:'hrow'},$('div',{class:'when'},fmtDay(ds)),$('div',{class:'what'},$('div',{},(its.length-miss.length)+' of '+its.length+' done'),miss.length&&n>0?$('div',{class:'note'},'Not ticked: '+miss.map(i=>i.text).join('; ')):null)))}
  return $('div',{class:'card wide t-tasks'},$('h2',{},'Daily checklist history (last 14 days)'),rows.length?rows:$('div',{class:'mute'},'Nothing recorded yet.'));
}
function checklistManage(){
  const text=$('input',{type:'text',placeholder:'New job, for example: Check the lost property box',maxlength:'200'});
  const owner=$('select',{},['Anna','Nichola','Tyson','Anyone'].map(x=>$('option',{value:x},x)));
  const dayBoxes=[1,2,3,4,5,6].map(i=>{const c=$('input',{type:'checkbox',value:String(i)});return {i,c}});
  const note=$('input',{type:'text',placeholder:'Note (optional)',maxlength:'500',class:'notesin'});
  const add=()=>postCheck({action:'add',text:text.value,owner:owner.value,note:note.value,days:dayBoxes.filter(b=>b.c.checked).map(b=>b.i)});
  const all=(D.checklist||[]).slice().sort((a,b)=>a.text.localeCompare(b.text));
  const dn=i=>Object.keys(i.days).map(k=>WD[k].slice(0,3)).join(', ');
  return $('div',{class:'card wide t-tasks'},$('h2',{},'Daily checklist jobs ('+all.length+')'),
    $('div',{class:'add'},text,owner,note),$('div',{class:'chk'},dayBoxes.map(b=>$('label',{},b.c,WD[b.i]))),$('div',{class:'add'},$('button',{onclick:add},'Add to checklist')),
    $('details',{class:'mg'},$('summary',{},'Show or edit all jobs'),all.map(i=>$('div',{class:'row'},$('span',{},$('div',{},i.text),$('div',{class:'mute'},dn(i))),
      $('span',{style:'display:flex;gap:6px;align-items:flex-start'},ownerPill(i.owner),$('button',{class:'ghost',onclick:()=>{if(confirm('Remove this job from the checklist?'))postCheck({action:'delete',id:i.id})}},'Remove'))))));
}

function render(){
  const main=document.getElementById('main'),hist=location.hash==='#history',meet=location.hash==='#meetings',rec=location.hash==='#recurring';
  document.getElementById('navDash').classList.toggle('on',!hist&&!meet&&!rec);document.getElementById('navRec').classList.toggle('on',rec);document.getElementById('navHist').classList.toggle('on',hist);document.getElementById('navMeet').classList.toggle('on',meet);
  if(hist){main.replaceChildren(...historyView());return}
  if(meet){main.replaceChildren(...meetingsView());return}
  if(rec){main.replaceChildren(...recurringView());return}
  const d=D;
  main.replaceChildren(membersCard(d.summary),movementCard(d.summary),leadsCard(d.summary),stageCard(d.summary),hotLeadsCard(),lazeCard(),classesCard(d.classes),checklistCard(),
    blankPanel('Staff activity','Calls and emails are not available from the ClubReady API. They come from the Lead Management activity dashboard, which needs a signed-in browser. Planned for a later version.'),
    blankPanel('Marketing: cost per lead','Needs Meta ad spend for this studio. The ad account belongs to the franchisor, so spend will come from a scheduled Ads Manager report. Planned for a later version.'),
    blankPanel('Money','Xero is not connected to this page yet. Planned for a later version.'),
    todoCard(),linksCard());
}

async function load(){
  const r=await fetch('/api/data');if(r.status===401){location.reload();return}
  D=await r.json();D.todos=D.todos||[];D.todolog=D.todolog||[];D.links=D.links||[];D.meetings=D.meetings||[];D.recurring=D.recurring||[];D.checklist=D.checklist||[];D.checks=D.checks||{};const d=D;
  const st=document.getElementById('status');
  const bits=[];bits.push(d.meta&&d.meta.lastDoneAt?'Members and leads updated '+fmtT(d.meta.lastDoneAt):'Waiting for the first refresh');
  if(d.job&&d.job.phase&&d.job.phase!=='done'){const j=d.job;bits.push('refresh in progress ('+(j.phase==='users'?'reading the member list, page '+j.page:j.phase==='status'?'checking members, '+j.idx+' of '+j.total:'finishing')+')')}
  if(d.meta&&d.meta.runStart&&!d.meta.runEnd&&Date.now()-d.meta.runStart>120000)bits.push('last run was cut off at '+fmtT(d.meta.runStart)+' (probably a Cloudflare free plan limit)');
  if(d.meta&&d.meta.lastError)bits.push('last problem: '+d.meta.lastError.message);
  if(dueCount())bits.push(dueCount()+' hot lead follow-up'+(dueCount()>1?'s':'')+' due today or overdue');
  st.textContent=bits.join(' \\u00b7 ');
  render();
}
document.getElementById('navDash').addEventListener('click',()=>{location.hash='';render()});
document.getElementById('navHist').addEventListener('click',()=>{location.hash='history';render()});
document.getElementById('navMeet').addEventListener('click',()=>{location.hash='meetings';render()});
document.getElementById('navInstr').addEventListener('click',()=>{location.href='/instructors'});
document.getElementById('navRec').addEventListener('click',()=>{location.hash='recurring';render()});
window.addEventListener('hashchange',render);
document.getElementById('refresh').addEventListener('click',async e=>{e.target.disabled=true;e.target.textContent='Refreshing...';await fetch('/api/refresh',{method:'POST'});setTimeout(async()=>{await load();e.target.disabled=false;e.target.textContent='Refresh now'},4000)});
load();
</script></body></html>`;

// ---------- instructor dashboard ----------
// The Google Sheet is the master roster. The dashboard reads it (published or link-shared CSV),
// compares it with ClubReady's class schedule and lists every class that needs changing in ClubReady.
const INSTR_STALE_MS = 20 * 60 * 1000;
const CR_WINDOW_DAYS = 14;
const MONTH_NUM = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const cleanWho = (b) => (PEOPLE.includes(b.who) ? b.who : String(b.who || '').replace(/[^A-Za-z .'-]/g, '').trim().slice(0, 30));

function csvRows(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = ''; rows.push(row); row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function sheetDate(s, now) {
  const str = String(s || '').trim();
  if (!str) return null;
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); // Australian day/month/year
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return y + '-' + String(+m[2]).padStart(2, '0') + '-' + String(+m[1]).padStart(2, '0'); }
  m = str.match(/(\d{1,2})\s+([A-Za-z]{3,})\.?(?:\s+(\d{4}))?/);
  if (m) {
    const mon = MONTH_NUM[m[2].slice(0, 3).toLowerCase()];
    if (!mon) return null;
    const today = aestDate(now);
    let y = m[3] ? +m[3] : +today.slice(0, 4);
    let iso = y + '-' + String(mon).padStart(2, '0') + '-' + String(+m[1]).padStart(2, '0');
    if (!m[3] && iso < addDays(today, -180)) { y += 1; iso = y + '-' + String(mon).padStart(2, '0') + '-' + String(+m[1]).padStart(2, '0'); }
    return iso;
  }
  return null;
}

function timeMins(s) {
  const m = /(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([AaPp])?/.exec(String(s || ''));
  if (!m) return null;
  let h = +m[1]; const ap = (m[3] || '').toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return h * 60 + +m[2];
}
// A start cell may be "6:00 AM" or a range like "6:30 – 7:30 AM". Borrow am/pm from the end of a range if needed.
function startMins(cell, endCell) {
  const c = String(cell || '');
  const times = c.match(/\d{1,2}[:.]\d{2}\s*[AaPp]?/g) || [];
  if (!times.length) return null;
  let first = times[0];
  if (!/[AaPp]/.test(first)) {
    const tail = (times[1] || '') + ' ' + c + ' ' + String(endCell || '');
    const ap = /([AaPp])[Mm]/.exec(tail);
    if (ap) {
      const a = timeMins(first + ap[1]);
      const e = timeMins(times[1] ? times[1] + ap[1] : String(endCell || ''));
      return (e !== null && a > e) ? a - 720 : a;
    }
  }
  return timeMins(first);
}
const minsLabel = (t) => { const h = Math.floor(t / 60); return (h % 12 || 12) + ':' + String(t % 60).padStart(2, '0') + (h >= 12 ? 'pm' : 'am'); };
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function parseSheet(csv, now) {
  const rows = csvRows(csv);
  let hi = -1, cols = {};
  const find = (hdr, re, skip) => hdr.findIndex((h, i) => !skip.includes(i) && re.test(h));
  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const hdr = rows[r].map((h) => h.trim().toLowerCase());
    const used = [];
    const d = find(hdr, /^date|^day\b/, used); if (d < 0) continue; used.push(d);
    const ins = find(hdr, /instructor|teacher|coach/, used); if (ins < 0) continue; used.push(ins);
    const st = find(hdr, /^start|^time/, used); if (st < 0) continue; used.push(st);
    const sty = find(hdr, /style|class|type|format/, used); if (sty >= 0) used.push(sty);
    const en = find(hdr, /^end/, used); if (en >= 0) used.push(en);
    const cv = find(hdr, /cover/, used); if (cv >= 0) used.push(cv);
    const nt = find(hdr, /note/, used);
    hi = r; cols = { date: d, ins, start: st, style: sty, end: en, cover: cv, notes: nt }; break;
  }
  if (hi < 0) return { error: 'Could not find a header row. The sheet needs columns called Date, Start, Class style and Instructor.' };
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const date = sheetDate(r[cols.date], now);
    const sm = startMins(r[cols.start], cols.end >= 0 ? r[cols.end] : '');
    if (!date || sm === null) continue;
    const g = (i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
    const cover = /^(y|yes|x|true|cover|1)/i.test(g(cols.cover));
    const em = cols.end >= 0 ? timeMins(g(cols.end)) : null;
    out.push({ date, start: sm, label: minsLabel(sm), endLabel: em !== null ? minsLabel(em) : '', style: g(cols.style).slice(0, 60), instructor: g(cols.ins).slice(0, 40), cover, notes: g(cols.notes).slice(0, 200) });
  }
  out.sort((a, b) => (a.date + String(a.start).padStart(4, '0')).localeCompare(b.date + String(b.start).padStart(4, '0')));
  return { rows: out.slice(0, 600), noStyle: cols.style < 0 };
}

function normaliseSheetUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (e) { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') return null;
  const p = u.pathname;
  if (/\/spreadsheets\/d\/e\//.test(p)) {
    if (!u.searchParams.get('output')) u.searchParams.set('output', 'csv');
    return u.toString();
  }
  const m = p.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const gid = u.searchParams.get('gid') || (u.hash.match(/gid=(\d+)/) || [])[1] || '0';
  return 'https://docs.google.com/spreadsheets/d/' + m[1] + '/export?format=csv&gid=' + gid;
}

async function instrSync(env, force) {
  const now = Date.now();
  const ro = await loadRoster(env);
  const rows = ro.rows.map(rosterOut);
  let c = await getJSON(env, 'icr');
  if (force || !c || now - c.at > INSTR_STALE_MS) {
    c = { at: now, cr: [], crError: null, crRange: null };
    try {
      const from = aestDate(now), to = aestDate(now + (CR_WINDOW_DAYS - 1) * DAY);
      const list = await cr(env, '/scheduling/class-schedule', { StoreID: STORE_ID, FromDate: from, ToDate: to });
      c.crRange = [from, to];
      c.cr = (Array.isArray(list) ? list : []).map((x) => {
        const d = parseDate(x.Date);
        return { date: d !== null ? aestDateFromUtcDay(d) : null, start: timeMins(x.StartTime), title: String(x.Title || '').slice(0, 60), who: [x.InstructorFirstName, x.InstructorLastName].filter(Boolean).join(' ').slice(0, 40), first: String(x.InstructorFirstName || '').slice(0, 30) };
      }).filter((x) => x.date && x.start !== null);
    } catch (e) { c.crError = String(e.message || e).slice(0, 180); }
    await putJSON(env, 'icr', c);
  }
  return { at: c.at, state: 'ok', rows, cr: c.cr, crRange: c.crRange, crError: c.crError, sheetError: null, noStyle: !rows.some((r) => r.style), log: (ro.log || []).slice(0, 80) };
}

function instrCompare(sync, ticks) {
  const crBy = new Map();
  for (const c of sync.cr || []) { const k = c.date + '|' + c.start; (crBy.get(k) || crBy.set(k, []).get(k)).push(c); }
  const haveCR = !sync.crError && sync.crRange;
  const rows = [], changes = [];
  for (const s of sync.rows || []) {
    const row = Object.assign({}, s);
    const inWindow = haveCR && s.date >= sync.crRange[0] && s.date <= sync.crRange[1];
    if (s.closed) row.status = 'closed';
    else if (s.cover || !s.instructor) row.status = 'cover';
    else if (!inWindow) row.status = 'later';
    else {
      const list = crBy.get(s.date + '|' + s.start) || [];
      const ns = normName(s.style);
      const hit = list.find((c) => !ns || normName(c.title).includes(ns) || ns.includes(normName(c.title))) || list[0];
      if (!hit) row.status = 'missing';
      else {
        const insOK = normName(s.instructor.split(/\s+/)[0]) === normName(hit.first || hit.who.split(' ')[0]);
        const styOK = !ns || normName(hit.title).includes(ns) || ns.includes(normName(hit.title));
        row.crNow = { title: hit.title, who: hit.who };
        row.status = insOK && styOK ? 'ok' : (!insOK && !styOK ? 'both' : (!insOK ? 'instructor' : 'style'));
      }
    }
    if (['missing', 'both', 'instructor', 'style'].includes(row.status)) {
      const key = s.date + '|' + s.label;
      const sig = s.style + '|' + s.instructor;
      const t = ticks[key];
      row.change = { key, sig, done: !!(t && t.sig === sig), doneBy: t && t.sig === sig ? t.by : '', doneAt: t && t.sig === sig ? t.at : 0 };
      changes.push({ key, sig, date: s.date, label: s.label, want: { style: s.style, instructor: s.instructor }, now: row.crNow || null, status: row.status, done: row.change.done, doneBy: row.change.doneBy, doneAt: row.change.doneAt });
    }
    rows.push(row);
  }
  return { rows, changes };
}

async function instrData(env, force) {
  const sync = await instrSync(env, force);
  const ticks = (await getJSON(env, 'ichanges')) || {};
  const cmp = sync.state === 'nosheet' ? { rows: [], changes: [] } : instrCompare(sync, ticks);
  const keys = Object.values(ICONTENT).map((k) => k.key).concat(['i_emeet']);
  const vals = await Promise.all(keys.map((k) => getJSON(env, k)));
  const content = {}; keys.forEach((k, i) => { content[k] = Array.isArray(vals[i]) ? vals[i] : []; });
  content.i_etasks = await loadEduTasks(env);
  const todos = ((await getJSON(env, 'todos')) || []).filter((t) => t.shared);
  const names = [...new Set((sync.rows || []).flatMap((r) => [r.instructor, r.was].concat((r.offers || []).map((o) => o.name))).map((n) => String(n || '').split(/\s+/)[0]).filter((n) => n && n !== 'Anna'))].sort();
  return { rosterLog: sync.log || [], state: sync.state || 'ok', at: sync.at, sheetUrlSet: sync.state !== 'nosheet', sheetError: sync.sheetError || null, crError: sync.crError || null, noStyle: !!sync.noStyle, crRange: sync.crRange || null, rows: cmp.rows, changes: cmp.changes, todos, content, names };
}

// Content kinds: [maxLength, required, type]
const ICONTENT = {
  edu: { key: 'i_edu', fields: { title: [120, 1], note: [600], status: [20], when: [40] } },
  plans: { key: 'i_plans', fields: { title: [120, 1], style: [60], level: [40], mins: [10], plan: [3000], link: [400, 0, 'url'] } },
  resources: { key: 'i_res', fields: { label: [100, 1], url: [400, 1, 'url'], note: [200], cat: [40] } },
  events: { key: 'i_events', fields: { title: [120, 1], date: [10, 1, 'date'], time: [40], details: [800] } },
  unavail: { key: 'i_unavail', fields: { name: [40, 1], from: [10, 1, 'date'], to: [10, 0, 'date'], when: [40], note: [200] } },
  cnotes: { key: 'i_cnotes', fields: { client: [80, 1], note: [800, 1], follow: [10, 0, 'date'] } },
  journey: { key: 'i_journey', fields: { name: [80, 1], source: [40], next: [10, 0, 'date'], note: [600] } },
};
const JOURNEY_STAGES = ['Lead', 'Intro booked', 'Intro attended', 'Offer made', 'Joined', 'Lost'];
const EDU_STATUS = ['Planned', 'Next up', 'Done'];

function cleanField(spec, v) {
  let s = String(v == null ? '' : v).trim().slice(0, spec[0]);
  if (spec[2] === 'date' && s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) s = '';
  if (spec[2] === 'url' && s) {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    try { const u = new URL(s); s = (u.protocol === 'https:' || u.protocol === 'http:') ? u.toString() : ''; } catch (e) { s = ''; }
  }
  return s;
}

// ---------- education tasks: Teacher Training and education jobs for Nichola and Simone ----------
// Shown at the top of the instructors' Education tab. Anyone who picks their name can tick steps,
// change the status and add notes. Stored in KV under i_etasks; the two seed tasks appear until the first change.
const ET_STATUS = ['To do', 'In progress', 'Waiting', 'Done'];
const ET_OWNERS = ['Nichola', 'Simone', 'Nichola and Simone', 'Anna', 'Tyson', 'Anyone'];
const EDU_TASKS_SEED = [
  { id: 'et01', title: 'Confirm the Teacher Training scholarship details', owner: 'Nichola and Simone', due: '2026-11-16', status: 'In progress', created: Date.UTC(2026, 10, 11, 22, 45), by: 'Claude',
    summary: 'Two scholarships at 50% off the course cost are announced, but nothing else is confirmed, so every post and the ad can only say "ask us how to be considered". Settle these and the ad can go live.',
    steps: [
      'Which pathways the 50% applies to: Mat + Anatomy ($1,500), Reformer + Special Populations ($3,000), Combined ($4,500), or all three',
      'Who can apply (anyone, members only, people with a movement background?)',
      'How people apply (short form, a written answer, a chat with Simone?)',
      'How the two are chosen, and who decides',
      'Closing date for applications (needs to sit before the Mat course on 15 January)',
      'Confirm the Reformer dates: 17, 29, 30, 31 January only, or also 1 February',
      'Confirm whether the 6 December and 6 January taster sessions are free',
    ].map((text) => ({ text, done: false })),
    sections: [{ title: 'A starting point to react to (draft, not decided)', text: 'Open to anyone 18+ who wants to teach Pilates, members or not; no prior qualification needed.\nApply with a short online form: why you want to teach and which pathway you would choose.\nShortlisted applicants have a 15-minute chat with Simone at the studio or by phone.\nNichola and Simone choose the two; everyone hears back by Friday 18 December.\nApplications close Sunday 13 December, a week after the first taster session, so people can come along first.\n50% off whichever pathway the successful applicant chooses.\n\nChange anything that does not suit, then tick the steps above.' }],
    notes: [] },
  { id: 'et02', title: 'Run the Teacher Training scholarship ad', owner: 'Nichola', due: '2026-11-18', status: 'Waiting', after: 'Confirm the scholarship details', created: Date.UTC(2026, 10, 11, 22, 45), by: 'Claude',
    summary: 'Feed and story creative is drafted. It needs the scholarship terms, a decision on where people land, and a budget before it is built in Ads Manager.',
    steps: [
      'Scholarship details confirmed (task above)',
      'Decide where the ad sends people: a lead form, or booking a discovery chat with Simone',
      'Agree a budget: suggested A$15 a day from launch to Sunday 13 December (about A$390 if it starts on 18 November), inside the A$2,000 month with the $99 offer running',
      'Approve the creative and copy',
      'Build it in Ads Manager under the Employment special ad category, then switch it on',
      'Simone ready to follow up enquiries within a day',
    ].map((text) => ({ text, done: false })),
    sections: [
      { title: 'Draft creative', text: 'Feed (4:5) and story (9:16), studio photos with a blue panel. Words on the image: "Teacher Training scholarships. Two places at 50% off. Learn to teach Pilates in Sippy Downs. Starts January 2027."' },
      { title: 'Draft ad copy', text: 'Primary text:\nTwo Teacher Training scholarships at Club Pilates Sippy Downs: 50% off your course cost.\n\nIf you have ever thought about teaching Pilates, our January 2027 training is a good place to start. Learn with Simone, our Master Trainer, through online study and in-person training days in a working studio.\n\nThree pathways: Mat + Anatomy, Reformer + Special Populations, or both.\n\nAsk us how to be considered.\n\nHeadline: Two scholarships, 50% off\nDescription: Pilates Teacher Training, starts January 2027\nButton: Learn more' },
      { title: 'Before it goes live', text: 'Meta treats certification courses as Employment ads: no age or gender targeting and a minimum 15km radius. No job or income promises.\nOnly confirmed wording: never "first two", no deadline until one is agreed, and do not call the taster sessions free until confirmed.' },
    ],
    notes: [] },
];
async function loadEduTasks(env) {
  const list = await getJSON(env, 'i_etasks');
  return Array.isArray(list) ? list : JSON.parse(JSON.stringify(EDU_TASKS_SEED));
}
async function handleEduTasks(body, env, now, who) {
  let list = await loadEduTasks(env);
  const ymd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : '');
  if (body.action === 'add') {
    const title = String(body.title || '').trim().slice(0, 160);
    if (!title) return Response.json({ error: 'Add a task first' }, { status: 400 });
    const steps = String(body.steps || '').split('\n').map((x) => x.trim().slice(0, 300)).filter(Boolean).slice(0, 15).map((text) => ({ text, done: false }));
    list.unshift({ id: crypto.randomUUID(), title, owner: ET_OWNERS.includes(body.owner) ? body.owner : 'Anyone', due: ymd(body.due), status: 'To do', summary: '', steps, sections: [], notes: [], created: now, by: who });
    list = list.slice(0, 100);
  } else if (body.action === 'delete') {
    list = list.filter((t) => t.id !== body.id);
  } else if (['status', 'step', 'note'].includes(body.action)) {
    const t = list.find((x) => x.id === body.id);
    if (!t) return Response.json({ error: 'Task not found' }, { status: 404 });
    if (body.action === 'status') {
      if (!ET_STATUS.includes(body.status)) return Response.json({ error: 'Unknown status' }, { status: 400 });
      t.status = body.status;
    } else if (body.action === 'step') {
      const i = parseInt(body.step, 10), st = Array.isArray(t.steps) ? t.steps[i] : null;
      if (!st) return Response.json({ error: 'Step not found' }, { status: 400 });
      st.done = !st.done; st.by = who; st.at = now;
    } else {
      const text = String(body.text || '').trim().slice(0, 600);
      if (!text) return Response.json({ error: 'Write a note first' }, { status: 400 });
      t.notes = (Array.isArray(t.notes) ? t.notes : []).concat({ text, by: who, at: now }).slice(-50);
    }
    t.updated = now; t.updatedBy = who;
  } else return Response.json({ error: 'Unknown action' }, { status: 400 });
  await putJSON(env, 'i_etasks', list);
  return Response.json({ key: 'i_etasks', list });
}

async function handleInstrContent(request, env) {
  const body = await request.json().catch(() => ({}));
  const now = Date.now(), who = cleanWho(body);
  if (body.kind === 'emeet') return handleEduMeeting(body, env, now, who);
  if (body.kind === 'etask') return handleEduTasks(body, env, now, who);
  const kind = ICONTENT[body.kind];
  if (!kind) return Response.json({ error: 'Unknown section' }, { status: 400 });
  let list = (await getJSON(env, kind.key)) || [];
  if (body.action === 'add') {
    const item = { id: crypto.randomUUID(), created: now, by: who };
    for (const [f, spec] of Object.entries(kind.fields)) {
      item[f] = cleanField(spec, body[f]);
      if (spec[1] && !item[f]) return Response.json({ error: 'Please fill in the ' + (f === 'url' ? 'web address' : f) }, { status: 400 });
    }
    if (body.kind === 'unavail' && item.to && item.to < item.from) return Response.json({ error: 'The last day cannot be before the first day' }, { status: 400 });
    if (body.kind === 'edu') item.status = EDU_STATUS.includes(body.status) ? body.status : 'Planned';
    if (body.kind === 'journey') { item.stage = 'Lead'; item.hist = [{ stage: 'Lead', at: now, by: who }]; }
    if (body.kind === 'cnotes' && body.hot === true) {
      if (!item.follow) return Response.json({ error: 'A hot lead needs a follow-up date' }, { status: 400 });
      item.hot = true;
      // Shows up in the manager dashboard's Hot leads box, owned by Anna.
      let todos = (await getJSON(env, 'todos')) || [];
      let log = (await getJSON(env, 'todolog')) || [];
      const t = { id: crypto.randomUUID(), text: item.client + ' #hotlead', owner: 'Anna', due: item.follow, notes: ('From instructor note' + (who ? ' (' + who + ')' : '') + ': ' + item.note).slice(0, 1000), done: false, created: now, createdBy: who, doneAt: null, doneBy: '' };
      todos.unshift(t); trimTodos(todos);
      log.unshift({ at: now, who, action: 'added', id: t.id, text: t.text.slice(0, 120), detail: 'Hot lead from instructor client note' });
      item.todoId = t.id;
      await putJSON(env, 'todos', todos); await putJSON(env, 'todolog', log.slice(0, 1000));
    }
    list.unshift(item);
    list = list.slice(0, 300);
  } else if (body.action === 'delete') {
    list = list.filter((x) => x.id !== body.id);
  } else if (body.action === 'stage' && body.kind === 'journey') {
    const it = list.find((x) => x.id === body.id);
    if (!it) return Response.json({ error: 'Lead not found' }, { status: 404 });
    if (!JOURNEY_STAGES.includes(body.stage)) return Response.json({ error: 'Unknown stage' }, { status: 400 });
    it.stage = body.stage;
    it.hist = (Array.isArray(it.hist) ? it.hist : []).concat({ stage: body.stage, at: now, by: who }).slice(-20);
    if (body.stage === 'Lost') it.reason = String(body.reason || '').trim().slice(0, 200);
    if (typeof body.next === 'string') it.next = cleanField([10, 0, 'date'], body.next);
  } else if (body.action === 'status' && body.kind === 'edu') {
    const it = list.find((x) => x.id === body.id);
    if (it && EDU_STATUS.includes(body.status)) it.status = body.status;
  } else return Response.json({ error: 'Unknown action' }, { status: 400 });
  await putJSON(env, kind.key, list);
  return Response.json({ key: kind.key, list });
}

async function handleEduMeeting(body, env, now, who) {
  let list = (await getJSON(env, 'i_emeet')) || [];
  if (body.action === 'delete') {
    list = list.filter((m) => m.id !== body.id);
    await putJSON(env, 'i_emeet', list);
    return Response.json({ key: 'i_emeet', list });
  }
  if (body.action !== 'add') return Response.json({ error: 'Unknown action' }, { status: 400 });
  const title = String(body.title || '').trim().slice(0, 120) || 'Education meeting';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : aestDate(now);
  const summary = String(body.summary || '').trim().slice(0, 3000);
  if (!summary) return Response.json({ error: 'Add a short summary first' }, { status: 400 });
  const id = crypto.randomUUID();
  let todos = (await getJSON(env, 'todos')) || [];
  let log = (await getJSON(env, 'todolog')) || [];
  const actions = [];
  for (const a of (Array.isArray(body.actions) ? body.actions : []).slice(0, 10)) {
    const text = String((a && a.text) || '').trim().slice(0, 300);
    if (!text) continue;
    const t = { id: crypto.randomUUID(), text, owner: OWNERS.includes(a.owner) ? a.owner : 'Anyone', due: /^\d{4}-\d{2}-\d{2}$/.test(a.due || '') ? a.due : '', notes: 'From education meeting: ' + title + ' (' + date + ')', done: false, created: now, createdBy: who, doneAt: null, doneBy: '', shared: true, meetingId: id };
    todos.unshift(t);
    log.unshift({ at: now, who, action: 'added', id: t.id, text: t.text.slice(0, 120), detail: 'From education meeting: ' + title });
    actions.push({ taskId: t.id, text, owner: t.owner, due: t.due });
  }
  trimTodos(todos);
  list.unshift({ id, date, title, summary, decisions: String(body.decisions || '').trim().slice(0, 2000), actions, created: now, by: who });
  list = list.slice(0, 100);
  await putJSON(env, 'todos', todos); await putJSON(env, 'todolog', log.slice(0, 1000)); await putJSON(env, 'i_emeet', list);
  return Response.json({ key: 'i_emeet', list, todos: todos.filter((t) => t.shared) });
}


// Read-only discovery: which ClubReady endpoints exist, and does the key work on them? Only GET requests, nothing is changed.
const PROBE_PATHS = ['/scheduling/class-schedule', '/scheduling/classes', '/scheduling/class', '/scheduling/class-types', '/scheduling/classtypes', '/scheduling/class-type',
  '/scheduling/instructors', '/scheduling/instructor', '/scheduling/class-instructor', '/scheduling/substitute-instructor', '/scheduling/substitute', '/scheduling/update-class',
  '/scheduling/class-update', '/scheduling/schedule', '/scheduling/class-roster', '/scheduling/roster', '/scheduling/bookings', '/scheduling/rooms', '/scheduling/resources',
  '/users/instructors', '/users/staff', '/users/employees', '/staff', '/store/instructors'];
async function handleProbe(env) {
  if (!env.CR_API_KEY) return Response.json({ error: 'CR_API_KEY is not set' }, { status: 400 });
  const from = aestDate(Date.now()), to = aestDate(Date.now() + 2 * DAY);
  const q = new URLSearchParams({ StoreID: STORE_ID, StoreId: STORE_ID, FromDate: from, ToDate: to, ApiKey: env.CR_API_KEY });
  const out = [];
  for (const path of PROBE_PATHS) {
    try {
      const r = await fetch(CR_BASE + path + '?' + q, { method: 'GET', headers: { Accept: 'application/json', 'X-Forwarded-For': '127.0.0.1' } });
      let note = '';
      try { note = (await r.text()).replace(env.CR_API_KEY, '').replace(/\s+/g, ' ').slice(0, 90); } catch (e) { /* ignore */ }
      out.push({ path, status: r.status, allow: r.headers.get('allow') || '', note });
    } catch (e) { out.push({ path, status: 0, allow: '', note: 'no answer' }); }
  }
  return Response.json({ at: Date.now(), results: out });
}

async function handleInstrApi(request, env, url) {
  const p = url.pathname;
  if (p === '/api/instructors/data') return Response.json(await instrData(env, url.searchParams.get('sync') === '1'));
  if (request.method !== 'POST') return Response.json({ error: 'Not found' }, { status: 404 });
  if (p === '/api/instructors/content') return handleInstrContent(request, env);
  if (p === '/api/instructors/probe') return handleProbe(env);
  const body = await request.json().catch(() => ({}));
  if (p === '/api/instructors/roster') return handleRoster(body, env);
  if (p === '/api/instructors/sheet') {
    if (!body.url || !String(body.url).trim()) { await putJSON(env, 'isheet', {}); await env.STUDIO.delete('isync'); return Response.json(await instrData(env, false)); }
    const u = normaliseSheetUrl(body.url);
    if (!u) return Response.json({ error: 'Paste the Google Sheet link (it starts with https://docs.google.com/spreadsheets).' }, { status: 400 });
    await putJSON(env, 'isheet', { url: u, set: Date.now() });
    return Response.json(await instrData(env, true));
  }
  if (p === '/api/instructors/change') {
    const ticks = (await getJSON(env, 'ichanges')) || {};
    const key = String(body.key || '').slice(0, 60), sig = String(body.sig || '').slice(0, 140);
    if (!key) return Response.json({ error: 'Missing class' }, { status: 400 });
    if (body.done === false) delete ticks[key]; else ticks[key] = { sig, by: cleanWho(body), at: Date.now() };
    const keys = Object.keys(ticks).sort();
    while (keys.length > 400) delete ticks[keys.shift()];
    await putJSON(env, 'ichanges', ticks);
    return Response.json(await instrData(env, false));
  }
  return Response.json({ error: 'Not found' }, { status: 404 });
}

// ---------- roster: the schedule now lives here, not in a Google Sheet ----------
// Nichola, Tyson and Anna can change it. Instructors can offer to take a cover, ask for
// cover on their own class and add unavailability. Every change to a class from today
// onwards becomes a "ClubReady:" task for Anna on the manager dashboard.
const ROSTER_MANAGERS = ['Nichola', 'Tyson', 'Anna', 'Simone'];
const ROSTER_SEED = [{"date":"2026-11-01","start":450,"end":510,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-01","start":510,"end":570,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-01","start":570,"end":630,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-02","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-02","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-02","start":420,"end":480,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-02","start":510,"end":570,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-02","start":570,"end":630,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-02","start":630,"end":690,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-02","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-02","start":990,"end":1050,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-02","start":1050,"end":1110,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-03","start":360,"end":420,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-03","start":420,"end":480,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-03","start":510,"end":570,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-03","start":570,"end":630,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-03","start":630,"end":690,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-03","start":690,"end":720,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-03","start":750,"end":810,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-03","start":990,"end":1050,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-03","start":1050,"end":1110,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-03","start":1110,"end":1170,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-04","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-04","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-04","start":420,"end":480,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-04","start":510,"end":570,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-04","start":570,"end":630,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-04","start":630,"end":690,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-04","start":990,"end":1050,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-04","start":1050,"end":1110,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-05","start":360,"end":420,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-05","start":420,"end":480,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-05","start":510,"end":570,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-05","start":570,"end":630,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-05","start":630,"end":690,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-05","start":930,"end":990,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-05","start":990,"end":1050,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-05","start":1050,"end":1110,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-06","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-06","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-06","start":420,"end":480,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-06","start":510,"end":570,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-06","start":570,"end":630,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-06","start":630,"end":690,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-06","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-06","start":930,"end":990,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-06","start":990,"end":1050,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-07","start":390,"end":450,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-07","start":450,"end":510,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-07","start":510,"end":570,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-07","start":570,"end":630,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-07","start":630,"end":690,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-08","start":450,"end":510,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-08","start":510,"end":570,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-08","start":570,"end":630,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-08","start":630,"end":690,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-09","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-09","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-09","start":420,"end":480,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-09","start":510,"end":570,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-09","start":570,"end":630,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-09","start":630,"end":690,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-09","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-09","start":990,"end":1050,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-09","start":1050,"end":1110,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-10","start":360,"end":420,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-10","start":420,"end":480,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-10","start":510,"end":570,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-10","start":570,"end":630,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-10","start":630,"end":690,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-10","start":690,"end":720,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-10","start":750,"end":810,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-10","start":990,"end":1050,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-10","start":1050,"end":1110,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-10","start":1110,"end":1170,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-11","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-11","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-11","start":420,"end":480,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-11","start":510,"end":570,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-11","start":570,"end":630,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-11","start":630,"end":690,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-11","start":990,"end":1050,"instructor":"Emily","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-11","start":1050,"end":1110,"instructor":"Emily","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-12","start":360,"end":420,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-12","start":420,"end":480,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-12","start":510,"end":570,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-12","start":570,"end":630,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-12","start":630,"end":690,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-12","start":930,"end":990,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-12","start":990,"end":1050,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-12","start":1050,"end":1110,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-12","start":1110,"end":1170,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-13","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-13","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-13","start":420,"end":480,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-13","start":510,"end":570,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-13","start":570,"end":630,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-13","start":630,"end":690,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-13","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-13","start":750,"end":810,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-13","start":930,"end":990,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-13","start":990,"end":1050,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-14","start":390,"end":450,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-14","start":450,"end":510,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-14","start":510,"end":570,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-14","start":570,"end":630,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-14","start":630,"end":690,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-15","start":450,"end":510,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-15","start":510,"end":570,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-15","start":570,"end":630,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-15","start":630,"end":690,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-16","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-16","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-16","start":420,"end":480,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-16","start":510,"end":570,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-16","start":570,"end":630,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-16","start":630,"end":690,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-16","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-16","start":990,"end":1050,"instructor":"Cathy","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-16","start":1050,"end":1110,"instructor":"Cathy","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-17","start":360,"end":420,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-17","start":420,"end":480,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-17","start":510,"end":570,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-17","start":570,"end":630,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-17","start":630,"end":690,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-17","start":690,"end":720,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-17","start":750,"end":810,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-17","start":990,"end":1050,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-17","start":1050,"end":1110,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-17","start":1110,"end":1170,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-18","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-18","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-18","start":420,"end":480,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-18","start":510,"end":570,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-18","start":570,"end":630,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-18","start":630,"end":690,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-18","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-18","start":990,"end":1050,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-18","start":1050,"end":1110,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-19","start":360,"end":420,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-19","start":420,"end":480,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-19","start":510,"end":570,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-19","start":570,"end":630,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-19","start":630,"end":690,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-19","start":930,"end":990,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-19","start":990,"end":1050,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-19","start":1050,"end":1110,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-20","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-20","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-20","start":420,"end":480,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-20","start":510,"end":570,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-20","start":570,"end":630,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-20","start":630,"end":690,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-20","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-20","start":930,"end":990,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-20","start":990,"end":1050,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-21","start":390,"end":450,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-21","start":450,"end":510,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-21","start":510,"end":570,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-21","start":570,"end":630,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-21","start":630,"end":690,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-22","start":450,"end":510,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-22","start":510,"end":570,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-22","start":570,"end":630,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-22","start":630,"end":690,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-23","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-23","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-23","start":420,"end":480,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-23","start":510,"end":570,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-23","start":570,"end":630,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-23","start":630,"end":690,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-23","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-23","start":990,"end":1050,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-23","start":1050,"end":1110,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-24","start":360,"end":420,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-24","start":420,"end":480,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-24","start":510,"end":570,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-24","start":570,"end":630,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-24","start":630,"end":690,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-24","start":690,"end":720,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-24","start":750,"end":810,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-24","start":990,"end":1050,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-24","start":1050,"end":1110,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-24","start":1110,"end":1170,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-25","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-25","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-25","start":420,"end":480,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-25","start":510,"end":570,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-25","start":570,"end":630,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-25","start":630,"end":690,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-25","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-25","start":990,"end":1050,"instructor":"Emily","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-25","start":1050,"end":1110,"instructor":"Emily","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-26","start":360,"end":420,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-26","start":420,"end":480,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-26","start":510,"end":570,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-26","start":570,"end":630,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-26","start":630,"end":690,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-26","start":930,"end":990,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-26","start":990,"end":1050,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-26","start":1050,"end":1110,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-27","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-27","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-27","start":420,"end":480,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-27","start":510,"end":570,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-27","start":570,"end":630,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-27","start":630,"end":690,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-27","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-27","start":930,"end":990,"instructor":"","style":"","cover":false,"notes":"Studio closed","closed":true},{"date":"2026-11-27","start":990,"end":1050,"instructor":"","style":"","cover":false,"notes":"Studio closed","closed":true},{"date":"2026-11-28","start":390,"end":450,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-28","start":450,"end":510,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-28","start":510,"end":570,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-28","start":570,"end":630,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-28","start":630,"end":690,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-29","start":450,"end":510,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-29","start":510,"end":570,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-29","start":570,"end":630,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-29","start":630,"end":690,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-30","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-30","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-30","start":420,"end":480,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-30","start":510,"end":570,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-30","start":570,"end":630,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-30","start":630,"end":690,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-30","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-30","start":990,"end":1050,"instructor":"Cathy","style":"","cover":false,"notes":"","closed":false},{"date":"2026-11-30","start":1050,"end":1110,"instructor":"Cathy","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-01","start":360,"end":420,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-01","start":420,"end":480,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-01","start":510,"end":570,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-01","start":570,"end":630,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-01","start":630,"end":690,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-01","start":690,"end":720,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-01","start":750,"end":810,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-01","start":990,"end":1050,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-01","start":1050,"end":1110,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-01","start":1110,"end":1170,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-02","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-02","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-02","start":420,"end":480,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-02","start":510,"end":570,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-02","start":570,"end":630,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-02","start":630,"end":690,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-02","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-02","start":990,"end":1050,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-02","start":1050,"end":1110,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-03","start":360,"end":420,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-03","start":420,"end":480,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-03","start":510,"end":570,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-03","start":570,"end":630,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-03","start":630,"end":690,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-03","start":690,"end":720,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-03","start":930,"end":990,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-03","start":990,"end":1050,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-03","start":1050,"end":1110,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-03","start":1110,"end":1170,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-04","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-04","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-04","start":420,"end":480,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-04","start":510,"end":570,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-04","start":570,"end":630,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-04","start":630,"end":690,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-04","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-04","start":930,"end":990,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-04","start":990,"end":1050,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-05","start":390,"end":450,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-05","start":450,"end":510,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-05","start":510,"end":570,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-05","start":570,"end":630,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-05","start":630,"end":690,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-06","start":450,"end":510,"instructor":"","style":"","cover":true,"notes":"","closed":false},{"date":"2026-12-06","start":510,"end":570,"instructor":"","style":"","cover":true,"notes":"","closed":false},{"date":"2026-12-06","start":570,"end":630,"instructor":"","style":"","cover":true,"notes":"","closed":false},{"date":"2026-12-06","start":630,"end":690,"instructor":"","style":"","cover":true,"notes":"","closed":false},{"date":"2026-12-07","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-07","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-07","start":420,"end":480,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-07","start":510,"end":570,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-07","start":570,"end":630,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-07","start":630,"end":690,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-07","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-07","start":990,"end":1050,"instructor":"Cathy","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-07","start":1050,"end":1110,"instructor":"Cathy","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-08","start":360,"end":420,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-08","start":420,"end":480,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-08","start":510,"end":570,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-08","start":570,"end":630,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-08","start":630,"end":690,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-08","start":690,"end":720,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-08","start":750,"end":810,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-08","start":990,"end":1050,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-08","start":1050,"end":1110,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-08","start":1110,"end":1170,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-09","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-09","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-09","start":420,"end":480,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-09","start":510,"end":570,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-09","start":570,"end":630,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-09","start":630,"end":690,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-09","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-09","start":990,"end":1050,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-09","start":1050,"end":1110,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-10","start":360,"end":420,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-10","start":420,"end":480,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-10","start":510,"end":570,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-10","start":570,"end":630,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-10","start":630,"end":690,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-10","start":690,"end":720,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-10","start":930,"end":990,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-10","start":990,"end":1050,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-10","start":1050,"end":1110,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-10","start":1110,"end":1170,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-11","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-11","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-11","start":420,"end":480,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-11","start":510,"end":570,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-11","start":570,"end":630,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-11","start":630,"end":690,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-11","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-11","start":930,"end":990,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-11","start":990,"end":1050,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-12","start":390,"end":450,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-12","start":450,"end":510,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-12","start":510,"end":570,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-12","start":570,"end":630,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-12","start":630,"end":690,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-13","start":450,"end":510,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-13","start":510,"end":570,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-13","start":570,"end":630,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-13","start":630,"end":690,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-14","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-14","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-14","start":420,"end":480,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-14","start":510,"end":570,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-14","start":570,"end":630,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-14","start":630,"end":690,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-14","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-14","start":990,"end":1050,"instructor":"Cathy","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-14","start":1050,"end":1110,"instructor":"Cathy","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-15","start":360,"end":420,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-15","start":420,"end":480,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-15","start":510,"end":570,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-15","start":570,"end":630,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-15","start":630,"end":690,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-15","start":690,"end":720,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-15","start":750,"end":810,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-15","start":990,"end":1050,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-15","start":1050,"end":1110,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-15","start":1110,"end":1170,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-16","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-16","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-16","start":420,"end":480,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-16","start":510,"end":570,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-16","start":570,"end":630,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-16","start":630,"end":690,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-16","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-16","start":990,"end":1050,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-16","start":1050,"end":1110,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-17","start":360,"end":420,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-17","start":420,"end":480,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-17","start":510,"end":570,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-17","start":570,"end":630,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-17","start":630,"end":690,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-17","start":930,"end":990,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-17","start":990,"end":1050,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-17","start":1050,"end":1110,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-17","start":1110,"end":1170,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-18","start":300,"end":360,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-18","start":360,"end":420,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-18","start":420,"end":480,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-18","start":510,"end":570,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-18","start":570,"end":630,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-18","start":630,"end":690,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-18","start":690,"end":720,"instructor":"Tyson","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-18","start":930,"end":990,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-18","start":990,"end":1050,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-19","start":390,"end":450,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-19","start":450,"end":510,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-19","start":510,"end":570,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-19","start":570,"end":630,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-19","start":630,"end":690,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-20","start":450,"end":510,"instructor":"","style":"","cover":true,"notes":"","closed":false},{"date":"2026-12-20","start":510,"end":570,"instructor":"","style":"","cover":true,"notes":"","closed":false},{"date":"2026-12-20","start":570,"end":630,"instructor":"","style":"","cover":true,"notes":"","closed":false},{"date":"2026-12-21","start":360,"end":420,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-21","start":420,"end":480,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-21","start":510,"end":570,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-21","start":570,"end":630,"instructor":"Nichola","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-21","start":990,"end":1050,"instructor":"Cathy","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-21","start":1050,"end":1110,"instructor":"Cathy","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-22","start":360,"end":420,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-22","start":420,"end":480,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-22","start":510,"end":570,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-22","start":570,"end":630,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-22","start":630,"end":690,"instructor":"Marnie","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-22","start":990,"end":1050,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-22","start":1050,"end":1110,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-23","start":360,"end":420,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-23","start":420,"end":480,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-23","start":510,"end":570,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-23","start":570,"end":630,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-23","start":630,"end":690,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-23","start":990,"end":1050,"instructor":"Emily","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-23","start":1050,"end":1110,"instructor":"Emily","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-24","start":420,"end":480,"instructor":"Emily","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-24","start":510,"end":570,"instructor":"Emily","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-24","start":570,"end":630,"instructor":"Emily","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-26","start":450,"end":510,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-26","start":510,"end":570,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-26","start":570,"end":630,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-26","start":630,"end":690,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-27","start":450,"end":510,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-27","start":510,"end":570,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-27","start":570,"end":630,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-28","start":360,"end":420,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-28","start":420,"end":480,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-28","start":510,"end":570,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-28","start":570,"end":630,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-28","start":630,"end":690,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-28","start":990,"end":1050,"instructor":"Cathy","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-28","start":1050,"end":1110,"instructor":"Cathy","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-29","start":360,"end":420,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-29","start":420,"end":480,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-29","start":510,"end":570,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-29","start":570,"end":630,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-29","start":630,"end":690,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-29","start":990,"end":1050,"instructor":"","style":"","cover":true,"notes":"","closed":false},{"date":"2026-12-29","start":1050,"end":1110,"instructor":"","style":"","cover":true,"notes":"","closed":false},{"date":"2026-12-30","start":360,"end":420,"instructor":"","style":"","cover":true,"notes":"","closed":false},{"date":"2026-12-30","start":420,"end":480,"instructor":"","style":"","cover":true,"notes":"","closed":false},{"date":"2026-12-30","start":510,"end":570,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-30","start":570,"end":630,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-30","start":630,"end":690,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-30","start":990,"end":1050,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-30","start":1050,"end":1110,"instructor":"Courtney","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-31","start":390,"end":450,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-31","start":450,"end":510,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-31","start":510,"end":570,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2026-12-31","start":570,"end":630,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2027-01-02","start":390,"end":450,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2027-01-02","start":450,"end":510,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2027-01-02","start":510,"end":570,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2027-01-02","start":570,"end":630,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2027-01-02","start":630,"end":690,"instructor":"Georgia","style":"","cover":false,"notes":"","closed":false},{"date":"2027-01-03","start":450,"end":510,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2027-01-03","start":510,"end":570,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2027-01-03","start":570,"end":630,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false},{"date":"2027-01-03","start":630,"end":690,"instructor":"Simone","style":"","cover":false,"notes":"","closed":false}];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const rosterDay = (iso) => { const d = new Date(iso + 'T12:00:00Z'); return SHORT_DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + SHORT_MONTHS[d.getUTCMonth()]; };
const rosterName = (s) => String(s || '').replace(/[^A-Za-z .'-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
const firstName = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase();
const isManager = (who) => ROSTER_MANAGERS.includes(who);
const rosterWhen = (r) => rosterDay(r.date) + ' ' + minsLabel(r.start);

async function loadRoster(env) {
  let ro = await getJSON(env, 'iroster');
  if (!ro || !Array.isArray(ro.rows)) {
    ro = { v: 1, seeded: Date.now(), rows: ROSTER_SEED.map((x) => Object.assign({ id: x.date + '-' + x.start, offers: [], was: '' }, x)), log: [] };
    await putJSON(env, 'iroster', ro);
  }
  return ro;
}

function rosterOut(r) {
  return { id: r.id, date: r.date, start: r.start, label: minsLabel(r.start), end: r.end != null ? r.end : null, endLabel: r.end != null ? minsLabel(r.end) : '', style: r.style || '', instructor: r.closed ? '' : (r.instructor || ''), cover: !r.closed && (!!r.cover || !r.instructor), closed: !!r.closed, notes: r.notes || '', was: r.was || '', offers: r.offers || [] };
}

// Adds or updates one open task for Anna per class, so a class changed twice gives one task, not two.
async function rosterTask(env, row, what, who, now, owner) {
  if (row.date < aestDate(now)) return;
  owner = owner || 'Anna';
  const tag = owner === 'Anna' ? 'cr' : 'find';
  let todos = (await getJSON(env, 'todos')) || [];
  let log = (await getJSON(env, 'todolog')) || [];
  const text = (owner === 'Anna' ? 'ClubReady: ' : 'Find cover: ') + rosterWhen(row) + ' - ' + what;
  const notes = 'From the instructor roster' + (who ? ', changed by ' + who : '') + '.';
  let t = todos.find((x) => !x.done && x.rosterId === row.id && x.rosterTag === tag);
  if (t) { t.text = text.slice(0, 300); t.notes = notes; }
  else {
    t = { id: crypto.randomUUID(), text: text.slice(0, 300), owner, due: row.date, notes, done: false, created: now, createdBy: who, doneAt: null, doneBy: '', rosterId: row.id, rosterTag: tag };
    todos.unshift(t); trimTodos(todos);
  }
  log.unshift({ at: now, who, action: 'added', id: t.id, text: t.text.slice(0, 120), detail: 'From the instructor roster' });
  await putJSON(env, 'todos', todos); await putJSON(env, 'todolog', log.slice(0, 1000));
}

// Ticks off an open "Find cover" task once the class has an instructor again.
async function rosterCloseFind(env, row, who, now) {
  const todos = (await getJSON(env, 'todos')) || [];
  const t = todos.find((x) => !x.done && x.rosterId === row.id && x.rosterTag === 'find');
  if (!t) return;
  t.done = true; t.doneAt = now; t.doneBy = who || 'Roster';
  await putJSON(env, 'todos', todos);
}

function parseHHMM(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : null; }

async function handleRoster(body, env) {
  const now = Date.now(), who = cleanWho(body), today = aestDate(now);
  if (!who) return Response.json({ error: 'Choose your name first' }, { status: 400 });
  const ro = await loadRoster(env);
  const row = ro.rows.find((r) => r.id === String(body.id || ''));
  const act = String(body.action || '');
  const mgr = isManager(who);
  const done = async (summary) => {
    ro.log.unshift({ at: now, who, summary: summary.slice(0, 200) });
    ro.log = ro.log.slice(0, 300);
    ro.rows.sort((a, b) => (a.date + String(a.start).padStart(4, '0')).localeCompare(b.date + String(b.start).padStart(4, '0')));
    await putJSON(env, 'iroster', ro);
    return Response.json(await instrData(env, false));
  };

  if (act === 'add') {
    if (!mgr) return Response.json({ error: 'Only Nichola, Tyson, Anna or Simone can add classes' }, { status: 403 });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : '';
    const start = parseHHMM(body.start), end = parseHHMM(body.end);
    if (!date || start === null) return Response.json({ error: 'Add a date and a start time' }, { status: 400 });
    const id = date + '-' + start;
    if (ro.rows.some((r) => r.id === id)) return Response.json({ error: 'There is already a class at that time. Click it to change it.' }, { status: 400 });
    const r = { id, date, start, end: end !== null && end > start ? end : start + 60, instructor: rosterName(body.name), style: String(body.style || '').trim().slice(0, 60), cover: !rosterName(body.name), notes: String(body.notes || '').trim().slice(0, 200), closed: false, offers: [], was: '' };
    ro.rows.push(r);
    await rosterTask(env, r, 'add this class' + (r.style ? ' (' + r.style + ')' : '') + (r.instructor ? ' with ' + r.instructor : ', cover needed'), who, now);
    if (!r.instructor) await rosterTask(env, r, 'new class needs an instructor', who, now, 'Nichola');
    return done('Added ' + rosterWhen(r) + (r.instructor ? ' with ' + r.instructor : ' (cover needed)'));
  }

  if (!row) return Response.json({ error: 'That class is no longer on the roster. Refresh the page.' }, { status: 404 });
  if (row.date < today && !mgr) return Response.json({ error: 'That class has already happened' }, { status: 400 });

  if (act === 'offer') {
    if (row.closed || (row.instructor && !row.cover)) return Response.json({ error: 'That class already has an instructor' }, { status: 400 });
    row.offers = row.offers || [];
    const i = row.offers.findIndex((o) => firstName(o.name) === firstName(who));
    if (i >= 0) { row.offers.splice(i, 1); return done(who + ' withdrew their offer for ' + rosterWhen(row)); }
    row.offers.push({ name: who, at: now });
    return done(who + ' can cover ' + rosterWhen(row));
  }

  if (act === 'needcover') {
    if (!mgr && firstName(row.instructor) !== firstName(who)) return Response.json({ error: 'You can only ask for cover on your own classes' }, { status: 403 });
    if (!row.instructor || row.cover) return Response.json({ error: 'That class is already marked as needing cover' }, { status: 400 });
    row.was = row.instructor; row.instructor = ''; row.cover = true; row.offers = [];
    if (body.note) row.notes = String(body.note).trim().slice(0, 200);
    await rosterTask(env, row, 'cover needed (' + row.was + ' can\'t teach)', who, now, 'Nichola');
    return done(who + ' asked for cover on ' + rosterWhen(row) + ' (was ' + row.was + ')');
  }

  if (!mgr) return Response.json({ error: 'Only Nichola, Tyson, Anna or Simone can change the roster' }, { status: 403 });

  if (act === 'assign' || act === 'edit') {
    const before = { instructor: row.instructor || '', cover: !row.closed && (!!row.cover || !row.instructor), closed: !!row.closed, style: row.style || '' };
    const name = rosterName(body.name);
    if (act === 'assign') { if (!name) return Response.json({ error: 'Choose who is teaching' }, { status: 400 }); row.instructor = name; row.cover = false; row.closed = false; }
    else {
      row.closed = body.closed === true;
      if (row.closed) { row.instructor = ''; row.cover = false; }
      else if (body.cover === true) { if (before.instructor) row.was = before.instructor; row.instructor = ''; row.cover = true; }
      else { row.instructor = name; row.cover = !name; }
      if (typeof body.notes === 'string') row.notes = body.notes.trim().slice(0, 200);
      if (typeof body.style === 'string') row.style = body.style.trim().slice(0, 60);
      const e = parseHHMM(body.end); if (e !== null && e > row.start) row.end = e;
    }
    const after = { instructor: row.instructor, cover: row.cover, closed: row.closed, style: row.style || '' };
    if (!after.cover) row.offers = [];
    const parts = [];
    if (after.closed && !before.closed) parts.push('studio closed, cancel this class');
    else if (!after.closed && before.closed) parts.push('class back on' + (after.instructor ? ' with ' + after.instructor : ''));
    else if (after.instructor && (after.instructor !== before.instructor || before.cover)) parts.push('instructor now ' + after.instructor + (before.instructor ? ' (was ' + before.instructor + ')' : (row.was ? ' (covering ' + row.was + ')' : ' (was cover)')));
    if (!after.closed && after.style !== before.style) parts.push('class style now ' + (after.style || 'not set'));
    if (parts.length) await rosterTask(env, row, parts.join('; '), who, now);
    if (after.cover && !before.cover && !after.closed) await rosterTask(env, row, 'cover needed', who, now, 'Nichola');
    if (!after.cover) { row.was = after.closed ? row.was : ''; await rosterCloseFind(env, row, who, now); }
    return done(who + ' updated ' + rosterWhen(row) + ': ' + (after.closed ? 'closed' : (after.instructor || 'cover needed')));
  }

  if (act === 'remove') {
    ro.rows = ro.rows.filter((r) => r.id !== row.id);
    const todos = (await getJSON(env, 'todos')) || [];
    const pending = todos.find((x) => !x.done && x.rosterId === row.id && x.rosterTag === 'cr' && /add this class/.test(x.text));
    if (pending) { pending.done = true; pending.doneAt = now; pending.doneBy = who; pending.notes += ' Class removed again before it was added, so nothing to do.'; await putJSON(env, 'todos', todos); }
    else await rosterTask(env, row, 'remove this class' + (row.instructor ? ' (was ' + row.instructor + ')' : ''), who, now);
    await rosterCloseFind(env, row, who, now);
    return done(who + ' removed ' + rosterWhen(row));
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
}

const INSTRUCTOR_HTML = String.raw`<!doctype html><html lang="en-AU"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Instructor dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#f6f1e9;--card:#fffdf9;--line:#e3d9c8;--ink:#3b2a20;--mute:#7a6a5c;--accent:#8a6a43;--ok:#4d7a4d;--warn:#b0701f;--bad:#a33a2e;--c1:#6f8f6a;--c2:#b5703f;--c3:#5f7f95;--c4:#8a7396}
@media (prefers-color-scheme:dark){:root{--bg:#1c1713;--card:#251f1a;--line:#3a3128;--ink:#efe6d8;--mute:#a69888;--accent:#c79a63;--ok:#8fbf8f;--warn:#e0a85a;--bad:#e07b6d;--c1:#8fb48a;--c2:#d79a68;--c3:#86a9bf;--c4:#b39cc2}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Poppins,system-ui,sans-serif;line-height:1.5}
header{padding:20px 16px 4px;max-width:1100px;margin:0 auto;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline;justify-content:space-between}
h1{font-size:20px;font-weight:500;margin:0}h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;font-weight:500;color:var(--mute);margin:0 0 10px}h3{font-size:15px;font-weight:500;margin:0 0 4px}
.sub{color:var(--mute);font-size:13px}main{max-width:1100px;margin:0 auto;padding:12px 16px 40px;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-top:3px solid var(--tc,var(--line));border-radius:12px;padding:16px}.wide{grid-column:1/-1}
.mute{color:var(--mute)}.note{font-size:12px;color:var(--mute);margin-top:8px}.warn{color:var(--warn)}.bad{color:var(--bad)}.ok{color:var(--ok)}
button,select,input,textarea{font:inherit;font-size:14px}button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:8px 14px;cursor:pointer}
button.ghost{background:transparent;color:var(--mute);border:1px solid var(--line)}.tabs{display:flex;gap:8px;flex-wrap:wrap}.tabs button.on{background:var(--accent);color:#fff;border-color:var(--accent)}
input[type=text],input[type=date],input[type=url],select,textarea{padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);max-width:100%}
textarea{width:100%;min-height:70px;resize:vertical}.form{display:grid;gap:8px;margin-bottom:12px}.form .r{display:flex;gap:8px;flex-wrap:wrap}.form .r>*{flex:1;min-width:140px}
.pill{font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);color:var(--mute);white-space:nowrap;display:inline-block}
.pill.g{color:var(--ok);border-color:var(--ok)}.pill.a{color:var(--warn);border-color:var(--warn)}.pill.r{color:var(--bad);border-color:var(--bad)}
.day{margin-bottom:14px}.day h3{padding-bottom:4px;border-bottom:1px solid var(--line)}
.cls{display:grid;grid-template-columns:70px 1fr auto;gap:8px;padding:6px 0;border-bottom:1px solid var(--line);font-size:14px;align-items:center}.cls:last-child{border-bottom:0}.cls.mine{background:color-mix(in srgb,var(--accent) 10%,transparent)}
.item{padding:10px 0;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:flex-start}.item:last-child{border-bottom:0}.item .body{flex:1;min-width:0;word-break:break-word}
.item.done .t{text-decoration:line-through;color:var(--mute)}.meta{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0}
a{color:var(--accent);font-weight:500}details summary{cursor:pointer;color:var(--accent);font-weight:500}.pre{white-space:pre-wrap;word-break:break-word;font-size:14px;margin-top:6px}
.who{display:flex;gap:8px;align-items:center;margin-bottom:10px;font-size:13px;color:var(--mute)}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}.col{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px}
.col h3{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)}.ecard{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-top:8px;font-size:14px}
.sg{border-collapse:separate;border-spacing:3px;width:100%;min-width:980px;table-layout:fixed}.sg th{font-size:12px;font-weight:500;color:#fff;background:var(--accent);border-radius:6px;padding:6px 4px;text-align:center}.sg th.today{outline:2px solid var(--ink)}.sg td{vertical-align:top;padding:0;height:46px}.sg td.t{font-size:11px;color:var(--mute);width:92px;padding:4px 4px 0 0;text-align:right;white-space:nowrap}
.gc{border-radius:6px;padding:4px 6px;font-size:12px;line-height:1.3;color:#3b2a20;height:100%;position:relative;min-height:44px}.gc b{display:block;font-weight:600;font-size:13px}.gc .nt{font-size:10px;font-style:italic;opacity:.8}.gc.cov{background:#fff200 !important;color:#000}.gc.mine{box-shadow:inset 0 0 0 2px #3b2a20}.gc.click{cursor:pointer}.gc.sel{outline:3px solid var(--accent);outline-offset:1px}.sg td.empty{cursor:pointer;border-radius:6px}.sg td.empty:hover{background:color-mix(in srgb,var(--accent) 12%,transparent)}.gc .dot{position:absolute;top:4px;right:5px;width:8px;height:8px;border-radius:50%}
.gridwrap{overflow-x:auto;padding-bottom:6px}
.gc select{display:block;width:100%;font-size:11px;padding:1px 2px;margin-top:3px;border-radius:4px;border:1px solid rgba(0,0,0,.25);background:rgba(255,255,255,.75);color:#3b2a20;max-width:100%}.gc.pend{outline:2px dashed var(--warn);outline-offset:1px}.savebar{position:sticky;top:0;z-index:5;display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:var(--card);border:1px solid var(--warn);border-radius:10px;padding:8px 12px;margin:8px 0}.nb .item{padding:6px 0}.stagecols{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}.rv{border-collapse:collapse;width:100%;font-size:14px}.rv td{padding:6px 4px;border-bottom:1px solid var(--line)}.rv td.n{text-align:right;font-variant-numeric:tabular-nums;font-weight:500}
.lvt{border-collapse:collapse;width:100%;min-width:640px;font-size:13px}.lvt th,.lvt td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:center}.lvt th:first-child,.lvt td:first-child{text-align:left}.lvt thead th{font-size:11px;color:var(--mute);font-weight:500;text-transform:uppercase;letter-spacing:.05em}.lvt thead th b{display:block;font-size:15px;color:var(--ink);text-transform:none;letter-spacing:0}.lvt tbody tr:last-child td{border-bottom:0}.lvt .pill{min-width:74px;font-weight:500}.lvnum{font-size:22px;font-weight:600;line-height:1.1}.col.never{border-color:var(--bad)}.col.never h3{color:var(--bad)}.col ul,.col ol{margin:6px 0 0;padding-left:18px;font-size:14px;display:grid;gap:4px}.etask{border:1px solid var(--line);border-radius:10px;padding:12px;margin-top:10px;background:var(--bg)}.etask.done{opacity:.65}.etask .hd{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:flex-start}.etask .hd h3{flex:1 1 220px;margin:0}.step{display:flex;gap:8px;align-items:flex-start;padding:4px 0;font-size:14px;cursor:pointer}.step input{margin-top:4px}.step.ticked span{text-decoration:line-through;color:var(--mute)}.legend{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px}.legend span{font-size:11px;padding:2px 8px;border-radius:99px;color:#3b2a20}.wknav{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}.wknav .lbl{font-weight:500;min-width:150px;text-align:center}
</style></head><body>
<header><div><h1>Club Pilates Sippy Downs: Instructors</h1><div class="sub" id="status">Loading...</div></div>
<div class="tabs" id="tabs"></div></header>
<main id="main"></main>
<script>
const $=(t,a={},...k)=>{const e=document.createElement(t);for(const[x,v]of Object.entries(a)){if(x==='class')e.className=v;else if(x.startsWith('on'))e.addEventListener(x.slice(2),v);else e.setAttribute(x,v)}for(const c of k.flat())if(c!=null)e.append(c.nodeType?c:document.createTextNode(c));return e};
const TABS=[['schedule','Schedule'],['changes','ClubReady changes'],['tasks','Tasks'],['education','Education'],['lead','Lead instructor'],['plans','Class plans'],['resources','Resources'],['avail','Availability'],['events','Events'],['clients','Client notes']];
const fmtT=ms=>ms?new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Brisbane',weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(ms)):'';
const fmtDay=d=>d?new Intl.DateTimeFormat('en-AU',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long'}).format(new Date(d+'T12:00:00Z')):'';
const fmtShort=d=>d?new Intl.DateTimeFormat('en-AU',{timeZone:'UTC',weekday:'short',day:'numeric',month:'short'}).format(new Date(d+'T12:00:00Z')):'';
const todayAEST=()=>new Date(Date.now()+10*3600e3).toISOString().slice(0,10);
let D=null,curWho='',tab='schedule',mineOnly=false,clientFilter='',busy=false;
const getWho=()=>{if(curWho)return curWho;try{return localStorage.getItem('sdwho')||''}catch(e){return ''}};
const setWho=v=>{curWho=v;try{localStorage.setItem('sdwho',v)}catch(e){}};
const C=k=>(D&&D.content&&D.content[k])||[];
async function api(path,b){
  const r=await fetch(path,b?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({who:getWho()},b))}:undefined);
  if(r.status===401){location.reload();return null}
  const j=await r.json().catch(()=>({}));
  if(!r.ok){alert(j.error||'Something went wrong');return null}
  return j}
async function content(b){const j=await api('/api/instructors/content',b);if(j){D.content[j.key]=j.list;if(j.todos){D.todos=j.todos}render();return true}return false}
async function postTodo(b){const r=await fetch('/api/todos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({who:getWho()},b))});if(r.ok){const j=await r.json();D.todos=j.todos.filter(t=>t.shared);render()}else{let m='Something went wrong';try{m=(await r.json()).error||m}catch(e){}alert(m)}}
function whoPicker(){
  const names=[...new Set(['Anna','Tyson','Nichola','Simone'].concat(D.names||[]))];
  const s=$('select',{},$('option',{value:''},'Choose your name'),names.map(n=>$('option',{value:n},n)));s.value=getWho();
  s.addEventListener('change',()=>{setWho(s.value);render()});
  return $('div',{class:'who'},$('span',{},'Who is using this screen?'),s)}
function field(ph,type,max){return $('input',{type:type||'text',placeholder:ph,maxlength:String(max||200)})}
function area(ph,max){return $('textarea',{placeholder:ph,maxlength:String(max||1000)})}
function del(kind,id){return $('button',{class:'ghost',onclick:()=>{if(confirm('Remove this?'))content({kind,action:'delete',id})}},'Remove')}
function link(url,label){return $('a',{href:url,target:'_blank',rel:'noopener noreferrer'},label||url)}

/* ---------- schedule ---------- */
const STATUS={ok:['Matches ClubReady','g'],both:['Change style and instructor','r'],instructor:['Change instructor','a'],style:['Change style','a'],missing:['Not found in ClubReady','r'],cover:['Cover needed','a'],later:['Beyond ClubReady window','']};
const PAL={'reformer flow 1':'#eadbc8','reformer flow 1.5':'#d9bf9b','reformer flow 2':'#c4a072','restore 1':'#d5e0d2','cardio sculpt 1':'#f0d3d0','cardio sculpt 1.5':'#e3b5b0','control 1.5':'#dcd6e6','circuit 1.5':'#d0dce6','center+balance 1':'#f3e7c6','seniors':'#f8efd8','intro':'#e6e6e6'};
const shortStyle=s=>String(s||'').replace(/^CP\s+/i,'').replace(/\s*\(\d+\s*mins?\)/i,'').trim();
const styleCol=s=>PAL[shortStyle(s).toLowerCase()]||'#ece6dc';
const addDays=(iso,n)=>new Date(Date.parse(iso+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
const mondayOf=iso=>addDays(iso,-((new Date(iso+'T12:00:00Z').getUTCDay()+6)%7));
const isMine=(r,me)=>!!(me&&r.instructor&&r.instructor.split(/\s+/)[0].toLowerCase()===me.toLowerCase());
const MISMATCH={both:'Change style and instructor in ClubReady',instructor:'Change instructor in ClubReady',style:'Change style in ClubReady',missing:'Not found in ClubReady'};
let wk=null,view='week';
const MGRS=['Nichola','Tyson','Anna','Simone'];
const isMgr=()=>MGRS.includes(getWho());
const allNames=()=>[...new Set((D.names||[]).concat(['Nichola','Tyson']))].sort();
async function roster(b){if(!getWho()){alert('Choose your name first (top of the Classes box)');return false}const j=await api('/api/instructors/roster',b);if(j){D=j;render();return true}return false}
const hhmm=t=>String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');
const offeredBy=(r,me)=>!!(me&&(r.offers||[]).some(o=>o.name.toLowerCase()===me.toLowerCase()));
function rosterCard(){
  return $('details',{class:'card wide',style:'--tc:var(--c3)'},$('summary',{},'How the roster works'),
    $('div',{class:'pre'},'The schedule lives here now. Click any class to see it.\nInstructors: offer to take a yellow cover class, ask for cover on your own class, and add when you are away on the Availability tab.\nNichola, Tyson, Anna and Simone: use the drop-down on each class to change who teaches it, then press Save changes. Click a class for more options, or click an empty square to add one. Every change from today onwards goes to Anna as a "ClubReady:" task, so ClubReady gets updated by hand.'))}
function coverCard(){
  const me=getWho(),today=todayAEST(),cov=D.rows.filter(r=>r.date>=today&&r.cover);
  const card=$('div',{class:'card wide',style:'--tc:#e6c800'},$('h2',{},'Cover needed'));
  if(!cov.length){card.append($('div',{class:'ok'},'Every upcoming class has an instructor.'));return card}
  card.append($('div',{class:'warn',style:'margin-bottom:8px'},cov.length+' upcoming class'+(cov.length===1?'':'es')+' need'+(cov.length===1?'s':'')+' an instructor.'+(me&&!isMgr()?' Tap "I can do this" on any you can take.':'')));
  cov.slice(0,40).forEach(r=>{
    const mine=offeredBy(r,me);
    const offers=(r.offers||[]).map(o=>isMgr()?$('button',{class:'ghost',style:'padding:2px 10px;font-size:12px',title:'Give this class to '+o.name,onclick:()=>{if(confirm('Give '+fmtShort(r.date)+' '+r.label+' to '+o.name+'? Anna will get a ClubReady task.'))roster({action:'assign',id:r.id,name:o.name})}},'Give to '+o.name):$('span',{class:'pill g'},o.name+' can do it'));
    card.append($('div',{class:'item'},$('div',{class:'body'},
      $('div',{class:'t'},$('a',{href:'#schedule',onclick:e=>{e.preventDefault();wk=mondayOf(r.date);view='week';sel=r.id;render()}},fmtShort(r.date)+' '+r.label+(r.style?' '+shortStyle(r.style):'')),r.was?$('span',{class:'mute'},' (was '+r.was+')'):null),
      r.notes?$('div',{class:'note'},r.notes):null,
      $('div',{class:'meta'},...offers,!offers.length?$('span',{class:'pill a'},'No offers yet'):null)),
      me&&!isMgr()?$('button',{class:mine?'ghost':'',onclick:()=>roster({action:'offer',id:r.id})},mine?'Withdraw my offer':'I can do this'):null))});
  if(cov.length>40)card.append($('div',{class:'note'},'Showing the first 40.'));
  if(isMgr())card.append($('div',{class:'note'},'Giving a class to someone sends Anna a ClubReady task and ticks off your "Find cover" task.'));
  return card}
let sel=null,addAt=null,PEND={};
window.addEventListener('beforeunload',e=>{if(Object.keys(PEND).length){e.preventDefault();e.returnValue=''}});
const curName=r=>r.cover||r.closed?'':(allNames().find(n=>n.toLowerCase()===String(r.instructor||'').split(/\s+/)[0].toLowerCase())||r.instructor||'');
async function savePending(){
  const ids=Object.keys(PEND);if(!ids.length)return;
  if(!getWho()){alert('Choose your name first (top of the Classes box)');return}
  let fails=0,last=null;
  for(const id of ids){const r=D.rows.find(x=>x.id===id);if(!r){delete PEND[id];continue}const nm=PEND[id];
    const b=nm?{action:'assign',id,name:nm}:{action:'edit',id,name:'',cover:true,closed:false,style:r.style||'',notes:r.notes||''};
    const res=await fetch('/api/instructors/roster',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({who:getWho()},b))});
    if(res.status===401){location.reload();return}
    const j=await res.json().catch(()=>({}));if(res.ok){last=j;delete PEND[id]}else fails++}
  if(last)D=last;render();
  if(fails)alert(fails+' change'+(fails===1?'':'s')+' did not save. They are still marked; try Save changes again.')}
function saveBar(){const n=Object.keys(PEND).length;if(!n||!isMgr())return null;
  return $('div',{class:'savebar'},$('span',{class:'warn'},n+' unsaved change'+(n===1?'':'s')+'. Anna gets a ClubReady task for each one when you save.'),$('div',{style:'display:flex;gap:8px'},$('button',{onclick:savePending},'Save changes'),$('button',{class:'ghost',onclick:()=>{PEND={};render()}},'Discard')))}
function panel(){
  const me=getWho(),today=todayAEST();
  if(addAt){
    const nm=$('select',{},$('option',{value:''},'Cover needed (no one yet)'),allNames().map(n=>$('option',{value:n},n)));
    const d=$('input',{type:'date',value:addAt.date}),s=$('input',{type:'time',value:hhmm(addAt.start)}),e=$('input',{type:'time',value:hhmm(addAt.start+60)});
    const sty=field('Class style (optional)','text',60),nt=field('Note (optional)','text',200);
    return $('div',{class:'card',style:'margin-top:10px;--tc:var(--c2)'},$('h3',{},'Add a class'),$('div',{class:'form'},$('div',{class:'r'},d,s,e),$('div',{class:'r'},nm,sty),nt,
      $('div',{class:'r'},$('button',{onclick:async()=>{if(await roster({action:'add',date:d.value,start:s.value,end:e.value,name:nm.value,style:sty.value,notes:nt.value}))addAt=null;render()}},'Add class'),$('button',{class:'ghost',onclick:()=>{addAt=null;render()}},'Cancel'))),
      $('div',{class:'note'},'Anna gets a task to add it in ClubReady.'))}
  const r=D.rows.find(x=>x.id===sel);if(!r)return null;
  const past=r.date<today;
  const head=$('h3',{},fmtDay(r.date)+', '+r.label+(r.endLabel?' to '+r.endLabel:''));
  const info=$('div',{class:'meta'},r.closed?$('span',{class:'pill'},'Studio closed'):r.cover?$('span',{class:'pill a'},'Cover needed'+(r.was?' (was '+r.was+')':'')):$('span',{class:'pill g'},r.instructor),r.style?$('span',{class:'pill'},shortStyle(r.style)):null,r.crNow&&r.status!=='ok'?$('span',{class:'pill r'},'ClubReady now: '+r.crNow.title+(r.crNow.who?' with '+r.crNow.who:'')):null);
  const out=$('div',{class:'card',style:'margin-top:10px;--tc:var(--c2)'},head,info,r.notes?$('div',{class:'note'},r.notes):null);
  if(r.cover&&(r.offers||[]).length)out.append($('div',{class:'note'},'Offers: '+r.offers.map(o=>o.name).join(', ')));
  if(!past&&me&&!isMgr()){
    if(r.cover)out.append($('button',{style:'margin-top:8px',class:offeredBy(r,me)?'ghost':'',onclick:()=>roster({action:'offer',id:r.id})},offeredBy(r,me)?'Withdraw my offer':'I can do this class'));
    else if(isMine(r,me)){const why=field('Note for Nichola (optional, no health details)','text',200);out.append($('div',{class:'form',style:'margin-top:8px'},why,$('button',{onclick:()=>{if(confirm('Ask for cover on this class? It turns yellow and Nichola gets a task to find someone.'))roster({action:'needcover',id:r.id,note:why.value})}},'I need cover for this class')))}
  }
  if(isMgr()){
    const nm=$('select',{},$('option',{value:''},'Cover needed (no one yet)'),allNames().map(n=>$('option',{value:n},n)));nm.value=r.instructor&&allNames().includes(r.instructor)?r.instructor:'';
    const cl=$('input',{type:'checkbox',...(r.closed?{checked:''}:{})});
    const sty=field('Class style (optional)','text',60);sty.value=r.style||'';
    const nt=field('Note (optional)','text',200);nt.value=r.notes||'';
    const e=$('input',{type:'time',value:hhmm(r.end!=null?r.end:r.start+60)});
    out.append($('div',{class:'form',style:'margin-top:10px'},$('div',{class:'r'},nm,sty),$('div',{class:'r'},nt,$('label',{class:'mute',style:'display:flex;gap:6px;align-items:center;flex:0'},'Ends',e)),
      $('label',{class:'mute',style:'display:flex;gap:6px;align-items:center'},cl,'Studio closed / class cancelled'),
      $('div',{class:'r'},$('button',{onclick:()=>roster({action:'edit',id:r.id,name:nm.value,cover:!nm.value,closed:cl.checked,style:sty.value,notes:nt.value,end:e.value})},'Save changes'),
        r.cover&&(r.offers||[]).length?null:null,
        $('button',{class:'ghost',onclick:()=>{if(confirm('Remove this class from the roster? Anna gets a task to remove it from ClubReady.'))roster({action:'remove',id:r.id}).then(ok=>{if(ok){sel=null;render()}})}},'Remove class'),
        $('button',{class:'ghost',onclick:()=>{sel=null;render()}},'Close'))),
      $('div',{class:'note'},'Saving a change to a class from today onwards sends Anna a ClubReady task. Choosing "Cover needed" turns it yellow and gives you a Find cover task.'));
    (r.offers||[]).forEach(o=>out.append($('button',{class:'ghost',style:'margin:6px 6px 0 0',onclick:()=>roster({action:'assign',id:r.id,name:o.name})},'Give to '+o.name)));
  } else out.append($('div',{style:'margin-top:8px'},$('button',{class:'ghost',onclick:()=>{sel=null;render()}},'Close')));
  return out}
function weekGrid(){
  const me=getWho(),today=todayAEST();if(!wk)wk=mondayOf(today);
  const days=[0,1,2,3,4,5,6].map(i=>addDays(wk,i));
  const rows=D.rows.filter(r=>r.date>=days[0]&&r.date<=days[6]);
  const by={},slots={};
  D.rows.filter(r=>r.date>=addDays(wk,-14)&&r.date<=addDays(wk,20)).forEach(r=>{if(!slots[r.start])slots[r.start]=r.label+(r.endLabel?' - '+r.endLabel:'')});
  rows.forEach(r=>{(by[r.date+'|'+r.start]=by[r.date+'|'+r.start]||[]).push(r)});
  const away=C('i_unavail').filter(u=>u.from<=days[6]&&(u.to||u.from)>=days[0]);
  const awayNote=away.length?$('div',{class:'note',style:'margin:0 0 6px'},'Unavailable this week: '+away.map(u=>u.name+' ('+uRange(u)+(u.when&&!allDay(u)?', '+u.when.toLowerCase():'')+')').join('; ')):null;
  const nav=$('div',{class:'wknav'},$('button',{class:'ghost',onclick:()=>{wk=addDays(wk,-7);sel=null;render()}},'< Previous'),
    $('span',{class:'lbl'},fmtShort(days[0])+' to '+fmtShort(days[6])),$('button',{class:'ghost',onclick:()=>{wk=addDays(wk,7);sel=null;render()}},'Next >'),
    $('button',{class:'ghost',onclick:()=>{wk=mondayOf(today);sel=null;render()}},'This week'),
    isMgr()?$('button',{class:'ghost',onclick:()=>{addAt={date:days[0]>today?days[0]:today,start:360};sel=null;render()}},'+ Add a class'):null);
  const legend=$('div',{class:'legend'});
  legend.append($('span',{style:'background:#fff200;color:#000;font-weight:600'},'Cover needed'),$('span',{style:'background:#d9d4cc'},'Closed'),$('span',{style:'background:#ece6dc'},'Teaching'));
  const head=$('tr',{},$('th',{style:'background:transparent'}),...days.map(d=>$('th',{class:d===today?'today':''},fmtShort(d))));
  const body=Object.keys(slots).map(Number).sort((a,b)=>a-b).map(st=>$('tr',{},$('td',{class:'t'},slots[st]),...days.map(d=>{
    const list=by[d+'|'+st]||[];
    if(!list.length)return $('td',isMgr()&&d>=today?{class:'empty',title:'Add a class here',onclick:()=>{addAt={date:d,start:st};sel=null;render()}}:{});
    return $('td',{},...list.map(r=>{const cov=r.cover,mis=MISMATCH[r.status],n=(r.offers||[]).length;
      const tip=[shortStyle(r.style),r.closed?'Closed':(r.instructor||'Cover needed'),r.notes,r.crNow&&r.status!=='ok'?'ClubReady now: '+r.crNow.title+(r.crNow.who?' with '+r.crNow.who:''):'',mis||''].filter(Boolean).join(' | ');
      const canPick=isMgr()&&!r.closed&&r.date>=today,pv=PEND[r.id];
      return $('div',{class:'gc click'+(cov?' cov':'')+(isMine(r,me)?' mine':'')+(sel===r.id?' sel':'')+(pv!==undefined?' pend':''),style:cov?'':'background:'+(r.closed?'#d9d4cc':styleCol(r.style)),title:tip,onclick:()=>{sel=r.id;addAt=null;render()}},
        r.style?$('span',{},shortStyle(r.style)):null,$('b',{},r.closed?'Closed':cov?'COVER':r.instructor.split(/\s+/)[0]),
        cov&&n?$('span',{class:'nt'},n+' offer'+(n===1?'':'s')):(cov&&r.was?$('span',{class:'nt'},'was '+r.was):(r.notes?$('span',{class:'nt'},r.notes):null)),
        mis?$('span',{class:'dot',style:'background:'+(r.status==='missing'||r.status==='both'?'#a33a2e':'#b0701f')}):null,
        canPick?(()=>{const o=curName(r),sl=$('select',{'aria-label':'Who teaches '+fmtShort(r.date)+' '+r.label,onclick:e=>e.stopPropagation()},$('option',{value:''},'Cover needed'),[...new Set(allNames().concat(o?[o]:[]))].map(n=>$('option',{value:n},n)));sl.value=pv!==undefined?pv:o;sl.addEventListener('change',()=>{if(sl.value===o)delete PEND[r.id];else PEND[r.id]=sl.value;render()});return sl})():null)}))})));
  const wrap=$('div',{class:'gridwrap'},$('table',{class:'sg'},$('thead',{},head),$('tbody',{},...body)));
  const hasDot=rows.some(r=>MISMATCH[r.status]);
  return [saveBar(),nav,awayNote,legend,Object.keys(slots).length?wrap:$('div',{class:'mute',style:'margin:12px 0'},'No classes on the roster for this week.'),panel(),
    $('div',{class:'note'},'Click a class for details. Your own classes have a dark outline.'+(hasDot?' A red or amber dot means ClubReady does not match the roster yet (see the ClubReady changes tab).':''))].filter(Boolean)}
function dayList(){
  const me=getWho(),today=todayAEST();
  const rows=D.rows.filter(r=>r.date>=today&&(!mineOnly||isMine(r,me)));
  const days={};rows.forEach(r=>(days[r.date]=days[r.date]||[]).push(r));
  const out=[$('label',{class:'mute',style:'display:flex;gap:6px;align-items:center;font-size:13px;margin-bottom:10px'},$('input',{type:'checkbox',...(mineOnly?{checked:''}:{}),onchange:e=>{mineOnly=e.target.checked;render()}}),'Show only my classes')];
  const ds=Object.keys(days).sort().slice(0,28);
  if(!ds.length)out.push($('div',{class:'mute'},D.rows.length?'Nothing found for you on the roster.':'No classes on the roster yet.'));
  for(const d of ds){
    out.push($('div',{class:'day'},$('h3',{},fmtDay(d)),days[d].map(r=>{const st=r.closed?['Closed','']:(STATUS[r.status]||['','']);
      return $('div',{class:'cls'+(isMine(r,me)?' mine':''),style:'cursor:pointer',onclick:()=>{sel=r.id;view='week';wk=mondayOf(r.date);render()}},$('span',{class:'mute'},r.label),
        $('span',{},(r.style?r.style+' ':'')+(r.closed?'Studio closed':r.instructor?'with '+r.instructor:'cover needed'+(r.was?' (was '+r.was+')':'')),r.notes?$('span',{class:'mute'},' - '+r.notes):null),
        $('span',{class:'pill '+st[1]},st[0]))})))}
  return out}
function historyCard(){
  const log=D.rosterLog||[];
  return $('details',{class:'card wide',style:'--tc:var(--c4)'},$('summary',{},'Roster history ('+log.length+')'),
    log.length?log.slice(0,80).map(x=>$('div',{class:'item'},$('div',{class:'body'},$('div',{},x.summary),$('div',{class:'note'},fmtT(x.at))))):$('div',{class:'mute',style:'margin-top:8px'},'No changes yet.'))}
function scheduleTab(m){
  m.append(rosterCard());
  if(D.crError)m.append($('div',{class:'card wide note bad'},'ClubReady problem: '+D.crError));
  m.append(coverCard());
  const card=$('div',{class:'card wide',style:'--tc:var(--c1)'},$('h2',{},'Classes'),whoPicker(),
    $('div',{class:'tabs',style:'margin-bottom:6px'},$('button',{class:'ghost'+(view==='week'?' on':''),onclick:()=>{view='week';render()}},'Week by week'),$('button',{class:'ghost'+(view==='list'?' on':''),onclick:()=>{view='list';render()}},'Day list')));
  card.append(...(view==='week'?weekGrid():dayList()));
  m.append(card);m.append(historyCard())}

/* ---------- changes ---------- */
let PROBE=null;
const PSTAT=s=>s===0?['No answer','']:s===404?['Does not exist','']:s===405?['Exists, but only accepts changes (a write door)','g']:(s===401||s===403)?['Exists, but this key is not allowed','r']:s>=200&&s<300?['Exists and readable','a']:s===400?['Exists, wants more details','a']:['Status '+s,''];
function probeCard(){
  const card=$('div',{class:'card wide',style:'--tc:var(--c4)'},$('h2',{},'ClubReady write check'),
    $('div',{class:'note',style:'margin:0 0 8px'},'This only asks ClubReady which doors exist and whether your key may use them. It does not change anything in ClubReady.'));
  const btn=$('button',{onclick:async e=>{e.target.disabled=true;e.target.textContent='Checking...';const j=await api('/api/instructors/probe',{});if(j){PROBE=j}render()}},PROBE?'Check again':'Run the check');
  card.append(btn);
  if(PROBE&&PROBE.results){
    const hits=PROBE.results.filter(r=>r.status&&r.status!==404);
    card.append($('div',{style:'margin-top:10px',class:hits.length?'warn':'bad'},hits.length?hits.length+' of '+PROBE.results.length+' possible doors answered:':'None of the doors we tried exist.'));
    card.append(...PROBE.results.map(r=>{const t=PSTAT(r.status);return $('div',{class:'row',style:'display:flex;gap:8px;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);font-size:13px'},$('span',{},r.path+(r.allow?'  ['+r.allow+']':'')),$('span',{class:'pill '+t[1]},r.status+' '+t[0]))}));
    card.append($('div',{class:'note'},'Send these results to Claude. They show what is possible before anything is built.'))}
  return card}
function changesTab(m){
  const open=D.changes.filter(c=>!c.done),done=D.changes.filter(c=>c.done);
  const card=$('div',{class:'card wide',style:'--tc:var(--c2)'},$('h2',{},'Changes to make in ClubReady'),whoPicker());
  if(D.state==='nosheet')card.append($('div',{class:'mute'},'The roster is empty.'));
  else{
    card.append($('div',{class:open.length?'warn':'ok'},open.length?open.length+' class'+(open.length===1?'':'es')+' where ClubReady does not match the roster.':'ClubReady matches the roster for the next 14 days.'));
    card.append($('div',{style:'margin-top:10px'}),...open.map(c=>chg(c)));
    if(done.length)card.append($('details',{style:'margin-top:12px'},$('summary',{},done.length+' done'),done.map(c=>chg(c))));
    card.append($('div',{class:'note'},'This is a safety net: the roster compared with ClubReady for today and the next 13 days. Roster changes also go to Anna as tasks on the manager dashboard. Make each change in ClubReady, then tick it. If the roster changes again after you tick it, it reopens.'))}
  m.append(card);m.append(probeCard())}
function chg(c){
  const want=(c.want.style||'class')+' with '+c.want.instructor;
  const now=c.now?c.now.title+(c.now.who?' with '+c.now.who:''):'not in ClubReady';
  return $('div',{class:'item'+(c.done?' done':'')},$('input',{type:'checkbox',...(c.done?{checked:''}:{}),onchange:async e=>{if(!getWho()){alert('Choose your name first');e.target.checked=!e.target.checked;return}const j=await api('/api/instructors/change',{key:c.key,sig:c.sig,done:e.target.checked});if(j){D=j;render()}}}),
    $('div',{class:'body'},$('div',{class:'t'},fmtShort(c.date)+' '+c.label+': set to '+want),$('div',{class:'meta'},$('span',{class:'pill'},'ClubReady now: '+now),c.done?$('span',{class:'pill g'},'done '+fmtT(c.doneAt)+(c.doneBy?' by '+c.doneBy:'')):null)))}

/* ---------- tasks ---------- */
function tasksTab(m){
  const input=field('Add a task for the instructors','text',300),owner=$('select',{},['Anyone','Anna','Tyson','Nichola','Simone'].map(o=>$('option',{value:o},o))),due=$('input',{type:'date'});
  const add=async()=>{if(!input.value.trim())return;const r=await fetch('/api/todos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({who:getWho(),action:'add',text:input.value,owner:owner.value,due:due.value,shared:true})});if(r.ok){const j=await r.json();D.todos=j.todos.filter(t=>t.shared);render()}else alert('Something went wrong')};
  const items=D.todos.slice().sort((a,b)=>(a.done-b.done)||(a.done?0:((b.high?1:0)-(a.high?1:0)))||((a.due||'9999').localeCompare(b.due||'9999')));
  const today=todayAEST();
  m.append($('div',{class:'card wide',style:'--tc:var(--c4)'},$('h2',{},'Shared tasks'),whoPicker(),
    $('div',{class:'form'},$('div',{class:'r'},input,owner,due,$('button',{onclick:add},'Add'))),
    items.length?items.map(t=>{const od=!t.done&&t.due&&t.due<today;
      return $('div',{class:'item'+(t.done?' done':'')},$('input',{type:'checkbox',...(t.done?{checked:''}:{}),onchange:()=>{if(!getWho()){alert('Choose your name first');render();return}postTodo({action:'toggle',id:t.id})}}),
        $('div',{class:'body'},$('div',{class:'t'},t.text),$('div',{class:'meta'},t.high&&!t.done?$('span',{class:'pill r'},'High priority'):null,$('span',{class:'pill'},t.owner),t.due?$('span',{class:'pill '+(od?'r':'')},(od?'overdue, was ':'due ')+fmtShort(t.due)):null,t.done?$('span',{class:'pill g'},'completed '+fmtT(t.doneAt)+(t.doneBy?' by '+t.doneBy:'')):null),t.notes?$('div',{class:'note'},t.notes):null))}):$('div',{class:'mute'},'No shared tasks. Anna, Tyson and Nichola can share any task from the manager dashboard.'),
    $('div',{class:'note'},'Only tasks that managers have shared appear here. Tick one when it is done and your name and the time are recorded.')))}

/* ---------- noticeboard (top of every tab) ---------- */
function noticeboard(){
  const today=todayAEST(),soon=addDays(today,14);
  const cov=D.rows.filter(r=>r.date>=today&&r.cover&&!r.closed);
  const ev=C('i_events').filter(e=>e.date>=today&&e.date<=soon).sort((a,b)=>a.date.localeCompare(b.date));
  const edu=C('i_edu').filter(x=>x.status==='Next up');
  const et=C('i_etasks').filter(t=>t.status==='In progress');
  if(!cov.length&&!ev.length&&!edu.length&&!et.length)return null;
  return $('div',{class:'card wide nb',style:'--tc:var(--accent)',id:'noticeboard'},$('h2',{},'Noticeboard'),
    cov.length?$('div',{class:'item'},$('div',{class:'body'},$('a',{href:'#schedule',onclick:e=>{e.preventDefault();tab='schedule';location.hash='schedule';render()}},'Cover needed: '+cov.length+' upcoming class'+(cov.length===1?'':'es')),$('div',{class:'note'},cov.slice(0,4).map(r=>fmtShort(r.date)+' '+r.label).join(', ')+(cov.length>4?' and more':'')))):null,
    ev.map(e=>$('div',{class:'item'},$('div',{class:'body'},$('b',{},fmtShort(e.date)+(e.time?', '+e.time:'')+': '),e.title,e.details?$('div',{class:'note'},e.details):null))),
    edu.length?$('div',{class:'item'},$('div',{class:'body'},$('b',{},'Education next up: '),edu.map(x=>x.title).join(', '))):null,
    et.length?$('div',{class:'item'},$('div',{class:'body'},$('b',{},'Education tasks in progress: '),et.map(t=>t.title+' ('+t.owner+')').join('; '))):null)}

/* ---------- lead instructor: hot leads, lead-to-sign-up journey, monthly review ---------- */
const STAGES=['Lead','Intro booked','Intro attended','Offer made','Joined','Lost'];
const ACTIVE=STAGES.slice(0,4);
const SOURCES=['Meta ad','Walk-in','Referral','Website','Google','Other'];
const PLAYBOOK={'Lead':'Draft for Nichola to rewrite. Contact within the hour by call, then SMS if no answer. Find out why they are interested and book the intro class on the call.',
 'Intro booked':'Draft for Nichola to rewrite. Confirm the day before. Tell the instructor who is coming and anything they shared (no health details on the dashboard).',
 'Intro attended':'Draft for Nichola to rewrite. Greet them by name, introduce them to the instructor, and have a short conversation after class about what they want from Pilates.',
 'Offer made':'Draft for Nichola to rewrite. Recommend the membership that fits what they told you, explain it simply, and agree a follow-up time if they want to think about it.',
 'Joined':'Draft for Nichola to rewrite. Welcome them, book their next three classes with them, and add them to the milestone list.',
 'Lost':'Draft for Nichola to rewrite. Record the honest reason. Note if they are happy to hear from us again.'};
function journey(b){if(!getWho()){alert('Choose your name first (top of the journey box)');return Promise.resolve(false)}return content(Object.assign({kind:'journey'},b))}
function leadTab(m){
  const today=todayAEST();
  // hot leads (from client notes marked as hot leads)
  const hot=C('i_cnotes').filter(x=>x.hot).sort((a,b)=>(a.follow||'9999').localeCompare(b.follow||'9999'));
  m.append($('div',{class:'card',style:'--tc:var(--bad)',id:'hot-leads'},$('h2',{},'Hot leads'),
    hot.length?hot.slice(0,30).map(x=>{const od=x.follow&&x.follow<today;return $('div',{class:'item'},$('div',{class:'body'},$('div',{class:'t'},x.client),$('div',{class:'meta'},x.follow?$('span',{class:'pill '+(od?'r':'a')},(od?'follow-up overdue, was ':'follow up ')+fmtShort(x.follow)):null,x.by?$('span',{class:'pill'},'from '+x.by):null),$('div',{class:'note'},x.note)))}):$('div',{class:'mute'},'No hot leads. Add one from the Client notes tab by ticking Hot lead.'),
    $('div',{class:'note'},'Shared with the manager dashboard: every hot lead is also a task for Anna. Full names are fine; never phone numbers, emails or health details.')));
  // journey tracker
  const all=C('i_journey');
  const nm=field('Name','text',80),src=$('select',{},$('option',{value:''},'Where from?'),SOURCES.map(s=>$('option',{value:s},s))),nx=$('input',{type:'date'}),nt=field('Note (optional)','text',600);
  const cardFor=x=>{const i=STAGES.indexOf(x.stage),nextSt=ACTIVE[i+1];const od=x.next&&x.next<today;
    return $('div',{class:'ecard'},$('div',{},$('b',{},x.name)),$('div',{class:'meta'},x.source?$('span',{class:'pill'},x.source):null,x.next?$('span',{class:'pill '+(od?'r':'')},(od?'overdue, was ':'next step ')+fmtShort(x.next)):null),x.note?$('div',{class:'note'},x.note):null,
      $('div',{class:'meta'},nextSt?$('button',{class:'ghost',style:'padding:2px 8px;font-size:12px',onclick:()=>journey({action:'stage',id:x.id,stage:nextSt})},'Move to '+nextSt):null,
        $('button',{class:'ghost',style:'padding:2px 8px;font-size:12px',onclick:()=>journey({action:'stage',id:x.id,stage:'Joined'})},'Joined'),
        $('button',{class:'ghost',style:'padding:2px 8px;font-size:12px',onclick:()=>{const why=prompt('Why did they not join? (no health details)');if(why!==null)journey({action:'stage',id:x.id,stage:'Lost',reason:why})}},'Lost'),del('journey',x.id)))};
  const month=today.slice(0,7);
  const closed=all.filter(x=>(x.stage==='Joined'||x.stage==='Lost')&&(x.hist||[]).some(h=>h.stage===x.stage&&new Date(h.at+10*3600e3).toISOString().slice(0,7)===month));
  m.append($('div',{class:'card wide',style:'--tc:var(--c1)',id:'journey'},$('h2',{},'Lead to sign-up journey'),whoPicker(),
    $('div',{class:'form'},$('div',{class:'r'},nm,src,nx),$('div',{class:'r'},nt,$('button',{onclick:()=>{if(!nm.value.trim())return;journey({action:'add',name:nm.value,source:src.value,next:nx.value,note:nt.value})}},'Add lead'))),
    $('div',{class:'stagecols'},ACTIVE.map(st=>$('div',{class:'col'},$('h3',{},st+' ('+all.filter(x=>x.stage===st).length+')'),all.filter(x=>x.stage===st).sort((a,b)=>(a.next||'9999').localeCompare(b.next||'9999')).map(cardFor)))),
    $('details',{style:'margin-top:10px'},$('summary',{},'Joined or lost this month ('+closed.length+')'),closed.map(x=>$('div',{class:'item'},$('div',{class:'body'},$('b',{},x.name),' ',$('span',{class:'pill '+(x.stage==='Joined'?'g':'r')},x.stage),x.reason?$('div',{class:'note'},'Reason: '+x.reason):null)))),
    $('div',{class:'note'},'This tracker is separate from ClubReady and does not sync with it. Update ClubReady as usual.')));
  // playbook
  m.append($('div',{class:'card',style:'--tc:var(--c3)',id:'playbook'},$('h2',{},'Journey playbook'),STAGES.map(st=>$('details',{class:'item',style:'display:block'},$('summary',{},st),$('div',{class:'pre'},PLAYBOOK[st])))));
  // monthly sign-up review
  const months=[...new Set(all.flatMap(x=>(x.hist||[]).map(h=>new Date(h.at+10*3600e3).toISOString().slice(0,7))).concat([month]))].sort().reverse().slice(0,6);
  const pick=$('select',{'aria-label':'Month'},months.map(k=>$('option',{value:k},new Intl.DateTimeFormat('en-AU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(k+'-15T00:00:00Z')))));
  const body=$('div',{});
  const draw=()=>{const k=pick.value;const inM=(x,st)=>(x.hist||[]).some(h=>h.stage===st&&new Date(h.at+10*3600e3).toISOString().slice(0,7)===k);
    const leads=all.filter(x=>inM(x,'Lead')).length,att=all.filter(x=>inM(x,'Intro attended')).length,joined=all.filter(x=>inM(x,'Joined')).length,lost=all.filter(x=>inM(x,'Lost'));
    const reasons={};lost.forEach(x=>{const r=(x.reason||'No reason given').trim();reasons[r]=(reasons[r]||0)+1});
    body.replaceChildren($('table',{class:'rv'},$('tbody',{},$('tr',{},$('td',{},'New leads added'),$('td',{class:'n'},String(leads))),$('tr',{},$('td',{},'Intro classes attended'),$('td',{class:'n'},String(att))),$('tr',{},$('td',{},'Joined'),$('td',{class:'n'},String(joined))),$('tr',{},$('td',{},'Lost'),$('td',{class:'n'},String(lost.length))),$('tr',{},$('td',{},'Joined from intros attended'),$('td',{class:'n'},att?Math.round(joined/att*100)+'%':'–')))),
      lost.length?$('div',{class:'note'},'Why people did not join: '+Object.entries(reasons).sort((a,b)=>b[1]-a[1]).map(([r,n])=>r+' ('+n+')').join('; ')):null)};
  pick.addEventListener('change',draw);draw();
  m.append($('div',{class:'card',style:'--tc:var(--c4)',id:'signup-review'},$('h2',{},'Monthly sign-up review'),pick,body,$('div',{class:'note'},'Counted from this tracker only, so it is only as complete as the leads added here.')))}

/* ---------- class level rules: Bridge manual, Class Levels and Protocol, pp. 61 to 66 ---------- */
const LV_COLS=[['1.0','Foundation','Foundations and body awareness. Pre-modified so everyone is safe. Not easy: challenge with duration and variation.',''],['1.5','Progression','Balance and stability. Advanced beginners, moderate tempo, intermediate variations.','Needs Level 1 experience.'],['2.0','Evolution','Strength. Moderate to fast pace, quick transitions, more advanced use of the apparatus.','Needs Level 1.5, plus invitation or workshop.'],['2.5','Mastery','Coordination, precision and advanced choreography. Pilates, not boot camp.','3 months of Level 2, or instructor approval.']];
const LV_ROWS=[['Kneeling on Reformer','N','I','Y','Y'],['Standing on Reformer','N','N','Y','Y'],['Hand weights','N','I','Y','Y'],['Who changes springs','Instructor','Member removes one','Member OK','Member OK'],['Who adjusts footbar and gearbar','Instructor','Instructor','Instructor','Instructor'],['Single-leg footwork','N','I','Y','Y'],['EXO Chair','N','I','Y','Y'],['Standing on EXO Chair','N','N','I','Y'],['Long lever challenges','I','Minimal','Y','Y'],['Open kinetic chain','I','Minimal','Y','Y'],['Spinal extension','To neutral','Gentle','Y','Y'],['Use progressions','Always','Always','Always','Always']];
const LV_CELL={Y:['Yes','g'],N:['No','r'],I:['Intro','a'],Minimal:['Minimal','a'],'To neutral':['To neutral','a'],Gentle:['Gentle','a'],'Member removes one':['Member removes one','a'],'Member OK':['Member OK','g'],Always:['Always','g'],Instructor:['Instructor','']};
const LV_NEVER=['Anything with zero springs','Weight-loaded spinal flexion (sitting in a C-curve holding hand weights)','Stomach Massage (full choreography)','Short Spine, Long Spine, Jackknife','Front or Back Rowing series (full choreography)','Semi-Circle','Standing on the Reformer holding the straps','Handstands','Standing work on the Reformer facing the risers'];
const LV_EVERY=['Move the spine in every direction','Move the body in all planes of motion','Give a balanced, full-body workout','Use progressions; offer modifications or props as needed'];
const LV_DEMO=['Never move a member off their apparatus to demonstrate','Do not stop the whole group to watch you','Use an open station if there is one, for 1 or 2 reps only','Otherwise stand by a member doing it well and point the class to them'];
function levelRulesCard(){
  const cell=v=>{const c=LV_CELL[v]||[v,''];return $('td',{},$('span',{class:'pill '+c[1]},c[0]))};
  return $('div',{class:'card wide',style:'--tc:var(--c3)',id:'level-rules'},$('h2',{},'Class level rules'),
    $('div',{class:'sub',style:'margin-bottom:12px'},'What is allowed at each level, and what we never teach in a group class. If you have to ask whether something is right for Level 1, it probably is not.'),
    $('div',{class:'cols'},LV_COLS.map(c=>$('div',{class:'col'},$('div',{class:'lvnum'},c[0]),$('h3',{},c[1]),$('div',{style:'font-size:13px'},c[2]),c[3]?$('div',{class:'note'},c[3]):null))),
    $('h2',{style:'margin-top:16px'},'Safety at a glance'),
    $('div',{class:'gridwrap'},$('table',{class:'lvt'},$('thead',{},$('tr',{},$('th',{},'Rule'),LV_COLS.map(c=>$('th',{},$('b',{},c[0]),c[1])))),$('tbody',{},LV_ROWS.map(r=>$('tr',{},$('td',{},r[0]),r.slice(1).map(cell)))))),
    $('div',{class:'cols',style:'margin-top:12px'},
      $('div',{class:'col never'},$('h3',{},'Exercises we never do'),$('div',{class:'note',style:'margin-top:2px'},'Not wrong, just too complex or risky in a group. If a member asks, offer a private session.'),$('ul',{},LV_NEVER.map(x=>$('li',{},x))),$('div',{style:'font-size:14px;font-weight:500;margin-top:8px'},'Never change the class safety standards to suit one member.')),
      $('div',{class:'col'},$('h3',{},'At every level'),$('ul',{},LV_EVERY.map(x=>$('li',{},x)))),
      $('div',{class:'col'},$('h3',{},'Demonstrating'),$('ol',{},LV_DEMO.map(x=>$('li',{},x))))),
    $('div',{class:'note'},'From the Club Pilates Bridge Training manual, Class Levels and Protocol, pages 61 to 66.'))}

/* ---------- education tasks (Nichola, Simone and the team) ---------- */
const ET_STATUS=['To do','In progress','Waiting','Done'];
const ET_OWNERS=['Nichola','Simone','Nichola and Simone','Anna','Tyson','Anyone'];
function etask(b){if(!getWho()){alert('Choose your name first (top of this box)');render();return Promise.resolve(false)}return content(Object.assign({kind:'etask'},b))}
function eduTasksCard(){
  const today=todayAEST();
  const list=C('i_etasks').slice().sort((a,b)=>((a.status==='Done')-(b.status==='Done'))||((a.due||'9999').localeCompare(b.due||'9999')));
  const tone={'To do':'','In progress':'a','Waiting':'r','Done':'g'};
  const item=t=>{
    const od=t.status!=='Done'&&t.due&&t.due<today;
    const sel=$('select',{'aria-label':'Status'},ET_STATUS.map(o=>$('option',{value:o},o)));sel.value=t.status||'To do';
    sel.addEventListener('change',()=>etask({action:'status',id:t.id,status:sel.value}));
    const steps=(t.steps||[]).map((s,i)=>{const cb=$('input',{type:'checkbox',...(s.done?{checked:''}:{})});cb.addEventListener('change',()=>etask({action:'step',id:t.id,step:i}));return $('label',{class:'step'+(s.done?' ticked':'')},cb,$('span',{},s.text))});
    const nt=field('Add a note','text',600);
    const notes=(t.notes||[]);
    return $('div',{class:'etask'+(t.status==='Done'?' done':'')},
      $('div',{class:'hd'},$('h3',{},t.title),sel),
      $('div',{class:'meta'},$('span',{class:'pill '+(tone[t.status]||'')},t.status||'To do'),$('span',{class:'pill'},t.owner||'Anyone'),t.due?$('span',{class:'pill '+(od?'r':'')},(od?'overdue, was ':'due ')+fmtShort(t.due)):null,t.after?$('span',{class:'pill'},'after: '+t.after):null),
      t.summary?$('div',{style:'font-size:14px;margin:6px 0'},t.summary):null,
      steps.length?$('div',{},steps):null,
      (t.sections||[]).map(x=>$('details',{style:'margin-top:6px'},$('summary',{},x.title),$('div',{class:'pre'},x.text))),
      $('details',{style:'margin-top:6px'},$('summary',{},'Notes ('+notes.length+')'),notes.map(n=>$('div',{class:'note'},(n.by||'Someone')+', '+fmtT(n.at)+': '+n.text)),
        $('div',{class:'form',style:'margin:8px 0 0'},$('div',{class:'r'},nt,$('button',{onclick:()=>{if(nt.value.trim())etask({action:'note',id:t.id,text:nt.value})}},'Add note')))),
      t.updated?$('div',{class:'note'},'Last updated '+fmtT(t.updated)+(t.updatedBy?' by '+t.updatedBy:'')):null)};
  const ti=field('New education task','text',160),ow=$('select',{},ET_OWNERS.map(o=>$('option',{value:o},o))),du=$('input',{type:'date'}),stp=area('Steps, one per line (optional)',3000);
  return $('div',{class:'card wide',style:'--tc:var(--c2)',id:'education-tasks'},$('h2',{},'Education tasks'),whoPicker(),
    list.length?list.map(item):$('div',{class:'mute'},'No education tasks yet.'),
    $('details',{style:'margin-top:12px'},$('summary',{},'Add a task'),$('div',{class:'form',style:'margin-top:8px'},$('div',{class:'r'},ti,ow,du),stp,$('div',{class:'r'},$('button',{onclick:()=>{if(ti.value.trim())etask({action:'add',title:ti.value,owner:ow.value,due:du.value,steps:stp.value})}},'Add task')))),
    $('div',{class:'note'},'Teacher Training and education jobs. Choose your name, then tick steps, change the status or add a note; your name and the time are recorded.'))}

/* ---------- education ---------- */
const EDU_LIBRARY=[{label:'Classical to Pre-Pilates Master',url:'https://claude.ai/artifact/AUWF5Bw5MkjQPWi6UKn44p',note:'All 34 classical mat exercises with their pre-Pilates regression, single-lever, chair and springboard progressions, contraindications, a pre-Pilates library and a screening matrix.'}];
function educationTab(m){
  m.append(levelRulesCard(),eduTasksCard());
  m.append($('div',{class:'card wide',style:'--tc:var(--c2)'},$('h2',{},'Education library'),EDU_LIBRARY.map(r=>$('div',{class:'item'},$('div',{class:'body'},link(r.url,r.label),$('div',{class:'note'},r.note))))));
  const t=field('Education topic (for example: shoulder cueing)','text',120),nt=field('Notes (optional)','text',600),st=$('select',{},['Planned','Next up','Done'].map(o=>$('option',{value:o},o))),wh=field('When (optional, e.g. March)','text',40);
  const col=s=>$('div',{class:'col'},$('h3',{},s),C('i_edu').filter(x=>(x.status||'Planned')===s).map(x=>$('div',{class:'ecard'},$('div',{},x.title),x.when?$('div',{class:'note'},x.when):null,x.note?$('div',{class:'note'},x.note):null,
    $('div',{class:'meta'},['Planned','Next up','Done'].filter(o=>o!==s).map(o=>$('button',{class:'ghost',style:'padding:2px 8px;font-size:12px',onclick:()=>content({kind:'edu',action:'status',id:x.id,status:o})},'Move to '+o)),del('edu',x.id)))));
  m.append($('div',{class:'card wide',style:'--tc:var(--c1)'},$('h2',{},'Education column'),$('div',{class:'form'},$('div',{class:'r'},t,wh,st),$('div',{class:'r'},nt,$('button',{onclick:()=>{if(!t.value.trim())return;content({kind:'edu',action:'add',title:t.value,note:nt.value,status:st.value,when:wh.value})}},'Add topic'))),
    $('div',{class:'cols'},col('Planned'),col('Next up'),col('Done'))));
  // meeting notes
  const title=field('Meeting title','text',120),date=$('input',{type:'date'});date.value=todayAEST();
  const summary=area('Summary of what was covered',3000),dec=area('Decisions (optional)',2000);
  const ar=[];const arows=$('div',{});
  const addRow=()=>{const tx=field('Action','text',300),ow=$('select',{},['Anyone','Anna','Tyson','Nichola','Simone'].map(o=>$('option',{value:o},o))),du=$('input',{type:'date'});ar.push({tx,ow,du});arows.append($('div',{class:'r',style:'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px'},tx,ow,du))};
  addRow();
  const save=async()=>{const actions=ar.filter(a=>a.tx.value.trim()).map(a=>({text:a.tx.value,owner:a.ow.value,due:a.du.value}));await content({kind:'emeet',action:'add',title:title.value,date:date.value,summary:summary.value,decisions:dec.value,actions})};
  m.append($('div',{class:'card',style:'--tc:var(--c4)'},$('h2',{},'Add education meeting notes'),$('div',{class:'form'},title,date,summary,dec,$('div',{class:'lblx mute'},'Actions (these become shared tasks)'),arows,$('div',{class:'r'},$('button',{class:'ghost',onclick:addRow},'Add another action'),$('button',{onclick:save},'Save meeting notes')))));
  m.append($('div',{class:'card',style:'--tc:var(--c4)'},$('h2',{},'Education meeting notes'),C('i_emeet').length?C('i_emeet').map(x=>$('details',{class:'item',style:'display:block'},$('summary',{},fmtShort(x.date)+': '+x.title),$('div',{class:'pre'},x.summary),x.decisions?$('div',{class:'pre'},'Decisions: '+x.decisions):null,x.actions&&x.actions.length?$('div',{class:'note'},'Actions: '+x.actions.map(a=>a.text+' ('+a.owner+(a.due?', due '+fmtShort(a.due):'')+')').join('; ')):null,$('div',{class:'meta'},$('span',{class:'pill'},'added '+fmtT(x.created)+(x.by?' by '+x.by:'')),del('emeet',x.id)))):$('div',{class:'mute'},'No meeting notes yet.')))}

/* ---------- class plans ---------- */
function plansTab(m){
  const t=field('Plan name','text',120),sty=field('Class style (e.g. Reformer Flow)','text',60),lv=field('Level','text',40),mins=field('Minutes','text',10),lk=field('Link to full plan (optional)','url',400),pl=area('The plan: sequence, springs, cues, props...',3000);
  m.append($('div',{class:'card',style:'--tc:var(--c1)'},$('h2',{},'Add a class plan'),$('div',{class:'form'},t,$('div',{class:'r'},sty,lv,mins),pl,lk,$('button',{onclick:()=>{if(!t.value.trim())return;content({kind:'plans',action:'add',title:t.value,style:sty.value,level:lv.value,mins:mins.value,plan:pl.value,link:lk.value})}},'Save plan'))));
  const by={};C('i_plans').forEach(p=>(by[p.style||'Other']=by[p.style||'Other']||[]).push(p));
  const card=$('div',{class:'card',style:'--tc:var(--c1)'},$('h2',{},'Class plans'));
  if(!Object.keys(by).length)card.append($('div',{class:'mute'},'No plans yet.'));
  Object.keys(by).sort().forEach(s=>{card.append($('h3',{style:'margin-top:10px'},s),...by[s].map(p=>$('details',{class:'item',style:'display:block'},$('summary',{},p.title+(p.level?' ('+p.level+')':'')+(p.mins?', '+p.mins+' min':'')),p.plan?$('div',{class:'pre'},p.plan):null,p.link?$('div',{style:'margin-top:6px'},link(p.link,'Open full plan')):null,$('div',{class:'meta'},$('span',{class:'pill'},'added '+fmtT(p.created)+(p.by?' by '+p.by:'')),del('plans',p.id)))))});
  m.append(card)}

/* ---------- resources ---------- */
function resourcesTab(m){
  const lb=field('Name','text',100),url=field('Link (Google Drive, YouTube, a website...)','url',400),cat=field('Category (e.g. Anatomy, Music, Forms)','text',40),nt=field('Note (optional)','text',200);
  m.append($('div',{class:'card',style:'--tc:var(--c3)'},$('h2',{},'Share a resource'),$('div',{class:'form'},lb,url,$('div',{class:'r'},cat,nt),$('button',{onclick:()=>{if(!lb.value.trim()||!url.value.trim())return;content({kind:'resources',action:'add',label:lb.value,url:url.value,cat:cat.value,note:nt.value})}},'Add resource')),$('div',{class:'note'},'Upload the file to Google Drive first, set sharing so the team can open it, then paste the link here.')));
  const by={};C('i_res').forEach(r=>(by[r.cat||'General']=by[r.cat||'General']||[]).push(r));
  const card=$('div',{class:'card',style:'--tc:var(--c3)'},$('h2',{},'Resources'));
  if(!Object.keys(by).length)card.append($('div',{class:'mute'},'No resources yet.'));
  Object.keys(by).sort().forEach(c=>{card.append($('h3',{style:'margin-top:10px'},c),...by[c].map(r=>$('div',{class:'item'},$('div',{class:'body'},link(r.url,r.label),r.note?$('div',{class:'note'},r.note):null),del('resources',r.id))))});
  m.append(card)}

/* ---------- availability ---------- */
const first1=n=>String(n||'').split(/\s+/)[0].toLowerCase();
const uRange=u=>fmtShort(u.from)+(u.to&&u.to!==u.from?' to '+fmtShort(u.to):'');
const allDay=u=>!u.when||/all day/i.test(u.when);
function uClashes(u){return allDay(u)?D.rows.filter(r=>!r.cover&&r.instructor&&first1(r.instructor)===first1(u.name)&&r.date>=u.from&&r.date<=(u.to||u.from)):[]}
function availTab(m){
  const names=[...new Set(['Tyson','Nichola'].concat(D.names||[]))].sort();
  const nm=$('select',{},$('option',{value:''},'Your name'),names.map(n=>$('option',{value:n},n)));nm.value=names.includes(getWho())?getWho():'';
  const f=$('input',{type:'date'}),t=$('input',{type:'date',title:'Last day (leave blank for one day)'});
  const wh=$('select',{},['All day','Mornings only','Afternoons and evenings only','Certain times (add them in the note)'].map(x=>$('option',{value:x},x)));
  const nt=field('Note (optional, no health details please)','text',200);
  m.append($('div',{class:'card',style:'--tc:var(--c4)'},$('h2',{},'Add when you are unavailable'),$('div',{class:'form'},nm,
    $('div',{class:'r'},$('label',{class:'mute'},'First day',f),$('label',{class:'mute'},'Last day (if more than one)',t)),wh,nt,
    $('button',{onclick:()=>{if(!nm.value||!f.value){alert('Choose your name and the first day');return}setWho(nm.value);content({kind:'unavail',action:'add',name:nm.value,from:f.value,to:t.value,when:wh.value,note:nt.value})}},'Save')),
    $('div',{class:'note'},'Nichola uses this when she builds the roster, and any classes it clashes with are flagged below. Add anything you already know about, including holidays and appointments. You only need to say you are away, not why.')));
  const today=todayAEST(),all=C('i_unavail').slice().sort((a,b)=>a.from.localeCompare(b.from)),up=all.filter(u=>(u.to||u.from)>=today),past=all.filter(u=>(u.to||u.from)<today).reverse();
  const row=u=>{const cl=uClashes(u);return $('div',{class:'item'},$('div',{class:'body'},$('div',{class:'t'},u.name+': '+uRange(u)),$('div',{class:'meta'},$('span',{class:'pill'},u.when||'All day'),cl.length?$('span',{class:'pill r'},'Clashes with '+cl.length+' scheduled class'+(cl.length===1?'':'es')):null),u.note?$('div',{class:'note pre'},u.note):null,
    cl.length?$('div',{class:'note'},cl.slice(0,6).map(r=>fmtShort(r.date)+' '+r.label+' '+shortStyle(r.style)).join(', ')+(cl.length>6?' and more':'')):null,
    cl.length&&isMgr()?$('button',{class:'ghost',style:'margin-top:6px',onclick:async()=>{if(!confirm('Mark these '+cl.length+' classes as cover needed?'))return;for(const r of cl.filter(r=>r.date>=todayAEST())){if(!await roster({action:'needcover',id:r.id,note:'Away: '+u.name}))break}}},'Mark these as cover needed'):null),del('unavail',u.id))};
  m.append($('div',{class:'card wide',style:'--tc:var(--c4)'},$('h2',{},'Upcoming unavailability'),up.length?up.map(row):$('div',{class:'mute'},'Nobody has added anything yet.'),past.length?$('details',{style:'margin-top:10px'},$('summary',{},past.length+' past'),past.map(row)):null))}

/* ---------- events ---------- */
function eventsTab(m){
  const t=field('Event name','text',120),d=$('input',{type:'date'}),tm=field('Time (optional)','text',40),dt=area('Details',800);
  m.append($('div',{class:'card',style:'--tc:var(--c2)'},$('h2',{},'Add a studio event'),$('div',{class:'form'},t,$('div',{class:'r'},d,tm),dt,$('button',{onclick:()=>{if(!t.value.trim()||!d.value){alert('Add a name and a date');return}content({kind:'events',action:'add',title:t.value,date:d.value,time:tm.value,details:dt.value})}},'Add event'))));
  const today=todayAEST(),all=C('i_events').slice().sort((a,b)=>a.date.localeCompare(b.date)),up=all.filter(e=>e.date>=today),past=all.filter(e=>e.date<today).reverse();
  const row=e=>$('div',{class:'item'},$('div',{class:'body'},$('div',{class:'t'},fmtShort(e.date)+(e.time?', '+e.time:'')+': '+e.title),e.details?$('div',{class:'note pre'},e.details):null),del('events',e.id));
  m.append($('div',{class:'card',style:'--tc:var(--c2)'},$('h2',{},'Coming up'),up.length?up.map(row):$('div',{class:'mute'},'Nothing coming up.'),past.length?$('details',{style:'margin-top:10px'},$('summary',{},past.length+' past'),past.map(row)):null))}

/* ---------- client notes ---------- */
function clientsTab(m){
  const nm=field('Client full name','text',80),nt=area('Note (no phone numbers, emails or health details)',800),fu=$('input',{type:'date',title:'Follow-up date'});
  const hot=$('input',{type:'checkbox'});
  m.append($('div',{class:'card',style:'--tc:var(--c2)'},$('h2',{},'Add a client note'),whoPicker(),$('div',{class:'form'},nm,nt,$('div',{class:'r'},fu,$('label',{class:'mute',style:'display:flex;gap:6px;align-items:center'},hot,'Hot lead (goes to Anna)')),$('button',{onclick:()=>{if(!nm.value.trim()||!nt.value.trim())return;content({kind:'cnotes',action:'add',client:nm.value,note:nt.value,follow:fu.value,hot:hot.checked})}},'Save note')),
    $('div',{class:'note'},'Full names are fine. Please keep phone numbers, emails and health details in ClubReady. A hot lead needs a follow-up date and appears in the manager dashboard Hot leads box.')));
  const f=$('input',{type:'text',placeholder:'Search by name',value:clientFilter});f.addEventListener('input',()=>{clientFilter=f.value;list.replaceChildren(...rows())});
  const rows=()=>C('i_cnotes').filter(x=>!clientFilter||x.client.toLowerCase().includes(clientFilter.toLowerCase())).map(x=>$('div',{class:'item'},$('div',{class:'body'},$('div',{class:'t'},x.client),$('div',{class:'pre'},x.note),$('div',{class:'meta'},x.hot?$('span',{class:'pill a'},'hot lead'):null,x.follow?$('span',{class:'pill'},'follow up '+fmtShort(x.follow)):null,$('span',{class:'pill'},fmtT(x.created)+(x.by?' by '+x.by:'')))),del('cnotes',x.id)));
  const list=$('div',{});list.append(...rows());
  m.append($('div',{class:'card',style:'--tc:var(--c2)'},$('h2',{},'Client notes'),$('div',{class:'form'},f),list))}

function render(){
  const tb=document.getElementById('tabs');tb.replaceChildren(...TABS.map(([k,l])=>$('button',{class:'ghost'+(tab===k?' on':''),onclick:()=>{tab=k;location.hash=k;render()}},l+(k==='changes'&&D&&D.changes.filter(c=>!c.done).length?' ('+D.changes.filter(c=>!c.done).length+')':''))),$('a',{href:'/',style:'align-self:center;margin-left:6px'},'Manager dashboard'));
  const m=document.getElementById('main');m.replaceChildren();
  if(!D)return;
  const nb=noticeboard();if(nb)m.append(nb);
  ({schedule:scheduleTab,changes:changesTab,tasks:tasksTab,education:educationTab,lead:leadTab,avail:availTab,plans:plansTab,resources:resourcesTab,events:eventsTab,clients:clientsTab}[tab]||scheduleTab)(m);
  document.getElementById('status').textContent='ClubReady checked '+fmtT(D.at)}
function fromHash(){const h=location.hash.slice(1);if(TABS.some(t=>t[0]===h))tab=h}
window.addEventListener('hashchange',()=>{fromHash();render()});
(async()=>{fromHash();const j=await api('/api/instructors/data');if(j){D=j;render()}})();
</script></body></html>`;

// ---------- email intake ----------
// The "Dashboard email tasks" scheduled task posts tasks here from labelled Gmail threads.
// Protected by the INTAKE_KEY secret (header x-intake-key), not the team passcode.
// Each {ref, text} pair is only ever added once, so re-runs never duplicate a task.
async function handleIntake(request, env) {
  const given = request.headers.get('x-intake-key') || '';
  if (!env.INTAKE_KEY || !given || !safeEqual(await hmacHex(env.INTAKE_KEY, 'intake:' + given), await hmacHex(env.INTAKE_KEY, 'intake:' + env.INTAKE_KEY))) {
    return Response.json({ error: 'Not allowed' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const items = (Array.isArray(body.tasks) ? body.tasks : []).slice(0, 40);
  let todos = (await getJSON(env, 'todos')) || [];
  let log = (await getJSON(env, 'todolog')) || [];
  let refs = (await getJSON(env, 'intakerefs')) || [];
  const now = Date.now(), added = [], skipped = [];
  for (const a of items) {
    const text = String((a && a.text) || '').trim().slice(0, 300);
    if (!text) continue;
    const ref = String(a.ref || '').trim().slice(0, 120);
    const key = ref + '|' + text.toLowerCase();
    if (ref && refs.includes(key)) { skipped.push(text); continue; }
    const t = {
      id: crypto.randomUUID(), text,
      owner: OWNERS.includes(a.owner) ? a.owner : 'Anyone',
      due: /^\d{4}-\d{2}-\d{2}$/.test(a.due || '') ? a.due : '',
      notes: ('From email. ' + String(a.notes || '').trim()).trim().slice(0, 1000),
      done: false, created: now, createdBy: 'Email', doneAt: null, doneBy: '', ref,
    };
    todos.unshift(t);
    log.unshift({ at: now, who: 'Email', action: 'added', id: t.id, text: text.slice(0, 120), detail: 'From a labelled email' });
    if (ref) refs.push(key);
    added.push(text);
  }
  if (added.length) {
    trimTodos(todos);
    await putJSON(env, 'todos', todos);
    await putJSON(env, 'todolog', log.slice(0, 1000));
    await putJSON(env, 'intakerefs', refs.slice(-2000));
  }
  return Response.json({ added, skipped });
}

// ---------- routes ----------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!env.DASH_PASSCODE || !env.STUDIO) {
      return new Response(pageShell('Setup needed', '<h2>Setup not finished</h2><p>The passcode or storage has not been added in Cloudflare yet.</p>'), { status: 503, headers: { 'content-type': 'text/html;charset=utf-8' } });
    }
    if (url.pathname === '/api/intake' && request.method === 'POST') return handleIntake(request, env);
    if (url.pathname === '/login' && request.method === 'POST') {
      const form = await request.formData().catch(() => null);
      const given = form ? String(form.get('passcode') || '') : '';
      const ok = safeEqual(await hmacHex(env.DASH_PASSCODE, 'login:' + given), await hmacHex(env.DASH_PASSCODE, 'login:' + env.DASH_PASSCODE));
      if (!ok) return new Response(loginPage('That passcode did not work.'), { status: 401, headers: { 'content-type': 'text/html;charset=utf-8' } });
      const token = await hmacHex(env.DASH_PASSCODE, 'studio-dashboard-v1');
      return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': `sd=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` } });
    }
    if (!(await isSignedIn(request, env))) {
      if (url.pathname.startsWith('/api/')) return Response.json({ error: 'Sign in first' }, { status: 401 });
      return new Response(loginPage(), { status: 200, headers: { 'content-type': 'text/html;charset=utf-8' } });
    }
    if (request.method === 'POST') {
      const origin = request.headers.get('Origin');
      if (origin && new URL(origin).host !== url.host) return Response.json({ error: 'Blocked' }, { status: 403 });
    }
    if (url.pathname === '/instructors' || url.pathname === '/instructors/') {
      return new Response(INSTRUCTOR_HTML, { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } });
    }
    if (url.pathname.startsWith('/api/instructors/')) return handleInstrApi(request, env, url);
    if (url.pathname === '/api/data') {
      const [summary, classes, todos, meta, job, todolog, laze, links, meetings, recurring, checklist, checks, snaps] = await Promise.all(['summary', 'classes', 'todos', 'meta', 'job', 'todolog', 'laze', 'links', 'meetings', 'recurring', 'checklist', 'checks', 'snaps'].map((k) => getJSON(env, k)));
      if (summary) { const mt = movementMtd(snaps, Date.now()); if (mt) { summary.movement = summary.movement || {}; summary.movement.mtd = mt; } }
      return Response.json({ summary, classes, todos: todos || [], todolog: todolog || [], laze: laze || null, meetings: Array.isArray(meetings) ? meetings : [], recurring: Array.isArray(recurring) ? recurring : [], checklist: await loadChecklist(env), checks: checks || {}, links: Array.isArray(links) ? links : DEFAULT_LINKS, meta: meta || {}, job: job ? { phase: job.phase, page: job.page, idx: job.idx, total: job.cands ? job.cands.length : 0, errors: job.errors || 0 } : null }, { headers: { 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/api/todos' && request.method === 'POST') return handleTodos(request, env);
    if (url.pathname === '/api/links' && request.method === 'POST') return handleLinks(request, env);
    if (url.pathname === '/api/meetings' && request.method === 'POST') return handleMeetings(request, env);
    if (url.pathname === '/api/recurring' && request.method === 'POST') return handleRecurring(request, env);
    if (url.pathname === '/api/checklist' && request.method === 'POST') return handleChecklist(request, env);
    if (url.pathname === '/api/refresh' && request.method === 'POST') {
      const meta = (await getJSON(env, 'meta')) || {};
      if (meta.lastForce && Date.now() - meta.lastForce < 5 * 60 * 1000) return Response.json({ ok: true, note: 'Already refreshed in the last 5 minutes' });
      meta.lastForce = Date.now();
      await putJSON(env, 'meta', meta);
      ctx.waitUntil(runRefresh(env, { force: true }));
      return Response.json({ ok: true });
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(DASHBOARD_HTML, { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } });
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => { try { await runRecurring(env); } catch (e) { /* never block the refresh */ } await runRefresh(env); })());
  },
};

// Exported for the local tests only.
export { loadChecklist, handleInstrApi, instrCompare, parseSheet, normaliseSheetUrl, csvRows, sheetDate, startMins, handleTodos, INSTRUCTOR_HTML, DASHBOARD_HTML, runRefresh, classifyMember, sourceGroup, parseDate, maybeLaze, occurrence, runRecurring, DEFAULT_CHECKLIST, DEFAULT_RECURRING };
