/* ============================================================
   Schema Score report copy helpers
   Works in the browser (window.SchemaReportCopy) and in Node tests.
   Every label here is read by prospects on sales calls, so it must be
   plain English and literally true. Missing schema means less explicit
   information. It does not mean Google or an AI cannot see the site.
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
  // Fallback headlines for reports cached before the scorer sent its own
  // headline. Green rows say what is in place. Orange and red rows say
  // what is missing, without claiming a result we did not measure.
  const DIMENSION_HEADLINES = {
    'code quality': {
      high: 'Your schema code is clean and valid',
      mid: 'Your code mostly works, but errors are weakening it',
      low: 'Code errors are hurting your schema',
    },
    'required types present': {
      high: 'Your company, site and page schema are all there',
      mid: 'Some of your core schema is missing',
      low: 'Most of your core schema is missing',
    },
    'correct type for page': {
      high: 'Your schema says what kind of page this is',
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
      high: 'The details AI answers look for are filled in',
      mid: 'Some details AI answers look for are missing',
      low: 'Most details AI answers look for are missing',
    },
  };

  // Phrases a prospect already rejected, or that promise a result the
  // score does not prove. A scorer headline that still says one of these
  // falls back to the table above.
  const BANNED_HEADLINE = [
    /can'?t see/i,
    /cannot see/i,
    /reliably reference/i,
    /isn'?t fully clear/i,
    /exactly what it is/i,
    /showing up in ai/i,
    /industry benchmarks/i,
    /full report/i,
  ];

  // Nearest whole percent, clamped to 0-100. The number on screen and the
  // color use this same value, so 70% is never painted as the 40-69 band.
  function shownPct(pct) {
    const n = Number(pct);
    if (!Number.isFinite(n)) return 0;
    return Math.round(Math.max(0, Math.min(100, n)));
  }

  // Row dot and score pill. Same bands as the scorer:
  // red under 40, orange from 40 to 69, green at 70 and up.
  function dimensionLevel(pct) {
    const n = shownPct(pct);
    return n < 40 ? 'low' : n < 70 ? 'mid' : 'high';
  }

  function dimensionHeadline(name, level) {
    const copy = DIMENSION_HEADLINES[String(name).toLowerCase().trim()];
    return (copy && copy[level]) || name;
  }

  function acceptableHeadline(text) {
    if (typeof text !== 'string') return '';
    const trimmed = text.trim();
    if (!trimmed) return '';
    if (BANNED_HEADLINE.some((re) => re.test(trimmed))) return '';
    return trimmed;
  }

  // Row headline. New reports carry the scorer's own headline, which names
  // the missing items ("Your logo needs a width and height"). Older cached
  // reports have no such field, so they use the table. That table cannot
  // name the missing fields, because the cached payload does not list them.
  function rowHeadline(dim, level) {
    const own = acceptableHeadline(dim && dim.headline);
    if (own) return own;
    return dimensionHeadline((dim && dim.name) || '', level);
  }

  // One-line verdict inside a dimension row. Words match the dot color.
  function scoreVerdict(pct) {
    const n = shownPct(pct);
    if (n >= 100) return 'Perfect score';
    const level = dimensionLevel(n);
    if (level === 'high') return 'In good shape';
    if (level === 'mid') return 'Needs work';
    return 'Major gaps';
  }

  // Badge under the overall score. Same three bands as the row dots,
  // so 70% is not "needs work" while its rows are green.
  function readinessLabel(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) return '';
    const level = dimensionLevel(n);
    if (level === 'high') return 'AI-READY';
    if (level === 'mid') return 'NEEDS WORK';
    return 'MAJOR GAPS';
  }

  function firstPresent(values) {
    for (const value of values) {
      if (typeof value === 'string') {
        if (value.trim() !== '') return value;
        continue;
      }
      if (Array.isArray(value)) {
        if (value.length > 0) return value;
        continue;
      }
      if (value != null) return value;
    }
    return null;
  }

  function gapSnippet(gap) {
    if (!gap || typeof gap !== 'object') return null;
    return firstPresent([gap.currentSnippet, gap.current, gap.existing]);
  }

  // "Missing" only when the page has nothing for this gap. A logo URL, or
  // any other snippet, means the block is there and needs a change.
  function gapHasExisting(gap) {
    const existing = gapSnippet(gap);
    if (typeof existing === 'string') return existing.trim() !== '';
    if (Array.isArray(existing)) return existing.length > 0;
    return existing != null;
  }

  function gapStatusLabel(gap) {
    return gapHasExisting(gap) ? 'Needs a fix' : 'Missing';
  }

  function isHighPriority(gap) {
    const p = String((gap && gap.priority) || '').toLowerCase();
    return p === 'high' || p === 'critical';
  }

  // Priority is urgency, not a measured business impact.
  function gapPriorityLabel(gap) {
    return isHighPriority(gap) ? 'High priority' : 'Lower priority';
  }

  return {
    DIMENSION_HEADLINES,
    shownPct,
    dimensionLevel,
    dimensionHeadline,
    rowHeadline,
    scoreVerdict,
    readinessLabel,
    gapSnippet,
    gapHasExisting,
    gapStatusLabel,
    isHighPriority,
    gapPriorityLabel,
  };
});
