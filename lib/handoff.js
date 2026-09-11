/* ============================================================
   Schema Score → AEO Genie handoff helpers
   Works in the browser (window.SchemaHandoff) and in Node tests.
   AEO Genie only consumes ?url= (plus identity fields we do not have).
   It has no fix-plan payload param — do not stuff plan JSON into the URL.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SchemaHandoff = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULT_UTM = {
    source: 'schemascore.ai',
    medium: 'report',
    content: 'next_steps',
  };

  // Conservative ceiling so the Genie tab opens even in older browsers
  // and Slack/email wrappers. Modern Chromium allows much more.
  const MAX_HANDOFF_URL_LENGTH = 2048;
  const MAX_VISIBLE_FIXES = 10;

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  function parseUrl(base) {
    if (!isNonEmptyString(base)) return null;
    try {
      return new URL(base.trim());
    } catch (_) {
      return null;
    }
  }

  function buildUtmUrl(base, campaign, content, extras) {
    const u = parseUrl(base);
    if (!u) return null;
    const source = extras && extras.source ? extras.source : DEFAULT_UTM.source;
    const medium = extras && extras.medium ? extras.medium : DEFAULT_UTM.medium;
    const resolvedContent = content == null || content === '' ? DEFAULT_UTM.content : content;
    if (!isNonEmptyString(campaign)) return null;
    u.searchParams.set('utm_source', source);
    u.searchParams.set('utm_medium', medium);
    u.searchParams.set('utm_campaign', campaign);
    u.searchParams.set('utm_content', resolvedContent);
    return u.toString();
  }

  // Add the scanned page as ?url= so Genie / Baseline prefill their form.
  // Encoding is URLSearchParams.set — never string-concatenate the scan URL.
  function withScanUrl(base, scanUrl) {
    const u = parseUrl(base);
    if (!u) return null;
    if (isNonEmptyString(scanUrl)) {
      u.searchParams.set('url', scanUrl.trim());
    }
    return u.toString();
  }

  // Build the Genie tab URL. If the scan URL would blow the length budget
  // (pathological / oversized), drop ?url= so the click still lands on Genie.
  function buildGenieHandoffUrl(base, scanUrl, options) {
    const opts = options || {};
    const campaign = opts.campaign || 'aeo_genie';
    const content = opts.content || 'fix_plan';
    const maxLength = Number(opts.maxLength) > 0 ? Number(opts.maxLength) : MAX_HANDOFF_URL_LENGTH;
    const extras = { source: opts.source, medium: opts.medium };

    const withUrl = withScanUrl(base, scanUrl);
    const full = buildUtmUrl(withUrl, campaign, content, extras);
    if (full && full.length <= maxLength) return full;

    const bare = buildUtmUrl(base, campaign, content, extras);
    if (bare && bare.length <= maxLength) return bare;
    return parseUrl(base) ? parseUrl(base).toString() : null;
  }

  function normalizeFixItems(fixes) {
    if (Array.isArray(fixes)) {
      return fixes.filter((item) => item != null);
    }
    if (fixes && typeof fixes === 'object') {
      return Object.entries(fixes).map(([key, value]) => ({
        title: key,
        description: typeof value === 'string' ? value : (value && value.description) || '',
      }));
    }
    return [];
  }

  function visibleFixItems(fixes, max) {
    const items = normalizeFixItems(fixes);
    const cap = Number(max) > 0 ? Number(max) : MAX_VISIBLE_FIXES;
    return {
      items: items.slice(0, cap),
      hiddenCount: Math.max(0, items.length - cap),
      total: items.length,
    };
  }

  return {
    DEFAULT_UTM,
    MAX_HANDOFF_URL_LENGTH,
    MAX_VISIBLE_FIXES,
    buildUtmUrl,
    withScanUrl,
    buildGenieHandoffUrl,
    normalizeFixItems,
    visibleFixItems,
  };
});
