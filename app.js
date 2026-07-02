/* ============================================================
   Schema Score Experience — app.js
   State machine driving 4 screens (INPUT → SCANNING → RESULTS → ERROR)
   ============================================================ */

const CONFIG = {
  CTA_URL: 'https://calendly.com/leanlabs',
  AEO_URL: 'https://www.leanlabs.com/aeo-accelerator',
  BRAND_NAME: 'Lean Labs',
};

// ── Grade color map ─────────────────────────────────────────
const GRADE_COLORS = {
  'A+': '#ffffff',
  'A':  '#ffffff',
  'B+': 'rgba(255,255,255,0.9)',
  'B':  'rgba(255,255,255,0.9)',
  'C+': 'rgba(255,255,255,0.85)',
  'C':  'rgba(255,255,255,0.85)',
  'D+': 'rgba(255,255,255,0.78)',
  'D':  'rgba(255,255,255,0.78)',
  'F':  'rgba(255,255,255,0.72)',
};
const REPORT_ROUTE_PREFIX = '/report/';

// ── State ────────────────────────────────────────────────────
let state = 'INPUT';  // INPUT | SCANNING | RESULTS | ERROR
let stepTimer = null;
let currentStep = 0;
let currentReport = null;   // last rendered report object
let currentReportUrl = null; // URL associated with currentReport
let currentAuditDate = null; // ISO date of when currentReport was generated

// ── DOM refs ─────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const yearEl = $('#currentYear');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  $('#scoreBtn').addEventListener('click', handleScore);
  const rerunBtn = $('#rerunBtn');
  const shareBtn = $('#shareBtn');
  $('#urlField').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleScore();
  });
  if (rerunBtn) {
    rerunBtn.addEventListener('click', handleRerun);
  }
  if (shareBtn) {
    shareBtn.addEventListener('click', shareReport);
  }
  const modalCloseBtn = $('#modalCloseBtn');
  const modalBackdrop = $('#modalBackdrop');
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeModal();
    });
  }
  const meetingModalBackdrop = $('#meetingModalBackdrop');
  const meetingModalCloseBtn = $('#meetingModalCloseBtn');
  if (meetingModalCloseBtn) meetingModalCloseBtn.addEventListener('click', closeMeetingModal);
  if (meetingModalBackdrop) {
    meetingModalBackdrop.addEventListener('click', (e) => {
      if (e.target === meetingModalBackdrop) closeMeetingModal();
    });
  }

  // CTA buttons
  $$('[data-cta="book"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openMeetingModal();
    });
  });
  $$('[data-cta="aeo"]').forEach((btn) => {
    btn.addEventListener('click', () => window.open(CONFIG.AEO_URL, '_blank'));
  });

  updateToolbarState();
  restoreInitialView();
});

// ── Screen transitions ───────────────────────────────────────
function showScreen(name) {
  $$('.screen').forEach((el) => {
    el.classList.remove('active');
  });
  state = name;

  let target;
  switch (name) {
    case 'INPUT':
      target = $('#screen-input');
      break;
    case 'SCANNING':
      target = $('#screen-scanning');
      break;
    case 'RESULTS':
      target = $('#screen-results');
      break;
    case 'ERROR':
      target = $('#screen-scanning');
      break;
  }
  if (target) {
    target.classList.add('active');
  }
}

// ── Handle score button ──────────────────────────────────────
async function handleScore() {
  const urlField = $('#urlField');
  const raw = urlField.value.trim();
  if (!raw) { urlField.focus(); return; }
  // Cache-aware: reuse a fresh cached report if one exists, else generate.
  await showReportForUrl(normalizeInputUrl(raw), { force: false });
}

// ── Rerun button ─────────────────────────────────────────────
async function handleRerun() {
  if (!currentReportUrl) return;
  await showReportForUrl(currentReportUrl, { force: true });
}

