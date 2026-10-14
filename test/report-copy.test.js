const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DIMENSION_HEADLINES,
  dimensionLevel,
  dimensionHeadline,
  readinessLabel,
  gapStatusLabel,
  isHighPriority,
} = require('../lib/report-copy');

const ROOT = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// A prospect on Kevin's commas.com call (2026-10-08) pushed back on these.
const BANNED_CLAIMS = [/can't see/i, /can't identify/i, /reliably reference/i, /full report/i, /industry benchmarks/i];

describe('Schema Score report copy', () => {
  it('never claims Google or AI cannot see the site', () => {
    for (const levels of Object.values(DIMENSION_HEADLINES)) {
      for (const line of Object.values(levels)) {
        for (const re of BANNED_CLAIMS) assert.doesNotMatch(line, re, line);
        assert.doesNotMatch(line, /[–—]/, `dash in: ${line}`);
      }
    }
  });

  it('keeps the old overclaims out of the page and app', () => {
    for (const re of [/can't see most of your site/i, /industry benchmarks/i, /more issues in full report/i, /NEEDS ENRICHMENT/]) {
      assert.doesNotMatch(appJs, re);
      assert.doesNotMatch(indexHtml, re);
    }
  });

  it('maps the commas.com dimension scores to honest headlines', () => {
    assert.equal(dimensionHeadline('Required Types Present', dimensionLevel(25)), 'Most of your core schema is missing');
    assert.equal(dimensionHeadline('Entity Connections', dimensionLevel(70)), 'Your schema pieces are linked together');
    assert.equal(dimensionHeadline('Unknown Dimension', 'low'), 'Unknown Dimension');
  });

  it('bands the readiness badge on the scorer grade scale', () => {
    assert.equal(readinessLabel(95), 'AI-READY');
    assert.equal(readinessLabel(80), 'AI-READY');
    assert.equal(readinessLabel(79), 'NEEDS WORK');
    assert.equal(readinessLabel(60), 'NEEDS WORK');
    assert.equal(readinessLabel(51), 'MAJOR GAPS');
    assert.equal(readinessLabel('n/a'), '');
  });

  it('labels a gap Missing only when nothing exists on the page', () => {
    assert.equal(gapStatusLabel({ title: 'No website schema', currentSnippet: null }), 'Missing');
    assert.equal(gapStatusLabel({ title: 'No FAQ schema' }), 'Missing');
    assert.equal(
      gapStatusLabel({ title: 'Logo is a plain URL', currentSnippet: '{"@type":"Organization","logo":"https://commas.com/logo.png"}' }),
      'Needs a fix',
    );
  });

  it('colors by priority, not by card position', () => {
    assert.equal(isHighPriority({ priority: 'high' }), true);
    assert.equal(isHighPriority({ priority: 'Critical' }), true);
    assert.equal(isHighPriority({ priority: 'moderate' }), false);
    assert.doesNotMatch(appJs, /\|\| i < 2/);
  });

  it('loads the copy helpers before app.js', () => {
    const copyAt = indexHtml.indexOf('/lib/report-copy.js');
    const appAt = indexHtml.indexOf('/app.js');
    assert.ok(copyAt > 0 && copyAt < appAt);
  });
});
