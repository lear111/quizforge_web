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

## Inspect real state sizes (S1, read-only)

Unlike the synthetic generators above, this command is intended for the project owner to run on their own application **data root** (the directory containing `.state`). It starts no server, uses no network and does not create, migrate, repair or write any file:

```powershell
node core/scripts/dev/inspect-state-sizes.mjs "D:/QuizForge-data"
```

Standard output is JSON Lines: one row for each regular `<64-hex>.json` practice file directly under `.state` or `.development/.state`, followed by one summary. Other settings/resources, backups and symbolic links/junctions are not traversed. The caller may redirect stdout to a file **outside** the data directory if wanted; that is a shell operation, not a script write. Normal reads may update filesystem access-time metadata according to OS policy; content hashes and modification times are not altered by the script. Run with no simultaneous app writes for an interpretable snapshot.

Rows identify only `scope` (`local` / `development`) and the hash filename. They contain file bytes/mtime, question and current-record counts, modern round count/bytes, legacy record count/bytes, receipt/ink metrics, largest current-question draft and the receipt-heaviest current question's count/bytes. No question ID, title, content, answer, exception text, absolute path, username or model credentials are printed. A current question has records if it is draft/submitted, has a non-null answer/result/draft, or has receipts; a revision number alone is not evidence of a current record.

`allReceiptCount` / `allReceiptBytes` inspect all known receipt containers (`receipts`, `finishReceipts`, `restartReceipts`, `completionReceipts`, `editReceipts`), including frozen history and nested copies. `allDraftBytes` includes every field named `draft`, including receipt/history copies. These occurrence metrics **overlap** and must not be added to percentages. The max-per-question metrics apply to current `questions`, not frozen copies; no identifying question key is emitted.

`categoryBytes` is the exclusive partition used for aggregate percentages: top-level `historyRounds`, `history` (`legacyHistory`), and `upgradedCompletion` each own their full subtree; outside these, receipt arrays own theirs, then draft fields (`ink`), then answer/result fields, with no descent into an already-owned value. `other` owns all remaining data, keys, punctuation and source whitespace. JSON value sizes use `parseJson` and parent-aware `projectJson` / `jsonBytes`, retaining spellings such as `1.0` / `1e0`, even when the value itself is primitive. Empty arrays and null fields include their encoded bytes. `answerResultBytes` / `otherBytes` are the corresponding exclusive parts. `breakdown` projects this to A1's four categories (`receipts`, `ink`, `history`, `other`); on its v2 seed it equals `perf-fixture.json` exactly.

Every discovered state receives a before SHA-256, and all receive an after SHA-256 in a second pass; the file set is checked again. `hashesUnchanged` and `fileSetUnchanged` confirm what was observed, not filesystem transaction isolation. Concurrent changes or unavailable verification return exit code **2**; an invalid/unreadable root returns **1** with a generic error. A malformed state still reports `无法解析`, byte size and available hashes, then processing continues. Malformed bytes have their own `unparsed` aggregate category. Summary size statistics include these files; median is the arithmetic middle, P90 is nearest-rank, and empty-input statistics are null. No assumptions about real-state size distribution are made before the owner runs this command.

The S1 v2 regression reuses the existing generated fixture in `test:perf`; it does not add a second expensive generator run. Fast corruption/privacy/literal/read-only tests run in the default suite. S1 does not change StateStore, B2b's paused status or any persistent layout.

## Known limitations

The current measurement script is completely serial. Its `queue` phase does not represent concurrent queueing; concurrency scenarios will be added in task card B4. Mock rules for type1/type2 and the absence of a browser also limit what this baseline can establish. Type0 exercises real single-choice schemas and rules, but this dataset does not represent every real extension or real AI/network performance.
