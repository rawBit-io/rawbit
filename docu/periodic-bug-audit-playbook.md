# Periodic bug audit playbook (v2)

A repeatable, *incremental* process for finding the bugs that feature work and
green test runs miss. Companion to `periodic-bug-audit-plan.md`; this version
adds persistent audit state, a pattern library, diff-scoped audits, stop rules,
and dynamic techniques.

Three principles:

1. **Green tests are a starting signal, not proof.** Audits attack edge cases,
   contracts, stale state, races, legacy data, and error paths.
2. **Audits are incremental.** Every audit consumes the state of the previous
   one (findings, refutations, deferrals, coverage) and never re-pays full
   discovery cost. An audit that rediscovers a known false positive failed.
3. **Every audit leaves three artifacts:** a dated report, regression tests,
   and updates to the pattern library / audit state.

## Audit state (lives in `docu/audit-state.md`, updated every audit)

| Section | Contents |
|---|---|
| Coverage ledger | Area → last audited date → findings count → next due. Rotation is driven by this table, not memory. |
| Refuted registry | Every refuted finding ever, one line each, with why. Fed verbatim into finder prompts as "known, do not re-report". |
| Deferred registry | Accepted-risk findings with owner decision and date (e.g. old-lesson trace drift). |
| Flake quarantine | Known flaky tests, date observed, suspected mechanism, last re-verification. |
| Escapes | Bugs found in production/usage that a prior audit missed, with the reason (wrong area, wrong technique, prompt gap). |

## Pattern library (lives in `docu/bug-patterns.md`)

Structural bug classes with grep heuristics and past instances. Every serious
bug adds or strengthens an entry; every audit greps code changed since the
last audit against **all** entries. Seed entries from the 2026-06 audit:

| Class | Heuristic |
|---|---|
| One live canvas, many writers | callers passing non-active ids to functions that snapshot live state (`saveTabData`-shaped APIs) |
| Scheduled callbacks without ownership | `setTimeout`/`rAF`/worker callbacks lacking a generation counter or tab check |
| Ports/handles that exist nowhere | port enumeration diverging from render rules (`buildPorts` vs rendered handles) |
| Non-monotonic counters assumed monotonic | counters rewound on context switch but mirrored into state/effects |
| Caches & sentinels not cleared on all exits | module-level caches/sentinels written on error or timeout paths (`_cycle`, lru, registry sets) |
| Stale values surviving structural removal | remove/re-add of dynamic fields, group instances, output ports |
| Silent-failure UX | bare `return` on failure paths where the user expects feedback |

## Audit types and cadence

| Type | Cadence | Scope and method |
|---|---|---|
| Diff audit | Every 1-2 weeks, cheap | `git log --since=<last audit>` → changed files + their blast radius. Finder pass on the diff, pattern-library grep on new code. 1-2 hours. |
| Focused subsystem audit | Every 2-4 weeks | One area from the coverage ledger (oldest "last audited" wins). Full pipeline below. |
| Release audit | Before any public release or lesson change | Golden suites, lesson lifecycle checks, prod-build e2e, security quick pass. |
| Post-incident audit | After any serious bug | Add the pattern to the library, then hunt that class across the whole codebase. |
| Full adversarial audit | Quarterly | All areas in parallel, loop-until-dry, verification panel. The 2026-06 audit is the template. |
| Deep security pass | Twice a year | Dependency CVEs (`npm audit`, `pip list --outdated` + advisories), input validation, rate limits, share/Turnstile abuse, secrets scan. |

## The pipeline (full and focused audits)

1. **Prep pack** (before any finder runs): last report + refuted registry +
   deferred registry, coverage ledger, git diff since last audit, production
   signals (`logs/calc_latency_monitor.jsonl`, error rates, 429 budget
   rejections), open flake list. Paste the relevant parts into every prompt.
