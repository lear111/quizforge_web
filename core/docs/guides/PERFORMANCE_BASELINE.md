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

The generator refuses an existing destination. It creates 200 synthetic questions across three extension bindings, including three-child outline questions; approximately 5,000,000 bytes of existing schemaVersion 1 state with valid ink, 32 old-format receipts on the first question and two interrupted frozen rounds. It validates the persisted state with a fresh StateStore. The mock practice pages are for host API measurements, not browser interaction or visual acceptance. No real bank, answer or user image is included.

Each benchmark run copies the seed's banks, extensions and state into its own OS temporary directory, starts one loopback server on an OS-assigned port, and executes sequentially (five progress messages per run go to stderr; raw JSON goes to stdout):

1. One collection overview (cold binding/state caches).
2. Twenty distinct question reads.
3. Twenty answer drafts.
4. Twenty whiteboard saves.
5. Ten submissions (the first creates a new frozen round).

Revision/request IDs follow real responses. The server is closed and only that run's temporary directory is removed in `finally`. The seed is never modified. Every repeated run begins from the same seed; a warm runtime/environment hash may still overlap opening as it does in the application. Do not run other tests/benchmarks simultaneously. Alternating off/on order on additional runs helps expose ordering and OS-cache effects. `off` disables request timing, leaving the same host code and instrumented helper fast paths in place: this measures collection instrumentation overhead, **not** zero-overhead unmodified main. For an unmodified-main control, use the same script/seed with that checkout's server module.

JSON output contains every sample (operation, elapsed milliseconds, byte count, phase durations), runtime/CPU, plus summary counts, median and nearest-rank P95. Client elapsed includes request encoding, loopback transfer and receiving all response bytes, but not parsing the final JSON. Server `total` stops before header construction; final socket-write latency is not independently available from Server-Timing. Small groups (especially cold open, n=3) have a weak P95: report the sample count. Compare per-operation medians/P95, not sums of independently computed percentiles. Keep raw outputs in ignored temporary storage and put measured tables and limitations in the PR.

Diagnostic phase definitions and overlap precedence are in [API](../reference/API.md#collection-diagnostics-a1). Restore normal behavior by omitting `timings:false`. Reverting A1 removes the instrumentation; no saved-data rollback is necessary because A1 never changes its format or migration rules.
