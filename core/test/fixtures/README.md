# Legacy regression fixtures

`legacy-extensions/` preserves prior published short-answer packages for compatibility and upgrade tests. `legacy-banks/` preserves duplicate historical demos used by those tests. These directories are not loaded by the application catalog.

The small modules under `core/shared/richtext/` re-export the active shared document validators so the relocated packages keep their original source import paths. Released fixture files and bundled rules are preserved byte for byte; historical build and demo scripts write here only when explicitly invoked.