// ── Report orchestration ─────────────────────────────────────
// Cache-aware entry point used by the score button and ?run= param.
// Reuses an existing HubSpot report whenever the URL already has one
// (no expiry) so we never burn credits re-running. `force: true` (Rerun)
// always regenerates.
async function showReportForUrl(url, { force = false } = {}) {
  try {
    if (!force) {
      const cached = await fetchCachedReport(url);
      if (cached?.found && cached.report) {
        showReport(cached.report, cached.url || url, cached.auditDate);
        return;
      }
    }
    await generateAndSave(url);
  } catch (err) {
    completeAllSteps();
    showError('Analysis failed: ' + (err.message || 'Unknown error. Check local server/env config and try again.'));
    showScreen('ERROR');
  }
}

// Backward-compat: old share links use ?jobID={external_report_id}. Look the
// record up directly by jobID and render whatever is stored (any age) — this
// never generates a fresh score, it's purely a fetch of the old result.
async function loadReportByJobID(jobID) {
  const resp = await fetch(`/api/report?jobID=${encodeURIComponent(jobID)}`);
  if (!resp.ok) return false;
  const payload = await resp.json();
  if (!payload?.report) return false;
  showReport(payload.report, payload.url || '', payload.auditDate);
  return true;
}

// Direct navigation to /report/{url}: always show the cached report if one
// exists (regardless of age), so we never burn tokens just by visiting.
// Only generate when nothing is cached at all.
async function loadReportRoute(url) {
  try {
    const cached = await fetchCachedReport(url);
    if (cached?.found && cached.report) {
      showReport(cached.report, cached.url || url, cached.auditDate);
      return;
    }
    await generateAndSave(url);
  } catch (err) {
    completeAllSteps();
    showError('Could not load this report: ' + (err.message || 'Unknown error.'));
    showScreen('ERROR');
  }
}

// Runs a fresh score, persists it to HubSpot, then renders it.
async function generateAndSave(url) {
  hideError();
  resetScanSteps();
  $('#scanUrlText').textContent = displayHost(url);
  showScreen('SCANNING');
  startStepTimer();

  const result = await scoreUrl(url);
  completeAllSteps();
  await delay(800);

  let finalUrl = url;
  let auditDate = new Date().toISOString();
  try {
    const saved = await saveReport(url, result);
    if (saved?.hubspot?.url) finalUrl = saved.hubspot.url;
    if (saved?.hubspot?.auditDate) auditDate = saved.hubspot.auditDate;
  } catch (_) {
    // Still show the report even if persistence fails.
  }
  showReport(result, finalUrl, auditDate);
}

function showReport(report, url, auditDate) {
  currentReport = report;
  currentReportUrl = url;
  currentAuditDate = auditDate || null;
  renderResults(report, url);
  const field = $('#urlField');
  if (field) field.value = url;
  setReportRoute(url);
  updateLastRunText(auditDate);
  updateToolbarState();
  showScreen('RESULTS');
}

async function fetchCachedReport(url) {
  const resp = await fetch(`/api/resolve?url=${encodeURIComponent(url)}`);
  if (!resp.ok) return null;
  return resp.json();
}

// HubSpot date/datetime props may come back as epoch ms, epoch seconds, or ISO.
function parseAuditTs(value) {
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value === 'number') {
    return value < 1e12 ? value * 1000 : value;
  }
  const s = String(value).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return s.length <= 10 ? n * 1000 : n;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

// ── Scanning step timer ──────────────────────────────────────
const STEP_LABELS = [
  'Fetching page and extracting structured data',
  'Classifying page type',
  'Scoring the 7 things AI engines check',
  'Comparing against industry benchmarks',
  'Identifying gaps and generating fix plan',
];

function resetScanSteps() {
  currentStep = 0;
  const steps = $$('#scanSteps .scan-step');
  steps.forEach((step, i) => {
    step.className = 'scan-step';
    const check = step.querySelector('.scan-check');
    check.className = 'scan-check';
    check.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"/></svg>';
  });
  $('.scan-progress-fill').style.width = '0%';
}

