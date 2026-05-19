/* ============================================================
   Schema Score Experience — app.js
   State machine driving 4 screens (INPUT → SCANNING → RESULTS → ERROR)
   ============================================================ */

const CONFIG = {
  API_URL: 'https://factor8-agent-sdk.fly.dev/api/v1/brand-slug/lean-labs/query',
  API_KEY: '594aa935e360c9bf28f97437c1dddea9',
  CTA_URL: 'https://calendly.com/leanlabs',
  AEO_URL: 'https://www.leanlabs.com/aeo-accelerator',
  BRAND_NAME: 'Lean Labs',
};

// ── Grade color map ─────────────────────────────────────────
const GRADE_COLORS = {
  'A+': '#6bc950',
  'A':  '#6bc950',
  'B+': '#7612fa',
  'B':  '#7612fa',
  'C+': '#f59e0b',
  'C':  '#f59e0b',
  'D+': '#ff6221',
  'D':  '#ff6221',
  'F':  '#ef4444',
};

// ── State ────────────────────────────────────────────────────
let state = 'INPUT';  // INPUT | SCANNING | RESULTS | ERROR
let stepTimer = null;
let currentStep = 0;

// ── DOM refs ─────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  $('#scoreBtn').addEventListener('click', handleScore);
  $('#urlField').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleScore();
  });

  // CTA buttons
  $$('[data-cta="book"]').forEach((btn) => {
    btn.addEventListener('click', () => window.open(CONFIG.CTA_URL, '_blank'));
  });
  $$('[data-cta="aeo"]').forEach((btn) => {
    btn.addEventListener('click', () => window.open(CONFIG.AEO_URL, '_blank'));
  });

  showScreen('INPUT');
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

  // Basic URL normalization
  let url = raw;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  // Reset & go to scanning
  hideError();
  resetScanSteps();
  $('#scanUrlText').textContent = url.replace(/^https?:\/\//, '');
  showScreen('SCANNING');
  startStepTimer();

  try {
    const result = await scoreUrl(url);
    completeAllSteps();
    await delay(1000);
    renderResults(result, url);
    showScreen('RESULTS');
  } catch (err) {
    completeAllSteps();
    showError('Analysis failed: ' + (err.message || 'Unknown error. Check API key and try again.'));
    showScreen('ERROR');
  }
}

// ── Scanning step timer ──────────────────────────────────────
const STEP_LABELS = [
  'Fetching page and extracting structured data',
  'Classifying page type',
  'Scoring against 7 quality dimensions',
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

// ── API call ─────────────────────────────────────────────────
async function scoreUrl(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 min

  try {
    const resp = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': CONFIG.API_KEY,
      },
      body: JSON.stringify({
        prompt: `Score this URL: ${url}`,
        agent: 'schema-score-experience',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`API returned ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data = await resp.json();
    const raw = data.result || data.data?.result || '';
    return extractJSON(raw);
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
    rationale: d.rationale ?? null,
    evidence: d.evidence ?? null,
    remediation: d.remediation ?? null,
  }));
  const gaps = (data.gaps || data.missing || data.issues || []).map((g) => ({
    ...g,
    location: g.location ?? null,
    currentSnippet: g.currentSnippet ?? null,
    fixSnippet: g.fixSnippet ?? null,
  }));
  const fixPlan = data.fix_plan || data.fixes || data.recommendations || [];

  renderGrade(grade, score, verdict, url);
  renderDimensions(dimensions);
  renderGaps(gaps);
  renderFixPlan(fixPlan);
}

function renderGrade(grade, score, verdict, url) {
  const gradeStr = String(grade).toUpperCase().trim();
  $('#gradeLetterEl').textContent = grade;
  $('#gradeScoreEl').textContent = (typeof score === 'number' ? score : score) + '/100';
  $('#gradeUrlEl').textContent = url.replace(/^https?:\/\//, '');
  $('#verdictEl').textContent = verdict || 'Analysis complete.';

  // Set grade-specific glow color
  const gradeColor = GRADE_COLORS[gradeStr] || GRADE_COLORS[gradeStr.charAt(0)] || '#7612fa';
  const circle = $('#gradeCircle');
  if (circle) {
    circle.style.setProperty('--grade-color', gradeColor);
    circle.style.borderColor = gradeColor;
    circle.style.boxShadow = `0 0 40px ${gradeColor}33, 0 0 80px ${gradeColor}18`;
  }
}

function renderDimensions(dims) {
  const container = $('#dimensionsContainer');
  container.innerHTML = '';

  // Handle array or object — preserve all fields (rationale, evidence, remediation)
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
    const scoreLabel = dim.max && dim.max !== 100 ? `${dim.score}/${dim.max}` : `${pct}`;
    const row = document.createElement('div');
    row.className = 'dimension-row';
    row.style.animationDelay = `${index * 0.08}s`;
    row.innerHTML = `
      <span class="dimension-name">${esc(dim.name)}</span>
      <div class="dimension-bar-track"><div class="dimension-bar-fill ${level}" style="width: ${pct}%;"></div></div>
      <span class="dimension-score">${scoreLabel}</span>
      <span class="dimension-chevron">&rsaquo;</span>
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
    const label = isHigh ? 'High Impact' : 'Moderate';
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
  const verdict = pct === 100 ? 'Full marks' : pct >= 70 ? 'Mostly there' : pct >= 40 ? 'Partial credit' : 'Needs work';
  const rationale = dim.rationale || 'Detail not available.';

  let html = `
    <div class="modal-header">
      <span class="modal-badge">Dimension Detail</span>
    </div>
    <h2>${esc(dim.name)}</h2>
    <div class="modal-score-line">
      <span class="modal-score-pill">${dim.score ?? 0} / ${dim.max ?? 100}</span>
      <span>${pct}% &mdash; ${verdict}</span>
    </div>
    <div class="modal-section">
      <div class="modal-section-label">Why this score</div>
      <div class="modal-rationale">${esc(rationale)}</div>
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
  const priority = (gap.priority || '').toLowerCase();
  const isHigh = priority === 'high' || priority === 'critical';
  const badgeBg = isHigh ? '#fee2e2' : '#fef3c7';
  const badgeFg = isHigh ? '#dc2626' : '#92400e';
  const badgeLabel = isHigh ? 'High Impact Gap' : 'Moderate Gap';
  const isMissing = gap.currentSnippet === null || gap.currentSnippet === undefined;

  let html = `
    <div class="modal-header">
      <span class="modal-badge" style="background:${badgeBg}; color:${badgeFg};">${badgeLabel}</span>
    </div>
    <h2>${esc(gap.title || gap.name || 'Gap')}</h2>
    <p class="modal-description">${esc(gap.description || '')}</p>
  `;

  if (gap.location) {
    html += `
      <div class="modal-section">
        <div class="modal-section-label">Where it lives</div>
        <span class="modal-location">&#128205; ${esc(gap.location)}</span>
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
  const escaped = String(code)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `
    <div class="code-block ${variant}">
      <button class="code-copy" onclick="copyCode(this)">Copy</button>
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
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalBackdrop').classList.add('open');
}
function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
}
function closeIfBackdrop(e) {
  if (e.target.id === 'modalBackdrop') closeModal();
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
