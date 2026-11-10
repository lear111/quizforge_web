# Local collection performance baseline (A1)

Use Node 24 and the checked-in lockfile. These scripts generate their own data; never point them at real banks. No service at 8787, Hub server, AI provider or SSH connection is used. There is no UI change or optimization in this task card.

From the repository root, choose a **nonexistent directory whose parent exists**:

```powershell
node core/scripts/dev/create-perf-fixture.mjs C:/dev/qf-perf-seed
node core/scripts/dev/measure-perf.mjs C:/dev/qf-perf-seed 3 off > baseline-off.json
node core/scripts/dev/measure-perf.mjs C:/dev/qf-perf-seed 3 on > baseline-on.json
# Optional: use a separate, unchanged checkout at 2a529cd with its own dependencies.
node core/scripts/dev/measure-perf.mjs C:/dev/qf-perf-seed 3 off C:/dev/quizforge-web-refactor-baseline/core/server/host/http/server.js > main-control.json
```

The generator refuses an existing destination. Only `quizforge-perf-a1-v2` is accepted by the measurement script; regenerate old v1 seeds. The v2 dataset contains 200 synthetic questions across three extension bindings, including three-child outline questions, and approximately 5,000,000 bytes of existing schemaVersion 1 state:

- All 200 questions have valid whiteboard ink. Forty have 720-point drafts of about 22 KiB each; the other 160 have 40-point drafts.
- Forty questions (every fifth question, spread across the bank) each have eight old-format receipts, alternating draft and whiteboard actions (320 receipts total). A deterministic binary search adjusts these receipts' ink point counts uniformly to approach the byte target. No random size tuning or padding fields are used.
- Two interrupted frozen rounds retain all 200 questions and their ink. Current ink and frozen history remain substantial even after B1 trims old receipts. No single current question state, even including its two frozen entries, exceeds 5% of the initial state size.
- `perf-fixture.json` includes `breakdown`: `receipts` is the sum of encoded current receipt arrays; `ink` is the sum of encoded current drafts; `history` is the encoded frozen-round array (including historical ink); `other` owns the remaining data, JSON keys, commas and enclosing structure. These are exclusive categories and sum exactly to `stateBytes` (test tolerance: zero bytes).

Type0 copies the built-in single-choice `question.schema.json`, `answer.schema.json` and `rules.js` from `extensions/基础题型/单选题` **at generation time**, retaining its manifest declarations, including `requiresApi` and `requiresRichText`. Its question documents and `selectedOptionId` answers pass the real host validation; missing/incompatible dependencies fail generation rather than falling back to permissive schemas. Type1/type2 retain lightweight synthetic rules, and type2 has three outline children. Generated copies are not committed.

The generator validates the persisted state with a fresh StateStore. The mock practice pages are for host API measurements, not browser interaction or visual acceptance. No real bank, answer or user image is included.

## Test grouping

```powershell
npm --prefix core test
npm --prefix core run test:perf
```

The default suite covers host, rule and frontend regressions, including timing unit tests; it excludes `core/test/performance/`. The separate `test:perf` group runs the real 5 MB fixture/HTTP smoke checks and statistics assertions. Its measured standalone duration exceeded 15 seconds (about 43 seconds before grouping), so it must be invoked explicitly for A1 or changes to these scripts. Report both commands and their results in the PR; a passing default suite alone does not validate the fixture. Matched default-suite runs with/without this file and their observed wall-time difference are recorded in the PR, separately from the file's own duration, since concurrent test scheduling prevents equating those two measurements.

Each benchmark run copies the seed's banks, extensions and state into its own OS temporary directory, starts one loopback server on an OS-assigned port, and executes sequentially (five progress messages per run go to stderr; raw JSON goes to stdout):

1. One collection overview (cold binding/state caches).
2. Twenty distinct question reads.
3. Twenty answer drafts.
4. Twenty whiteboard saves.
5. Ten submissions (the first creates a new frozen round).

Revision/request IDs follow real responses. The server is closed and only that run's temporary directory is removed in `finally`. The seed is never modified. Every repeated run begins from the same seed; a warm runtime/environment hash may still overlap opening as it does in the application. Do not run other tests/benchmarks simultaneously. Alternating off/on order on additional runs helps expose ordering and OS-cache effects. `off` disables request timing, leaving the same host code and instrumented helper fast paths in place: this measures collection instrumentation overhead, **not** zero-overhead unmodified main. For an unmodified-main control, use the same script/seed with that checkout's server module.

JSON output contains every sample (operation, elapsed milliseconds, byte count, phase durations), runtime/CPU, plus summary counts, median and nearest-rank P95. Client elapsed includes request encoding, loopback transfer and receiving all response bytes, but not parsing the final JSON. Server `total` stops before header construction; final socket-write latency is not independently available from Server-Timing. Small groups (especially cold open, n=3) have a weak P95: report the sample count. Compare per-operation medians/P95, not sums of independently computed percentiles. Keep raw outputs in ignored temporary storage and put measured tables and limitations in the PR.

Diagnostic phase definitions and overlap precedence are in [API](../reference/API.md#collection-diagnostics-a1). Restore normal behavior by omitting `timings:false`. Reverting A1 removes the instrumentation; no saved-data rollback is necessary because A1 never changes its format or migration rules.

## Known limitations

The current measurement script is completely serial. Its `queue` phase does not represent concurrent queueing; concurrency scenarios will be added in task card B4. Mock rules for type1/type2 and the absence of a browser also limit what this baseline can establish. Type0 exercises real single-choice schemas and rules, but this dataset does not represent every real extension or real AI/network performance.