function startStepTimer() {
  advanceStep();
  stepTimer = setInterval(() => {
    if (currentStep < STEP_LABELS.length) {
      advanceStep();
    } else {
      clearInterval(stepTimer);
    }
  }, 8000);
}

function advanceStep() {
  const steps = $$('#scanSteps .scan-step');
  const checks = $$('#scanSteps .scan-check');

  // Mark previous as done
  if (currentStep > 0) {
    const prev = currentStep - 1;
    steps[prev].className = 'scan-step done';
    checks[prev].className = 'scan-check done';
    checks[prev].innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
  }

  // Mark current as active
  if (currentStep < steps.length) {
    steps[currentStep].className = 'scan-step active';
    checks[currentStep].className = 'scan-check active';
    checks[currentStep].innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>';
  }

  // Update progress bar
  const pct = Math.min(((currentStep + 1) / STEP_LABELS.length) * 100, 95);
  $('.scan-progress-fill').style.width = pct + '%';

  currentStep++;
}

function completeAllSteps() {
  clearInterval(stepTimer);
  const steps = $$('#scanSteps .scan-step');
  const checks = $$('#scanSteps .scan-check');
  steps.forEach((step, i) => {
    step.className = 'scan-step done';
    checks[i].className = 'scan-check done';
    checks[i].innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
  });
  $('.scan-progress-fill').style.width = '100%';
}

// ── Error display ────────────────────────────────────────────
function showError(msg) {
  const el = $('#errorMsg');
  el.textContent = msg;
  el.classList.add('visible');
}
function hideError() {
  $('#errorMsg').classList.remove('visible');
}

// ── URL + route helpers ──────────────────────────────────────
// Canonicalize user input so leanlabs.com, www.leanlabs.com,
// http(s)://leanlabs.com and common protocol typos all map to one URL.
// Must stay in sync with normalizeLookupUrl() on the server.
function normalizeInputUrl(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^\s*https?\s*[;:]\s*\/\//i, '') // strip http(s):// and typos like "https;//"
    .replace(/^\/+/, '');
  const withProtocol = `https://${cleaned}`;
  try {
    const parsed = new URL(withProtocol);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    let pathname = parsed.pathname || '/';
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
    return `https://${hostname}${pathname}${parsed.search}`;
  } catch (_) {
    const fallback = cleaned.toLowerCase().replace(/^www\./, '').replace(/\/+$/, '');
    return `https://${fallback}`;
  }
}