2. **Finder pass** — parallel, area-scoped, each with an explicit file list
   and a hard cap (max ~8 findings, quality over quantity, "only what you
   would defend under adversarial review"). Finders never fix. Known/refuted/
   deferred findings are named in the prompt as out of scope.
3. **Dedup** — by file + line proximity + normalized title, against both this
   run's findings and the registries.
4. **Verification panel** — 3 verifiers per finding with *distinct lenses*:
   (a) refute from the code, default to not-real; (b) trace real-world
   reachability from a user action or API call; (c) check mechanism, line
   numbers, and whether the proposed fix would work. Quorum ≥2 confirms.
   Verifier corrections are part of the finding record — fixes follow the
   corrected mechanism, not the original claim.
5. **Reproduction** — a failing test (unit > integration > e2e) for every
   confirmed finding before the fix where feasible; otherwise a script or
   documented manual repro.
6. **Fix pass** — separate from finding. Smallest fix restoring the invariant,
   existing helpers preferred, regression test identified before implementing.
   Where one guard kills a class (e.g. an active-tab check in a save API), fix
   the class, then the callers.
7. **Verify** — new tests fail on pre-fix code where practical; full stacks
   green; behavior changes reflected in docs and, when calc-relevant, in
   `flow-calc-regression-tests.md`.
8. **Close-out** — report written, audit state updated (coverage ledger,
   registries, pattern library), metrics recorded.

**Stop rule:** an audit ends when two consecutive finder rounds produce
nothing new (loop-until-dry), or when the time/token budget set at the start
is reached — whichever comes first. Record which one it was; budget-stopped
audits leave the unswept areas first in the next ledger rotation.

## Techniques beyond code reading

- **Property-based fuzzing** (backend; Hypothesis is already a dependency):
  serialization/parse roundtrips, varint/hex edge cases, script execution on
  adversarial inputs, flow JSON shape fuzz against `/bulk_calculate`.
- **Mutation testing** (quarterly, calc-critical modules only:
  `calc_functions/`, `graph_logic.py`, `src/lib/flow/`): mutants that survive
  the golden suites mark blind spots — fix the tests, not just the score.
- **Prod-build e2e**: run the e2e goldens once against `vite build` +
  `vite preview` per release audit; dev-server-only testing misses
  minification, env-flag, and caching differences.
- **Console-noise policy**: test runs failing on unexpected `console.error`
  catch swallowed failures cheaply.
- **Long-session smoke**: one scripted 30-minute session (imports, tab
  switches, recalcs) watching heap growth and listener counts — leak class.
- **Environment honesty** (hard-won): restart dev servers before trusting any
  e2e bisect (stale module graphs produce phantom failures on *every* tree);
  remember the backend budget is per-IP, so parallel browser projects starve
  each other — "passes isolated, fails parallel" usually means contention,
  not a bug.

## Lesson/golden lifecycle (release audits)

- Backend golden corpus auto-covers new lesson files; **e2e scenarios and
  canonical payload snapshots do not** — a new visible lesson requires a
  scenario in `flow.roundtrip.spec.ts` and a snapshot in
  `calcGraphCanonical.test.ts`. Checklist item, not memory.
- Review known drift: `STALE_STEPS_NODES` may only shrink; decide explicitly
  whether to run `UPDATE_FLOW_GOLDENS=1` and review the lesson diff.
- Determinism canaries and BIP vectors must be green before goldens are
  trusted at all.

## Evidence, severity, reports

Adopt the finding schema, severity guide, and report format from
`periodic-bug-audit-plan.md` unchanged, with two additions per finding:
a **dedup key** (file + mechanism, stable across audits) and a
**verification record** (panel votes + corrections). Reports stay in
`docu/bug-audit-YYYY-MM-DD.md` with a verification report after fixes.

## Metrics (per audit, recorded in audit state)

- Findings by severity; confirmation rate per finder area (tunes prompts);
  refutation rate (high = noisy finders, zero = soft verifiers).
- Time/cost spent vs. stop rule reached.
- Escapes since last audit and why they were missed.

## AI execution notes (what actually worked)

- Run finders in parallel with explicit file lists; never share files between
  concurrently *fixing* agents.
- Verifier panels are cheap insurance: in 2026-06, 0 of 56 panel-verified
  findings were refuted outright, but several had wrong triggers whose
  corrections changed the fix.
- Cap finder output; uncapped finders pad with style nits.
- Keep transcripts; partial runs (rate limits, crashes) can be recovered from
  structured outputs without re-running finders.
- The finder/refuter/verifier prompts in `periodic-bug-audit-plan.md` are
  good starting points; always append the prep pack.
