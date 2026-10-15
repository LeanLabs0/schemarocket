const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
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
} = require('../lib/report-copy');

const ROOT = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const previewHtml = fs.readFileSync(path.join(ROOT, 'preview-modals.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

// A prospect on Kevin's commas.com call (2026-10-08) pushed back on these.
const BANNED_CLAIMS = [
  /can't see/i,
  /can't identify/i,
  /reliably reference/i,
  /full report/i,
  /industry benchmarks/i,
  /exactly what it is/i,
  /showing up in ai/i,
];

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
    const banned = [
      /can't see most of your site/i,
      /isn't fully clear about what it is/i,
      /exactly what it is/i,
      /showing up in AI answers/i,
      /breaking your schema/i,
      /industry benchmarks/i,
      /more issues in full report/i,
      /NEEDS ENRICHMENT/,
      /AT RISK/,
      /Halfway there/,
      /Drop-in fix/,
      /High Impact/,
      /biggest impact/i,
      /&mdash;/,
    ];
    for (const re of banned) {
      assert.doesNotMatch(appJs, re);
      assert.doesNotMatch(indexHtml, re);
    }
  });

  it('maps the commas.com dimension scores to honest headlines', () => {
    assert.equal(dimensionHeadline('Required Types Present', dimensionLevel(25)), 'Most of your core schema is missing');
    assert.equal(dimensionHeadline('Entity Connections', dimensionLevel(70)), 'Your schema pieces are linked together');
    assert.equal(dimensionHeadline('Correct Type for Page', dimensionLevel(67)), 'Your schema is missing website or page context');
    assert.equal(dimensionHeadline('Correct Type for Page', dimensionLevel(90)), 'Your schema says what kind of page this is');
    assert.equal(dimensionHeadline('AI Answer Visibility', dimensionLevel(80)), 'The details AI answers look for are filled in');
    assert.equal(dimensionHeadline('Code Quality', dimensionLevel(20)), 'Code errors are hurting your schema');
    assert.equal(dimensionHeadline('Unknown Dimension', 'low'), 'Unknown Dimension');
  });

  it("uses the agent's specific headline and falls back to the table for old reports", () => {
    const specific = 'Your logo needs a width and height, and page details are missing';
    assert.equal(rowHeadline({ name: 'Required Fields Filled', headline: `  ${specific} ` }, 'mid'), specific);
    assert.equal(rowHeadline({ name: 'Required Fields Filled', headline: '' }, 'mid'), 'Some must-have details are missing');
    assert.equal(rowHeadline({ name: 'Required Types Present' }, 'low'), 'Most of your core schema is missing');
    assert.equal(
      rowHeadline({ name: 'Entity Connections', headline: 'AI can reliably reference your brand' }, 'high'),
      'Your schema pieces are linked together',
    );
    assert.equal(rowHeadline(null, 'low'), '');
    assert.match(appJs, /ReportCopy\.rowHeadline\(dim, level\)/);
    assert.match(appJs, /esc\(headline\)/);
  });

  it('labels the fix snippet as what to add', () => {
    assert.match(appJs, /What to add to your schema/);
    assert.doesNotMatch(appJs, /Schema to add for full points/);
    assert.doesNotMatch(previewHtml, /Drop-in fix/);
    assert.match(previewHtml, /What to add to your schema/);
  });

  it('uses the same 40 and 70 bands for the dot, the badge, and the number on screen', () => {
    assert.equal(shownPct(39.4), 39);
    assert.equal(shownPct(39.6), 40);
    assert.equal(shownPct(69.4), 69);
    assert.equal(shownPct(69.6), 70);
    assert.equal(shownPct(140), 100);
    assert.equal(shownPct(-4), 0);

    assert.equal(dimensionLevel(39), 'low');
    assert.equal(dimensionLevel(39.4), 'low');
    assert.equal(dimensionLevel(40), 'mid');
    assert.equal(dimensionLevel(39.6), 'mid');
    assert.equal(dimensionLevel(69), 'mid');
    assert.equal(dimensionLevel(69.4), 'mid');
    assert.equal(dimensionLevel(70), 'high');
    assert.equal(dimensionLevel(69.6), 'high');

    assert.equal(readinessLabel(95), 'AI-READY');
    assert.equal(readinessLabel(70), 'AI-READY');
    assert.equal(readinessLabel(69.6), 'AI-READY');
    assert.equal(readinessLabel(69), 'NEEDS WORK');
    assert.equal(readinessLabel(40), 'NEEDS WORK');
    assert.equal(readinessLabel(39.6), 'NEEDS WORK');
    assert.equal(readinessLabel(39), 'MAJOR GAPS');
    assert.equal(readinessLabel('n/a'), '');

    assert.equal(scoreVerdict(100), 'Perfect score');
    assert.equal(scoreVerdict(70), 'In good shape');
    assert.equal(scoreVerdict(69), 'Needs work');
    assert.equal(scoreVerdict(40), 'Needs work');
    assert.equal(scoreVerdict(39), 'Major gaps');

    assert.match(appJs, /ReportCopy\.shownPct\(clampedScore\)/);
    assert.match(appJs, /ReportCopy\.dimensionLevel\(shownScore\)/);
    assert.match(appJs, /ReportCopy\.dimensionLevel\(pct\)/);
    assert.match(appJs, /ReportCopy\.scoreVerdict\(pct\)/);
    assert.match(appJs, /dimension-dot \$\{level\}/);
  });

  it('paints red under 40, orange from 40 to 69, and green at 70 and up', () => {
    assert.match(stylesCss, /\.dimension-dot\.low\s*\{[^}]*#fca5a5/);
    assert.match(stylesCss, /\.dimension-dot\.mid\s*\{[^}]*#fde68a/);
    assert.match(stylesCss, /\.dimension-dot\.high\s*\{[^}]*#86efac/);
    assert.match(stylesCss, /\.grade-label\.low\s*\{[^}]*#fca5a5/);
    assert.match(stylesCss, /\.grade-label\.mid\s*\{[^}]*#fde68a/);
    assert.match(stylesCss, /\.grade-label\.high\s*\{[^}]*#86efac/);
    assert.match(stylesCss, /\.dimension-score\.low\s*\{[^}]*#fca5a5/);
    assert.match(stylesCss, /\.dimension-score\.mid\s*\{[^}]*#f7e7a3/);
  });

  it('labels a gap Missing only when nothing exists on the page', () => {
    assert.equal(gapStatusLabel({ title: 'No website schema', currentSnippet: null }), 'Missing');
    assert.equal(gapStatusLabel({ title: 'No FAQ schema' }), 'Missing');
    assert.equal(gapStatusLabel({ currentSnippet: '   ' }), 'Missing');
    assert.equal(gapStatusLabel({ currentSnippet: '' }), 'Missing');
    assert.equal(gapHasExisting({ currentSnippet: '   ', current: '' }), false);
    assert.equal(
      gapStatusLabel({ title: 'Logo is a plain URL', currentSnippet: '{"@type":"Organization","logo":"https://commas.com/logo.png"}' }),
      'Needs a fix',
    );
    assert.equal(
      gapSnippet({ currentSnippet: '  ', current: '{"logo":"https://commas.com/logo.png"}' }),
      '{"logo":"https://commas.com/logo.png"}',
    );
    assert.equal(gapStatusLabel({ currentSnippet: '', existing: { logo: 'https://commas.com/logo.png' } }), 'Needs a fix');
    assert.match(appJs, /ReportCopy\.gapSnippet\(g\)/);
    assert.match(appJs, /codeBlock\(existing, 'found'\)/);
  });

  it('colors by priority, not by card position', () => {
    assert.equal(isHighPriority({ priority: 'high' }), true);
    assert.equal(isHighPriority({ priority: 'Critical' }), true);
    assert.equal(isHighPriority({ priority: 'moderate' }), false);
    assert.equal(gapPriorityLabel({ priority: 'high' }), 'High priority');
    assert.equal(gapPriorityLabel({ priority: 'moderate' }), 'Lower priority');
    assert.doesNotMatch(appJs, /\|\| i < 2/);
    assert.match(previewHtml, /dim-bar-fill high" style="width: 75%/);
    assert.match(previewHtml, /The logo is on the page as a plain URL/);
    assert.match(previewHtml, />Needs a fix</);
    assert.doesNotMatch(previewHtml, /High Impact|Drop-in fix|Google can't|—/);
  });

  it('describes the gaps section without promising a bigger report', () => {
    assert.match(indexHtml, /What to <span class="text-primary">fix<\/span> in your schema/);
    assert.match(indexHtml, /Some of these are missing\. Others are already on the page and need a change\./);
    assert.doesNotMatch(indexHtml, /id="gapsMore"/);
  });

  it('loads the copy helpers before app.js', () => {
    const copyAt = indexHtml.indexOf('/lib/report-copy.js');
    const appAt = indexHtml.indexOf('/app.js');
    assert.ok(copyAt > 0 && copyAt < appAt);
  });
});