function displayHost(url) {
  return String(url).replace(/^https?:\/\//i, '');
}

// Full URL → clean /report/{host+path} route (protocol stripped).
function urlToReportPath(url) {
  const bare = String(url).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return REPORT_ROUTE_PREFIX + bare;
}

// Current /report/{...} path → full https URL (or null when not on a report route).
function getReportUrlFromPath() {
  const path = window.location.pathname;
  if (!path.startsWith(REPORT_ROUTE_PREFIX)) return null;
  let rest = path.slice(REPORT_ROUTE_PREFIX.length);
  if (!rest) return null;
  try { rest = decodeURIComponent(rest); } catch (_) { /* keep raw */ }
  rest = rest.replace(/\/+$/, '');
  if (!rest) return null;
  return /^https?:\/\//i.test(rest) ? rest : `https://${rest}`;
}

function setReportRoute(url) {
  if (!url || !String(url).trim()) return;
  const target = window.location.origin + urlToReportPath(url);
  if (window.location.href !== target) {
    window.history.replaceState({}, '', target);
  }
}

// ── API call ─────────────────────────────────────────────────
async function scoreUrl(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 min

  try {
    const resp = await fetch('/api/score', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`API returned ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data = await resp.json();
    const raw = data?.result ?? data?.data?.result ?? null;
    let report = null;

    if (raw !== null && raw !== '') {
      report = extractJSON(raw);
    } else if (data && typeof data === 'object') {
      report = data;
    }

    if (!report || typeof report !== 'object') {
      throw new Error('No parseable result from API');
    }

    // Preserve server metadata so we can set and share jobID.
    if (data?.hubspot) report.hubspot = data.hubspot;
    if (data?.hubspotError) report.hubspotError = data.hubspotError;

    return report;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Analysis timed out. Please try again.');
    }
    throw err;
  }
}

// ── JSON extraction ──────────────────────────────────────────
function extractJSON(text) {
  if (typeof text !== 'string') {
    if (typeof text === 'object' && text !== null) return text;
    throw new Error('No parseable result from API');
  }

  // Strip scratchpad tags
  let cleaned = text.replace(/<scratchpad>[\s\S]*?<\/scratchpad>/gi, '');

  // Try direct parse
  try { return JSON.parse(cleaned); } catch (_) { /* continue */ }

  // Try extracting from code blocks
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()); } catch (_) { /* continue */ }
  }

  // Find first { and last }
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch (_) { /* continue */ }
  }

  throw new Error('Could not parse JSON from agent response');
}

// ── Render results ───────────────────────────────────────────
function renderResults(data, url) {
  // The agent might return varied shapes; normalize
  const overall = data.overall || data.score || {};
  const grade = overall.grade || data.grade || 'N/A';
  const score = overall.score ?? data.score_value ?? data.total_score ?? '?';
  const verdict = overall.verdict || data.verdict || data.summary || '';
  const dimensions = (data.dimensions || data.scores || data.dimension_scores || []).map((d) => ({
    ...d,
    rationale: d.rationale ?? d.why ?? null,
    evidence: d.evidence ?? d.currentSnippet ?? null,
    remediation: d.remediation ?? d.fixSnippet ?? null,
  }));
  const gaps = (data.gaps || data.missing || data.issues || []).map((g) => ({
    ...g,
    location: g.location ?? g.where ?? null,
    currentSnippet: g.currentSnippet ?? g.current ?? g.existing ?? null,
    fixSnippet: g.fixSnippet ?? g.fix ?? g.recommended ?? null,
  }));
  const fixPlan = data.fix_plan || data.fixes || data.recommendations || [];

  updateFixPlanVisibility(score);
  renderGrade(grade, score, verdict, url);
  renderDimensions(dimensions);
  renderGaps(gaps);
  renderFixPlan(fixPlan);
}

function renderGrade(grade, score, verdict, url) {
  const gradeStr = String(grade).toUpperCase().trim();
  const fallbackByGrade = {
    'A+': 98, 'A': 94, 'B+': 88, 'B': 82, 'C+': 74, 'C': 68, 'D+': 58, 'D': 52, 'F': 40,
  };
  const scoreNum = Number(score);
  const resolvedScore = Number.isFinite(scoreNum) ? scoreNum : (fallbackByGrade[gradeStr] ?? fallbackByGrade[gradeStr.charAt(0)] ?? 0);
  const clampedScore = Math.max(0, Math.min(100, resolvedScore));
  $('#gradeLetterEl').textContent = `${Math.round(clampedScore)}%`;
  $('#gradeScoreEl').textContent = 'Score';
  $('#gradeUrlEl').textContent = url.replace(/^https?:\/\//, '');
  $('#verdictEl').textContent = verdict || 'Analysis complete.';
  const readiness = $('#gradeReadinessEl');
  if (readiness) {
    readiness.textContent = clampedScore >= 80 ? 'AI-READY' : clampedScore >= 55 ? 'NEEDS ENRICHMENT' : 'AT RISK';
  }

  // Set gauge fill for the semi-circle.
  const gradeColor = GRADE_COLORS[gradeStr] || GRADE_COLORS[gradeStr.charAt(0)] || 'rgba(255,255,255,0.88)';
  const arc = $('#gaugeArcEl');
  if (arc) {
    const length = arc.getTotalLength();
    const visible = (clampedScore / 100) * length;
    arc.style.strokeDasharray = `${length}`;
    arc.style.strokeDashoffset = `${Math.max(length - visible, 0)}`;
    arc.style.stroke = gradeColor;
  }
}

// Human-readable verdict headlines per dimension, keyed by the canonical
// rubric name the scorer emits. Green rows read as a win, red rows as a
// consequence. Falls back to the raw name for unknown dimensions.
const DIMENSION_HEADLINES = {
  'code quality': {
    high: 'Your schema code is clean and valid',
    mid: 'Your code mostly works, but errors are weakening it',
    low: 'Code errors are breaking your schema',
  },
  'required types present': {
    high: 'Google sees your company, site, and page',
    mid: 'Google only sees part of your site',
    low: "Google can't see most of your site",
  },
  'correct type for page': {
    high: 'Your page tells AI exactly what it is',
    mid: "Your page isn't fully clear about what it is",
    low: "AI can't tell what kind of page this is",
  },
  'required fields filled': {
    high: 'Must-have details are complete',
    mid: 'Some must-have details are missing',
    low: 'Most must-have details are missing',
  },
  'recommended fields filled': {
    high: 'Trust signals are in place, building your authority',
    mid: 'Trust signals are missing, costing you authority',
    low: 'Trust signals are missing, costing you authority',
  },
  'entity connections': {
    high: 'AI can reliably reference your brand',
    mid: 'AI can only partly reference your brand',
    low: "AI can't reliably reference your brand",
  },
  'ai answer visibility': {
    high: 'Strong signals for showing up in AI answers',
    mid: "You're missing some signals AI engines look for",
    low: "You're missing the signals AI engines look for",
  },
};

function dimensionHeadline(name, level) {
  const copy = DIMENSION_HEADLINES[String(name).toLowerCase().trim()];
  return (copy && copy[level]) || name;
}

function renderDimensions(dims) {
  const container = $('#dimensionsContainer');
  container.innerHTML = '';

  // Handle array or object
  let entries = [];
  if (Array.isArray(dims)) {
    entries = dims.map((d) => ({
      ...d,
      name: d.name || d.dimension || d.label || 'Unknown',
      score: d.score ?? d.value ?? 0,
      max: d.max ?? 100,
      pct: d.pct ?? (d.max ? Math.round(((d.score ?? 0) / d.max) * 100) : (d.score ?? 0)),
    }));
  } else if (typeof dims === 'object') {
    entries = Object.entries(dims).map(([k, v]) => ({
      ...(typeof v === 'object' ? v : {}),
      name: k,
      score: typeof v === 'object' ? (v.score ?? v.value ?? 0) : v,
      max: typeof v === 'object' ? (v.max ?? 100) : 100,
      pct: typeof v === 'object' ? (v.pct ?? v.score ?? 0) : v,
    }));
  }

  // Fallback 7 dimensions if empty
  if (entries.length === 0) {
    entries = [
      { name: 'Type Coverage', score: 0 },
      { name: 'Property Depth', score: 0 },
      { name: 'Correctness', score: 0 },
      { name: 'Rich Result Ready', score: 0 },
      { name: 'Freshness', score: 0 },
      { name: 'Interlinking', score: 0 },
      { name: 'Competitive Edge', score: 0 },
    ];
  }

  entries.forEach((dim, index) => {
    const pct = Math.max(0, Math.min(100, Number(dim.pct) || 0));
    const level = pct < 40 ? 'low' : pct < 70 ? 'mid' : 'high';
    const headline = dimensionHeadline(dim.name, level);
    dim.headline = headline;
    const scoreLabel = `${pct}%`;
    const row = document.createElement('div');
    row.className = 'dimension-row';
    row.style.animationDelay = `${index * 0.08}s`;
    row.innerHTML = `
      <div class="dimension-main">
        <span class="dimension-dot ${level}"></span>
        <span class="dimension-name">${esc(headline)}</span>
      </div>
      <div class="dimension-bar-track"><div class="dimension-bar-fill ${level}" style="width: ${pct}%;"></div></div>
      <span class="dimension-score ${level}">${scoreLabel}</span>
      <span class="dimension-expand-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m9 7-5 5 5 5"/>
          <path d="m15 7 5 5-5 5"/>
        </svg>
      </span>
    `;
    row.addEventListener('click', () => openDimModal(dim));
    container.appendChild(row);
  });
}

function renderGaps(gaps) {
  const container = $('#gapsContainer');
  const moreEl = $('#gapsMore');
  container.innerHTML = '';

  let items = [];
  if (Array.isArray(gaps)) {
    items = gaps;
  } else if (typeof gaps === 'object') {
    items = Object.entries(gaps).map(([k, v]) => ({ title: k, description: typeof v === 'string' ? v : v.description || '' }));
  }

  const top4 = items.slice(0, 4);
  const remaining = items.length - 4;

  top4.forEach((gap, i) => {
    const isHigh = (gap.priority || '').toLowerCase() === 'high' || (gap.priority || '').toLowerCase() === 'critical' || i < 2;
    const priority = isHigh ? 'critical' : 'moderate';
    const label = isHigh ? 'Missing' : 'Needs work';
    const card = document.createElement('div');
    card.className = `gap-card ${priority}`;
    card.innerHTML = `
      <div class="gap-priority ${priority}">${label}</div>
      <h4>${esc(gap.title || gap.name || gap.issue || 'Issue ' + (i + 1))}</h4>
      <p>${esc(gap.description || gap.detail || gap.details || '')}</p>
      <div class="gap-cta">View fix code &rarr;</div>
    `;
    card.addEventListener('click', () => openGapModal(gap));
    container.appendChild(card);
  });

  if (remaining > 0) {
    moreEl.textContent = `+ ${remaining} more issues in full report`;
    moreEl.style.display = 'block';
  } else {
    moreEl.style.display = 'none';
  }
}

function renderFixPlan(fixes) {
  const container = $('#fixPlanContainer');
  container.innerHTML = '';

  let items = [];
  if (Array.isArray(fixes)) {
    items = fixes;
  } else if (typeof fixes === 'object') {
    items = Object.entries(fixes).map(([k, v]) => ({ title: k, description: typeof v === 'string' ? v : v.description || '' }));
  }

  if (items.length === 0) {
    items = [
      { title: 'Detailed fixes will appear here', description: 'Book a review to get your personalized fix plan.' },
    ];
  }

  items.forEach((fix, i) => {
    const el = document.createElement('div');
    el.className = 'fix-item';
    const heading = fix.action || fix.title || fix.name || 'Fix ' + (i + 1);
    const detail = fix.impact ? `Estimated impact: ${fix.impact}. ${fix.effort || ''}`.trim() : (fix.description || fix.detail || '');
    el.innerHTML = `
      <div class="fix-number">${fix.step || i + 1}</div>
      <div>
        <h4>${esc(heading)}</h4>
        <p>${esc(detail)}</p>
      </div>
    `;
    container.appendChild(el);
  });
}

// ── Helpers ──────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Modal: dimension detail ─────────────────────────────────
function openDimModal(dim) {
  const pct = Number(dim.pct ?? (dim.max ? Math.round((dim.score / dim.max) * 100) : 0));
  const verdict = pct === 100 ? 'Perfect score' : pct >= 70 ? 'Mostly there' : pct >= 40 ? 'Halfway there' : 'Needs work';
  const rationale = dim.rationale || 'Detail not available.';

  let html = `
    <div class="modal-header">
      <span class="modal-badge">Score Detail</span>
    </div>
    <h2 id="modalTitle">${esc(dim.headline || dim.name)}</h2>
    <div class="modal-score-line">
      <span class="modal-score-pill">${esc(String(dim.score ?? 0))} / ${esc(String(dim.max ?? 100))}</span>
      <span>${esc(String(pct))}% &middot; ${esc(verdict)}</span>
    </div>
    <div class="modal-section">
      <div class="modal-section-label">Why this score</div>
      <div class="modal-rationale">${esc(String(rationale))}</div>
    </div>
  `;

  if (dim.evidence) {
    html += `
      <div class="modal-section">
        <div class="modal-section-label">Schema that earned the points</div>
        ${codeBlock(dim.evidence, 'found')}
      </div>
    `;
  }

  if (dim.remediation) {
    html += `
      <div class="modal-section">
        <div class="modal-section-label">Schema needed to reach max</div>
        ${codeBlock(dim.remediation, 'needed')}
      </div>
    `;
  }

  showModal(html);
}

// ── Modal: gap detail ───────────────────────────────────────
function openGapModal(gap) {
  const priority = String(gap.priority || '').toLowerCase();
  const isHigh = priority === 'high' || priority === 'critical';
  const badgeLabel = isHigh ? 'High Impact Gap' : 'Moderate Gap';
  const isMissing = gap.currentSnippet === null || gap.currentSnippet === undefined;

  let html = `
    <div class="modal-header">
      <span class="modal-badge ${isHigh ? 'high' : 'moderate'}">${badgeLabel}</span>
    </div>
    <h2 id="modalTitle">${esc(gap.title || gap.name || 'Gap')}</h2>
    <p class="modal-description">${esc(gap.description || '')}</p>
  `;

  if (gap.location) {
    html += `
      <div class="modal-section">
        <div class="modal-section-label">Where it lives</div>
        <span class="modal-location">${esc(gap.location)}</span>
      </div>
    `;
  }

  html += `
    <div class="modal-section">
      <div class="modal-section-label">${isMissing ? 'Current state' : 'Current schema'}</div>
      ${isMissing
        ? `<div class="code-block missing">&mdash; No schema for this exists on the page &mdash;</div>`
        : codeBlock(gap.currentSnippet, 'found')}
    </div>
  `;

  if (gap.fixSnippet) {
    html += `
      <div class="modal-section">
        <div class="modal-section-label">Drop-in fix</div>
        ${codeBlock(gap.fixSnippet, 'needed')}
      </div>
    `;
  }

  showModal(html);
}

// ── Modal helpers ───────────────────────────────────────────
function codeBlock(code, variant) {
  const raw = typeof code === 'string' ? code : JSON.stringify(code, null, 2);
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `
    <div class="code-block ${variant}">
      <button class="code-copy" type="button" onclick="copyCode(this)">Copy</button>
      <code>${escaped}</code>
    </div>
  `;
}

function copyCode(btn) {
  const code = btn.nextElementSibling.textContent;
  navigator.clipboard.writeText(code).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = orig), 1500);
  });
}

function showModal(html) {
  const content = $('#modalContent');
  const backdrop = $('#modalBackdrop');
  if (!content || !backdrop) return;
  content.innerHTML = html;
  backdrop.classList.add('open');
  syncBodyScrollLock();
}

function closeModal() {
  const backdrop = $('#modalBackdrop');
  if (!backdrop) return;
  backdrop.classList.remove('open');
  syncBodyScrollLock();
}

function openMeetingModal() {
  const backdrop = $('#meetingModalBackdrop');
  if (!backdrop) return;
  backdrop.classList.add('open');
  syncBodyScrollLock();
}

function closeMeetingModal() {
  const backdrop = $('#meetingModalBackdrop');
  if (!backdrop) return;
  backdrop.classList.remove('open');
  syncBodyScrollLock();
}

function syncBodyScrollLock() {
  const hasOpenModal = $('#modalBackdrop')?.classList.contains('open') || $('#meetingModalBackdrop')?.classList.contains('open');
  document.body.style.overflow = hasOpenModal ? 'hidden' : '';
}

function updateFixPlanVisibility(score) {
  const fixPlanSection = document.querySelector('.results-fixplan-section');
  if (!fixPlanSection) return;
  const numericScore = Number(score);
  const isPerfectScore = Number.isFinite(numericScore) && Math.round(numericScore) >= 100;
  fixPlanSection.style.display = isPerfectScore ? 'none' : '';
}

// ── Initial view routing ─────────────────────────────────────
// Priority: /report/{url} path → ?run={url} param → homepage input.
async function restoreInitialView() {
  const params = new URLSearchParams(window.location.search);

  // 1. Legacy ?jobID= links — fetch the stored result directly (never re-runs).
  const jobID = params.get('jobID');
  if (jobID && jobID.trim()) {
    try {
      if (await loadReportByJobID(jobID.trim())) return;
    } catch (_) { /* fall through to other resolution paths */ }
  }

  // 2. /report/{url} — pull the cached report from HubSpot (any age).
  const reportUrl = getReportUrlFromPath();
  if (reportUrl) {
    await loadReportRoute(reportUrl);
    return;
  }

  // 3. ?run={url} — auto-run (cache-aware, reuses a fresh cached report).
  const runParam = params.get('run');
  if (runParam && runParam.trim()) {
    await showReportForUrl(normalizeInputUrl(runParam), { force: false });
    return;
  }

  showScreen('INPUT');
}

// Enable the rerun/share buttons only when a report is on screen.
function updateToolbarState() {
  const hasReport = Boolean(currentReport);
  const rerunBtn = $('#rerunBtn');
  const shareBtn = $('#shareBtn');
  if (rerunBtn) rerunBtn.disabled = !hasReport;
  if (shareBtn) shareBtn.disabled = !hasReport;
}

function updateLastRunText(auditDate) {
  const el = $('#lastRunText');
  if (!el) return;
  const ts = parseAuditTs(auditDate);
  if (!Number.isFinite(ts)) {
    el.textContent = '';
    return;
  }
  const formatted = new Date(ts).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).replace(/\b(am|pm)\b/gi, (m) => m.toUpperCase());
  el.textContent = `Last run ${formatted}`;
}

// Copies the shareable /report/{url} link for the current report.
async function shareReport() {
  const btn = $('#shareBtn');
  if (!btn || !currentReportUrl) return;
  const shareUrl = window.location.origin + urlToReportPath(currentReportUrl);
  try {
    await navigator.clipboard.writeText(shareUrl);
    showButtonFeedback(btn, 'Link Copied!', 1500);
  } catch (_) {
    showButtonFeedback(btn, 'Copy Failed', 1500);
  }
}

async function saveReport(url, report) {
  const resp = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, report }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Save failed ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

function showButtonFeedback(btn, label, durationMs) {
  const labelEl = ensureButtonLabelElement(btn);
  const resting = btn.dataset.label || labelEl.textContent;
  btn.dataset.feedbackActive = 'true';
  labelEl.textContent = label;
  btn.disabled = true;
  setTimeout(() => {
    delete btn.dataset.feedbackActive;
    labelEl.textContent = resting;
    updateToolbarState();
  }, durationMs);
}

function ensureButtonLabelElement(btn) {
  const existing = btn.querySelector('[data-btn-label]');
  if (existing) return existing;

  const labelText = btn.textContent.replace(/\s+/g, ' ').trim();
  btn.dataset.label = labelText;

  // Keep icon nodes intact and move label text into a dedicated span.
  Array.from(btn.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) node.remove();
  });

  const labelEl = document.createElement('span');
  labelEl.setAttribute('data-btn-label', 'true');
  labelEl.textContent = labelText;
  btn.appendChild(labelEl);
  return labelEl;
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('#meetingModalBackdrop')?.classList.contains('open')) {
    closeMeetingModal();
    return;
  }
  if ($('#modalBackdrop')?.classList.contains('open')) {
    closeModal();
  }
});

window.copyCode = copyCode;
