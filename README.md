# Schema Rocket — Schema Score Experience (Frontend)

Lead-gen prototype for Lean Labs. Accepts a URL, returns a letter-graded schema audit with gap analysis and a gated fix-plan CTA.

**Live:** https://schemarocket.netlify.app/
**Backend repo:** [factor8-agent-sdk](https://github.com/LeanLabs0/factor8-agent-sdk)
**Backend URL:** `https://factor8-agent-sdk.fly.dev/api/v1/brand-slug/lean-labs/query`
**Status:** V1 prototype. Design pass and dev polish pending.

## Files

| File | Purpose |
|------|---------|
| `index.html` | 3 screens: INPUT, SCANNING, RESULTS. Static markup. |
| `app.js` | State machine plus fetch to backend. Parses JSON into dimension cards, gap cards, and gated fix plan. |
| `styles.css` | All styling. Currently uses Skittles palette. Brand pass pending. |

## Local dev

```bash
cp .env.local.example .env.local
# add SCHEMA_API_KEY and HUBSPOT_TOKEN to .env.local
npm install
npm run dev
```

Then open `http://localhost:5500`.


### HubSpot persistence and retrieval

- On each successful scan, the server upserts a record in HubSpot custom object `2-62805467` using property `url` as the unique website key.
- Record payload fields written: `url`, `audit_date`, `overall_score`, `overall_grade`, `status`, `report_json`, `external_report_id`.
- Frontend supports retrieval by query parameter: `?jobID=<external_report_id>`.
- Example: `http://localhost:5500/?jobID=4b3db6f7-...`

## Deploy

Deploy on Vercel (recommended):

1. Import the GitHub repo in Vercel.
2. Set **Root Directory** to `schemarocket`.
3. Add env vars in Vercel project settings:
   - `SCHEMA_API_URL`
   - `SCHEMA_API_KEY`
   - `SCHEMA_AGENT`
   - `HUBSPOT_TOKEN`
   - `HUBSPOT_SCHEMA_OBJECT_TYPE`
   - `HUBSPOT_STATUS_AI_READY`
   - `HUBSPOT_STATUS_NEEDS_ENRICHMENT`
   - `HUBSPOT_STATUS_AT_RISK`
4. Deploy.

Notes:
- API endpoints are now serverless functions in `api/score.js` and `api/report.js`.
- `vercel.json` explicitly routes `/api/score` and `/api/report` and serves `index.html` for app routes.

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
  typeMap: Array<{ type, label, status, issues }>;  // NEW, not yet rendered
  competitors: [];
  competitorDiscoveryAvailable: false;
}
```

---

## Design handoff (Maria)

Target: Thu May 1.

### 1. Brand pass on colors
Current gradient (purple / pink / orange) needs to match Lean Labs brand. Kevin flagged it as "too Skittles" in the V1 walkthrough. Apply the standard Lean Labs palette from the brand guidelines.

### 2. Type-map pill row
New section above the dimension bars. Horizontal row of status pills, one per expected schema type. The backend already sends the data (see `typeMap[]` in the API contract above).

Status colors:
- 🟢 green = present
- 🟡 yellow = present but incomplete
- 🔴 red = missing
- ⚫ gray = not applicable

Pill label is plain English (`Company`, `Site`, `Page`, `Breadcrumbs`). Hover or tap expands a tooltip with the `issues` list. On mobile the pills wrap and issues collapse by default.

Full data contract in the backend repo: [`docs/specs/schema-score-type-map.md`](https://github.com/LeanLabs0/factor8-agent-sdk/blob/main/docs/specs/schema-score-type-map.md).

### 3. Hero headline layout
Current H2 is too long for the URL input line on mobile. Once Kevin picks from 3 copy options (Ralph sending in Slack), adjust the headline area to max-width 640px so it fits cleanly above the input on both desktop and mobile.

---

## Dev handoff (Edward)

Target: Mon May 5.

Priority order, from Kevin's V1 walkthrough (2026-04-23).

### 1. Type-map pill rendering (HIGH)
Kevin's #1 visual ask. Parse `typeMap[]` from the backend response and render Maria's pill design above the dimension bars. See Maria's section for status colors and labels.

### 2. "Score Another URL" button (HIGH)
Kevin: "The only way I can run it again is to start over by refreshing."

Sticky pill button at top-right of the results screen with a rotate icon. Click resets to the INPUT screen and clears the URL field. No browser reload.

### 3. Fix Plan CTA link (HIGH)
Currently points to `https://calendly.com/leanlabs`. Confirm correct destination with Kevin (likely `lean-labs.com/book-a-call`). Button copy: "Get My Fix Plan". Open in a new tab.

### 4. Remove blurred gated-preview cards (HIGH)
The results screen shows 5 numbered placeholder cards ("Implementation timeline", "Rich result eligibility", etc.) that look like a broken preview. Kevin flagged this as confusing. Show the top 4 gaps in full, then one clean CTA below.

### 5. Logo and external links (MEDIUM)
- Nav logo: link to `https://www.lean-labs.com/` (same tab).
- External links (`validator.schema.org`, `search.google.com`, the CTA): `target="_blank" rel="noopener noreferrer"`.

### 6. Hero headline copy (MEDIUM)
Swap in once Kevin picks from Ralph's 3 options.

---

## Backend changes already shipped (2026-04-23)

Live on Fly, no frontend action needed:
- URL normalization. Same URL typed different ways now returns valid reports (was returning F/0 on some variants).
- Plain-English verdict and gap titles. Some bare type names still leak into gap descriptions due to Haiku model compliance.
- `fixPlan[]` sorted by `+N points` descending.
- `typeMap[]` emitted in the JSON response (see design TODO 2).

Known V1 limitation: scores for the same URL can wobble ±5 to 15 points between calls because the agent runs Haiku at temperature 0.2. Stable across grade bands, not identical. Post-V1 decision on whether to move to temperature 0 or upgrade to Sonnet.

## Contact

- Product and agent behavior: Ralph (`@ralphlemosLL`)
- Design: Maria
- Frontend code: Edward
