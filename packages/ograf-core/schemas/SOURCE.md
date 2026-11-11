# Vendored OGraf JSON schemas

These files are an unmodified copy of `v1/specification/json-schemas/` from
https://github.com/ebu/ograf

- Commit: `f89f78942cca0e035ba0c8896ed4d5defcbf0054`
- Copied: 2026-11-11

They are vendored so that validation works offline (no remote `$ref` fetching).
Refresh with `pnpm sync-schemas` (optionally `OGRAF_REF=<sha|branch>`), then run the tests.
