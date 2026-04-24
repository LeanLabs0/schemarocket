# Schema Rocket — Schema Score Experience (Frontend)

Lead-gen prototype for Lean Labs. Accepts a URL, returns a letter-graded schema audit with gap analysis and a gated fix-plan CTA.

**Live:** https://schemarocket.netlify.app/
**Backend:** `https://factor8-agent-sdk.fly.dev/api/v1/brand-slug/lean-labs/query` ([factor8-agent-sdk](https://github.com/LeanLabs0/factor8-agent-sdk))
**Status:** V1 prototype — design pass + dev polish pending.

## Files

| File | Purpose |
|------|---------|
| `index.html` | 3 screens: INPUT → SCANNING → RESULTS. Static markup. |
| `app.js` | State machine + fetch to backend agent. Parses JSON response into dimension cards + gap cards + gated fix plan. |
| `styles.css` | All styling. Currently uses Skittles palette — brand pass pending (Maria). |

## Deploy

Manual drag-drop to Netlify for now. No CI wired.

1. Edit files locally
2. Netlify dashboard → `schemarocket` site → **Deploys** tab → drag-drop the folder
3. Takes ~30 seconds to go live

**Future:** connect this repo to Netlify for auto-deploy on push to `main`.

## API contract

Backend returns JSON with:

```ts
{
  url: string;
  auditDate: string;            // YYYY-MM-DD
  overall: { score, grade, label, verdict };
  dimensions: Array<{ name, score, max, pct }>;  // 7 entries
  gaps: Array<{ priority: "high"|"moderate", title, description }>;
  gapCount: number;
  fixPlan: Array<{ step, action, impact: "+N points", effort }>;
  typeMap: Array<{ type, label, status, issues }>;  // NEW — not yet rendered
  competitors: [];
  competitorDiscoveryAvailable: false;
}
```

## Edward — Handoff TODOs

Priority order (from Kevin's V1 walkthrough, 2026-04-23):

### 1. Type-map pill row (HIGH — Kevin's #1 visual ask)
Render `typeMap[]` from backend response as a horizontal row of pills above the dimension bars. Spec:
[`factor8_app/docs/specs/schema-score-type-map.md`](https://github.com/LeanLabs0/factor8-agent-sdk/blob/main/docs/specs/schema-score-type-map.md)

Status colors:
- 🟢 green = `present`
- 🟡 yellow = `present_incomplete`
- 🔴 red = `missing`
- ⚫ gray = `not_applicable`

Pill label: `label` field (plain English, e.g. "Company"). Hover/tap shows `issues[]`.

### 2. "Score Another URL" rerun button (HIGH)
Kevin: "The only way I can run it again is to start over by refreshing."

Add sticky pill button at top-right of results screen with `↻` icon. Click → hide results, show INPUT screen, clear the URL field. No browser reload.

### 3. Fix Plan CTA destination (HIGH)
Currently points to `https://calendly.com/leanlabs`. Confirm this is right target with Ralph. Button copy: "Get My Fix Plan" recommended. Open in new tab.

### 4. Hero headline fit (MEDIUM)
Current H2 "How does your structured data stack up?" is too long for the URL input line on some widths. Ralph is drafting 3 alternative options — ask him in Slack.

### 5. Logo + external links (MEDIUM)
- Nav logo → `https://www.lean-labs.com/` (same tab)
- All external links (`validator.schema.org`, `search.google.com`, calendly) → `target="_blank" rel="noopener noreferrer"`

### 6. Brand color pass (MEDIUM — Maria)
Kevin: "Too Skittles." Maria to replace the purple/pink/orange gradient with brand palette from Lean Labs guidelines.

### 7. Remove gated-lock blur UI (low)
The current results show 5 numbered placeholder cards ("Implementation timeline", "Rich result eligibility", etc.) that look like a blurred preview. Kevin flagged this as confusing. Simpler: show top 4 gaps fully, end with one clear CTA.

## Backend changes shipped (2026-04-23)

Already live on Fly, no frontend action needed:
- URL normalization — same URL typed differently now scores identically
- Plain-English verdict + gap descriptions (some Haiku-tier leakage of bare type names remains)
- `fixPlan[]` sorted by `+N points` descending
- `typeMap[]` emitted in JSON (see TODO #1 to render)

## Contact

- Product + agent behavior: Ralph (@ralphlemosLL)
- Design: Maria
- Frontend code: Edward
