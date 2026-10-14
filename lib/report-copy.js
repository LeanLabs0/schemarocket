/* ============================================================
   Schema Score report copy helpers
   Works in the browser (window.SchemaReportCopy) and in Node tests.
   Every label here is read by prospects on sales calls, so it must be
   plain English and literally true. No claims about what Google or AI
   "can't see": missing schema means less explicit information, not an
   invisible site.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SchemaReportCopy = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Human-readable verdict headlines per dimension, keyed by the canonical
  // rubric name the scorer emits. Green rows read as a win, red rows as what
  // is missing. Falls back to the raw name for unknown dimensions.
  const DIMENSION_HEADLINES = {
    'code quality': {
      high: 'Your schema code is clean and valid',
      mid: 'Your code mostly works, but errors are weakening it',
      low: 'Code errors are breaking your schema',
    },
    'required types present': {
      high: 'Your company, site and page schema are all there',
      mid: 'Some of your core schema is missing',
      low: 'Most of your core schema is missing',
    },
    'correct type for page': {
      high: 'Your page tells AI exactly what it is',
      mid: 'Your schema is missing website or page context',
      low: "Your schema doesn't say what kind of page this is",
    },
    'required fields filled': {
      high: 'Must-have details are complete',
      mid: 'Some must-have details are missing',
      low: 'Most must-have details are missing',
    },
    'recommended fields filled': {
      high: 'Helpful extra details are filled in',
      mid: 'Some helpful extra details are missing',
      low: 'Most helpful extra details are missing',
    },
    'entity connections': {
      high: 'Your schema pieces are linked together',
      mid: "Some schema pieces aren't linked together",
      low: "Your schema pieces aren't linked together",
    },
    'ai answer visibility': {
      high: 'Strong signals for showing up in AI answers',
      mid: "You're missing some signals AI engines look for",
      low: "You're missing most signals AI engines look for",
    },
  };

  function dimensionLevel(pct) {
    const n = Math.max(0, Math.min(100, Number(pct) || 0));
    return n < 40 ? 'low' : n < 70 ? 'mid' : 'high';
  }

  function dimensionHeadline(name, level) {
    const copy = DIMENSION_HEADLINES[String(name).toLowerCase().trim()];
    return (copy && copy[level]) || name;
  }

  // Row headline. New reports carry the agent's own headline, which names
  // exactly what is missing ("Your logo needs a width and height").
  // Reports cached before that field existed fall back to the table.
  function rowHeadline(dim, level) {
    const own = dim && typeof dim.headline === 'string' ? dim.headline.trim() : '';
    return own || dimensionHeadline((dim && dim.name) || '', level);
  }

  // Badge under the score gauge. Bands follow the scorer's grade scale:
  // A/B (80+), C/D (60-79), F (under 60).
  function readinessLabel(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) return '';
    if (n >= 80) return 'AI-READY';
    if (n >= 60) return 'NEEDS WORK';
    return 'MAJOR GAPS';
  }

  // Gap card label says what the gap IS, not how urgent it is (urgency is
  // the card color). "Missing" only when nothing for it exists on the page;
  // a block that exists but is incomplete or wrongly formatted "Needs a fix".
  function gapStatusLabel(gap) {
    if (!gap || typeof gap !== 'object') return 'Missing';
    const existing = gap.currentSnippet ?? gap.current ?? gap.existing ?? null;
    const hasExisting = typeof existing === 'string' ? existing.trim() !== '' : existing != null;
    return hasExisting ? 'Needs a fix' : 'Missing';
  }

  function isHighPriority(gap) {
    const p = String((gap && gap.priority) || '').toLowerCase();
    return p === 'high' || p === 'critical';
  }

  return {
    DIMENSION_HEADLINES,
    dimensionLevel,
    dimensionHeadline,
    rowHeadline,
    readinessLabel,
    gapStatusLabel,
    isHighPriority,
  };
});
