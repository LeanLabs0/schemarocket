const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildUtmUrl,
  withScanUrl,
  buildGenieHandoffUrl,
  normalizeFixItems,
  visibleFixItems,
  MAX_HANDOFF_URL_LENGTH,
} = require('../lib/handoff');

const GENIE = 'https://www.aeogenie.com/';

describe('buildUtmUrl', () => {
  it('returns null for a blank or invalid base', () => {
    assert.equal(buildUtmUrl('', 'aeo_genie', 'fix_plan'), null);
    assert.equal(buildUtmUrl(null, 'aeo_genie', 'fix_plan'), null);
    assert.equal(buildUtmUrl('not a url', 'aeo_genie', 'fix_plan'), null);
  });

  it('returns null without a campaign', () => {
    assert.equal(buildUtmUrl(GENIE, '', 'fix_plan'), null);
  });

  it('sets source/medium/campaign/content without dropping existing params', () => {
    const href = buildUtmUrl('https://www.aeobaseline.com/?keep=1', 'aeo_baseline', 'next_steps');
    const u = new URL(href);
    assert.equal(u.searchParams.get('keep'), '1');
    assert.equal(u.searchParams.get('utm_source'), 'schemascore.ai');
    assert.equal(u.searchParams.get('utm_medium'), 'report');
    assert.equal(u.searchParams.get('utm_campaign'), 'aeo_baseline');
    assert.equal(u.searchParams.get('utm_content'), 'next_steps');
  });
});

describe('withScanUrl', () => {
  it('omits url when the scan URL is empty', () => {
    const href = withScanUrl(GENIE, '');
    assert.equal(new URL(href).searchParams.has('url'), false);
    assert.equal(withScanUrl(GENIE, '   '), href);
  });

  it('encodes the scanned URL as a single query value', () => {
    const scan = 'https://lean-labs.com/path?already=1&x=a b';
    const href = withScanUrl(GENIE, scan);
    const u = new URL(href);
    assert.equal(u.origin + u.pathname, 'https://www.aeogenie.com/');
    assert.equal(u.searchParams.get('url'), scan);
    assert.match(href, /url=https%3A%2F%2Flean-labs.com/);
    assert.doesNotMatch(href, /[?&]already=1/);
  });

  it('does not treat a javascript: scan value as the navigation target', () => {
    const href = withScanUrl(GENIE, 'javascript:alert(1)');
    const u = new URL(href);
    assert.equal(u.protocol, 'https:');
    assert.equal(u.hostname, 'www.aeogenie.com');
    assert.equal(u.searchParams.get('url'), 'javascript:alert(1)');
  });
});

describe('buildGenieHandoffUrl', () => {
  it('carries the scanned URL plus the Genie UTMs', () => {
    const href = buildGenieHandoffUrl(GENIE, 'https://lean-labs.com/');
    const u = new URL(href);
    assert.equal(u.searchParams.get('url'), 'https://lean-labs.com/');
    assert.equal(u.searchParams.get('utm_campaign'), 'aeo_genie');
    assert.equal(u.searchParams.get('utm_content'), 'fix_plan');
    assert.equal(u.searchParams.get('utm_source'), 'schemascore.ai');
    assert.equal(u.searchParams.get('utm_medium'), 'report');
  });

  it('still opens Genie when there is no scan URL', () => {
    const href = buildGenieHandoffUrl(GENIE, '');
    const u = new URL(href);
    assert.equal(u.origin + u.pathname, 'https://www.aeogenie.com/');
    assert.equal(u.searchParams.has('url'), false);
    assert.equal(u.searchParams.get('utm_campaign'), 'aeo_genie');
  });

  it('does not serialize a fix plan into the URL', () => {
    const planTitle = 'Add Organization schema with a unique description';
    const href = buildGenieHandoffUrl(GENIE, 'https://example.com/');
    assert.doesNotMatch(href, new RegExp(planTitle));
    assert.equal(new URL(href).searchParams.has('plan'), false);
    assert.equal(new URL(href).searchParams.has('fixes'), false);
  });

  it('drops an oversized scan URL rather than producing an unopenable link', () => {
    const huge = `https://example.com/${'a'.repeat(4000)}`;
    const href = buildGenieHandoffUrl(GENIE, huge);
    assert.ok(href.length <= MAX_HANDOFF_URL_LENGTH);
    const u = new URL(href);
    assert.equal(u.searchParams.has('url'), false);
    assert.equal(u.searchParams.get('utm_campaign'), 'aeo_genie');
  });

  it('honors a tighter maxLength for tests and wrappers', () => {
    const href = buildGenieHandoffUrl(GENIE, 'https://example.com/pretty-long-path', {
      maxLength: 80,
    });
    assert.ok(href.length <= 80);
    assert.equal(new URL(href).searchParams.has('url'), false);
  });
});

describe('visibleFixItems', () => {
  it('treats empty / missing plans as zero items', () => {
    assert.deepEqual(visibleFixItems([]), { items: [], hiddenCount: 0, total: 0 });
    assert.deepEqual(visibleFixItems(null), { items: [], hiddenCount: 0, total: 0 });
    assert.deepEqual(visibleFixItems(undefined), { items: [], hiddenCount: 0, total: 0 });
  });

  it('normalizes a keyed object plan', () => {
    const result = visibleFixItems({ 'Add FAQ': 'Needed on /pricing' });
    assert.equal(result.total, 1);
    assert.equal(result.items[0].title, 'Add FAQ');
    assert.equal(result.items[0].description, 'Needed on /pricing');
  });

  it('caps an oversized plan and reports the hidden remainder', () => {
    const fixes = Array.from({ length: 17 }, (_, i) => ({ title: `Fix ${i + 1}` }));
    const result = visibleFixItems(fixes, 10);
    assert.equal(result.items.length, 10);
    assert.equal(result.hiddenCount, 7);
    assert.equal(result.total, 17);
    assert.equal(result.items[0].title, 'Fix 1');
    assert.equal(result.items[9].title, 'Fix 10');
  });
});
