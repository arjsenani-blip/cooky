import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Geometry stubs jsdom lacks (Range.getClientRects) — ProseMirror
    // reads them on any selection reconcile, so a test that moves focus
    // with a live EditorView would otherwise throw inside a jsdom event
    // listener and fail the RUN (non-zero exit) with every assertion
    // still passing. See tests/_setup-jsdom.ts.
    setupFiles: ['tests/_setup-jsdom.ts'],
    // The property-based Loro / co-editing fuzz suites spin up many wasm CRDT
    // peers across dozens of seeds. That wasm memory accumulates in vitest's
    // reused fork workers (it isn't freed per file), and the SUM across suites
    // OOMs the ~7 GB CI runner — even though each file passes on its own, and
    // regardless of parallelism (serializing just funnels it all into one fork).
    // Skip the heaviest offenders on CI; they still run in local `npm test` and
    // the pre-release sweep. Typecheck + the rest of the suite still gate CI.
    // (transclusion-numbering-fuzz was excluded here too, but its blowup was
    // its own — unbounded growth-by-materialization, fixed 2026-07-16 with
    // size caps in the test — so it's back on CI.)
    exclude: [
      'tests/desktop/_*.ts',
      ...(process.env['CI']
        ? [
            'tests/collab/collab-transclusion-fuzz.test.ts',
            'tests/collab/loro-fuzz.test.ts',
            'tests/editor/collab-fuzz.test.ts',
          ]
        : []),
    ],
  },
  resolve: {
    alias: [
      // Stub `electron` for desktop-module tests. Electron is a real
      // dependency of `apps/desktop` but is NOT installed in the
      // project root, so tests can't import { app, BrowserWindow,
      // ipcMain } from 'electron' directly. The stub provides the
      // surface the bridge module uses, plus accessors for tests
      // to drive it.
      {
        find: /^electron$/,
        replacement: resolve(__dirname, 'tests/desktop/_electron-stub.ts'),
      },
      // The card-cutter engine package is never present under test —
      // resolve its dynamic import to the same inert no-op stub the
      // production build falls back to.
      {
        find: /^@cardcutter\/browser$/,
        replacement: resolve(__dirname, 'src/editor/card-cutter-stub.ts'),
      },
    ],
  },
});
