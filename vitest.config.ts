import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // A couple of B5 guard tests (index-approval-guard.test.ts,
    // check-fixtures-guard.test.ts) exercise the real CI scripts as
    // subprocesses and briefly mutate shared filesystem state (web/dist,
    // git index) to prove detection capability, then restore it. Running
    // test files in parallel workers would race on that shared state.
    // Fully sequential test files keep those tests deterministic; the
    // suite is small enough that this costs negligible wall time.
    fileParallelism: false,
  },
});
