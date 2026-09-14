const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildUtmUrl, buildGenieHandoffUrl } = require('../lib/handoff');

const ROOT = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const SCHEMA_ROCKET = 'https://www.leanlabs.com/solutions/hubspot-website-schema-rocket';
const GENIE = 'https://www.aeogenie.com/';
const AEO_TOOLS = 'https://www.leanlabs.com/products-partners';
const AGENCY = 'answer-engine-optimization-agency';

function nextStepsMarkup() {
  const start = indexHtml.indexOf('results-nextsteps-section');
  const end = indexHtml.indexOf('site-footer');
  assert.ok(start >= 0 && end > start, 'expected Next Steps section in index.html');
  return indexHtml.slice(start, end);
}

describe('RAL-76 Schema Rocket next-step href', () => {
  it('fills NEXT_STEPS schema-rocket with the live product page, not a blank FILL', () => {
    assert.match(appJs, /SCHEMA_ROCKET_URL:\s*'https:\/\/www\.leanlabs\.com\/solutions\/hubspot-website-schema-rocket'/);
    assert.match(appJs, /'schema-rocket':\s*CONFIG\.SCHEMA_ROCKET_URL/);
    assert.doesNotMatch(appJs, /'schema-rocket':\s*''/);
    assert.doesNotMatch(appJs, /FILL: HubSpot redirect/);
  });

  it('builds a clickable UTM-tagged Schema Rocket URL', () => {
    const href = buildUtmUrl(SCHEMA_ROCKET, 'schema_rocket', 'next_steps');
    const u = new URL(href);
    assert.equal(u.origin + u.pathname, SCHEMA_ROCKET);
    assert.equal(u.searchParams.get('utm_source'), 'schemascore.ai');
    assert.equal(u.searchParams.get('utm_medium'), 'report');
    assert.equal(u.searchParams.get('utm_campaign'), 'schema_rocket');
    assert.equal(u.searchParams.get('utm_content'), 'next_steps');
  });
});

describe('RAL-74 Next Steps is AEO-broad, not the old product row', () => {
  it('leads with AEO Genie and books an AEO strategy call instead of Baseline', () => {
    const section = nextStepsMarkup();
    assert.match(section, /data-nextstep="aeo-genie"/);
    assert.match(section, /Run my AEO Genie/);
    assert.match(section, /data-cta="book"/);
    assert.match(section, /Book an AEO strategy call/);
    assert.match(section, /data-nextstep="schema-rocket"/);
    assert.doesNotMatch(section, /data-nextstep="aeo-baseline"/);
    assert.doesNotMatch(section, /Get your AEO Baseline/);
    assert.doesNotMatch(section, /aeobaseline\.com/);
  });

  it('hands the Next Steps Genie card the scanned URL with next_steps UTMs', () => {
    const href = buildGenieHandoffUrl(GENIE, 'https://www.lean-labs.com/', { content: 'next_steps' });
    const u = new URL(href);
    assert.equal(u.searchParams.get('url'), 'https://www.lean-labs.com/');
    assert.equal(u.searchParams.get('utm_content'), 'next_steps');
    assert.equal(u.searchParams.get('utm_campaign'), 'aeo_genie');
  });
});

describe('Explore more AEO tools', () => {
  it('points at the products stack, not the agency page', () => {
    assert.match(indexHtml, /data-cta="aeo"/);
    assert.match(indexHtml, new RegExp(AEO_TOOLS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(indexHtml, new RegExp(AGENCY));
    assert.match(appJs, /AEO_URL:\s*'https:\/\/www\.leanlabs\.com\/products-partners/);
    assert.doesNotMatch(appJs, /aeo-accelerator/);
  });
});
