# 2027 Option B — pricing and minimum stays for review

**PROPOSAL ONLY — NOT APPROVED OR DEPLOYED.** Both cottages open from **Saturday 20 March 2027**, final occupied night **Friday 1 October** and final checkout **Saturday 2 October**. All prices are proposed **GBP per cottage per occupied night**, inclusive accommodation headline prices only. No automatic direct discount, fees, cleaning supplement or tax model is assumed.

This proposal refines the 2026 pricing review's *Option B* monthly baselines (Geranium / Honeysuckle): April £185 / £215, May £205 / £230, June £215 / £240, July £235 / £265, August £250 / £285, September £210 / £235. New overlays remain recommendations for approval.

## 1. Proposed minimum stay by occupied night

| Nights within dates (inclusive) | Classification | Minimum stay | Rationale |
| --- | --- | ---: | --- |
| 20–25 March | Low | 3 | Opening before the Easter break |
| 26 March–9 May | Shoulder | 5 | Easter, staggered French spring breaks, Dutch May break and bank holidays |
| 10–21 May | Low | 3 | Post-holiday gap |
| 22 May–9 July | Shoulder | 5 | May half term and early-summer families/couples |
| 10 July–3 September | Peak | 7 | Dutch, French, British and Guernsey main summer travel |
| 4–19 September | Shoulder | 5 | Saturday 4 September handover into post-peak |
| 20 September–1 October | Low | 3 | Quieter final fortnight |

**Important:** The current stay engine requires the *highest minimum stay among all occupied nights* of a proposed visit. A 5-night stay crossing into a 7-night peak date will be rejected, even if arrival is in shoulder season. No Saturday-only arrival restriction is proposed. All dates are inclusive **occupied nights**, not checkout dates.

## 2. Proposed nightly rates, both cottages

| Nights within dates (inclusive) | Geranium | Honeysuckle | Reason |
| --- | ---: | ---: | --- |
| 20–25 March | £185 | £215 | Opening low season: April Option B baseline extended to March |
| 26 March–11 April | £205 | £235 | Easter uplift |
| 12–23 April | £185 | £215 | Original April Option B |
| 24–30 April | £195 | £225 | Dutch May holiday uplift |
| 1–9 May | £215 | £245 | Early May holidays, bank holiday, Liberation Day |
| 10–21 May | £205 | £230 | Original May Option B |
| 22 May–6 June | £225 | £250 | May half-term uplift |
| 7–30 June | £215 | £240 | Original June Option B |
| 1–21 July | £235 | £265 | Original July Option B |
| 22–31 July | £250 | £285 | Main UK summer holiday uplift |
| 1–31 August | £260 | £295 | August peak uplift (in prior recommended range) |
| 1–3 September | £235 | £265 | Final three late-summer peak nights |
| 4–30 September | £210 | £235 | Original September Option B |
| 1 October | £185 | £215 | Final low-season night |

Rates are composed as **non-overlapping inclusive date ranges**; there is exactly one price for each cottage for every night in the holiday season. Mixed-period stays are summed night-by-night by the existing engine.

## 3. Illustrative commercial figures, *not a revenue forecast*

| Example | Geranium | Honeysuckle | Combined |
| --- | ---: | ---: | ---: |
| Full 7-night April baseline week | £1,295 | £1,505 | £2,800 |
| Full 7-night August peak week | £1,820 | £2,065 | £3,885 |
| 28 Aug–4 Sep 2027 **unapproved model calculation only** | £1,745 | £1,975 | £3,720 |

**Do not reprice the already-reserved 28 Aug–4 Sep direct booking using these figures.** The customer had been shown Airbnb totals of £1,630 and £1,845 (£3,475 combined) and previously asked about a returning-guest direct discount. The agreed private booking price must be established separately and retained; this exercise does not change payment or booking status.

The season contains **196 occupied nights per cottage**. At 100% paid occupancy, these proposed rates imply a purely theoretical gross accommodation-price ceiling of **£43,390 for Geranium and £49,080 for Honeysuckle**, or £92,470 combined, before vacancies, fees, concessions and operating costs. This is **not** an occupancy/revenue prediction.

## 4. Basis for holiday overlays

- Guernsey summer term ends 22 July and local May half-term runs 31 May–4 June 2027. Source: [Vale Primary official term calendar](https://www.valeprimary.sch.gg/news-and-events/term-dates).
- English school breaks: Easter around 26 March–9 April, May half-term 31 May–4 June, summer from late July. Source: [Portsmouth City Council term calendar](https://www.portsmouth.gov.uk/services/schools-and-learning/schools/school-term-dates).
- France's zone-based spring breaks are staggered from 3 April to 3 May and summer holidays begin 3 July. Source: [Service Public France](https://www.service-public.gouv.fr/particuliers/vosdroits/F31952?lang=fr).
- Dutch national May break runs 24 April–2 May (some schools extend); summer starts 10, 17 or 24 July by region and lasts into early September. Source: [Government of the Netherlands](https://www.government.nl/themes/education/school-holidays/overview-of-school-holiday-dates-per-academic-year/school-holiday-dates-2026-2027).

These dates justify *when* to consider overlays; they do not prove an exact achievable nightly market price.

## 5. Acceptance gates before deployment

1. Approve or amend **each** proposed rate and stay band, especially March opening, Easter, May holidays, July peak commencement, late-August uplift and September step-down.
2. Verify comparable 2027 Airbnb guest-facing quotes, cleaning inclusions and platform service-fee treatment for both listings. The file is a pricing proposal, **not** a guarantee of demand at these values.
3. Preserve all existing Airbnb bookings and the negotiated off-Airbnb booking of 28 August–4 September; no historical repricing.
4. Finalise direct cancellation and refund terms, total-price disclosure and payment arrangements.
5. **Only after explicit owner sign-off**, generate a separate approved production config with correct `APPROVED_FOR_LIVE_BOOKINGS` marker and rehearse against production-like acceptance tests. Never simply copy this proposed file to deployed SSM.
6. Staging keeps its **synthetic** £100/£120 nightly rate fixtures. PR #41 stays draft, the public website stays Airbnb-first.

Machine-readable proposal: [`config/proposed-2027-reviewed-option-b.json`](config/proposed-2027-reviewed-option-b.json). Its top-level and nested rate approval markers deliberately prevent live pricing use. Regression tests in `test/season-plan.test.mjs` check full 196-night coverage, overlay boundaries and mixed-month nightly totals.
