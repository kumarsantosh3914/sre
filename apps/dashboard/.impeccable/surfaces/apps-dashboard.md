---
version: 1
slug: "apps-dashboard"
primary_target: "apps/dashboard"
related_targets: []
---

# Surface: SRE.ai dashboard (apps/dashboard)

Mode: Operate. Audience: the on-call founder-engineer arriving from a Slack/PagerDuty link, laptop first, phone fully usable. Job: understand the incident, judge the diagnosis's evidence, approve / reject / roll back, then configure integrations calmly during onboarding.

Constraints: WCAG 2.1 AA; status never by colour alone; real-time updates; no invented data — demo content is labelled synthetic. Build path: code-led (no image generation available); roll ran degraded (no challengers).

## Direction contract

THESIS: An incident is a technical drawing sheet, not a card in a feed: every claim in the diagnosis is dimensioned back to its evidence. Refuses the category default of a dark neon observability wall of charts and cards.

OWN-WORLD: Drafting grammar. Night = blueprint (white/pale-cyan linework on deep Prussian blue), day = whiteprint (Prussian linework on warm-white drafting film). Hairline rules and registration ticks instead of card shadows; title blocks in ruled cells; numbered callout balloons (circled numerals) linking hypothesis claims to evidence lines; a single safety-orange ink for "needs you now" (pending approval, P1, escalate); condensed technical sans for labels, a workhorse sans for reading, tabular figures everywhere numbers live.

STORY: The engineer opens an incident, reads the one-sentence root cause, sees each claim's balloon resolve to a verbatim log/metric/deploy line (or flagged as unverified), reads confidence against the auto/draft thresholds, and acts in one click; the revision table tells them exactly what SRE.ai already did.

FIRST VIEWPORT: Incident sheet. Top: title block row (status + severity stamp, service, detected, MTTR clock, sheet number). Left 60%: hypothesis at large reading size with inline balloons; beneath, the confidence tolerance gauge (0–100 scale, datum ticks at 60 and 85, citation verdict). Right 40%: "Action" cell with the pending action and Approve / Reject (or Roll back) as the loudest, orange-inked control. Below the fold: evidence schedule, revision table (timeline), actions log.

FORM: Engineering drawing / blueprint standard (ISO title block, callout balloons, revision table), position 7 of the ordered grounded list; seed key 0b03315d.

Signature interaction: hovering or focusing a balloon in the hypothesis draws a leader line to its evidence row and highlights the verbatim quote; keyboard: tab through balloons. Motion grammar: plotter-draw — rules and gauges draw in once on load (reduced-motion: instant).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Logo mark: none exists; a simple typographic mark within the title block grammar is authored, not a pictorial logo.
