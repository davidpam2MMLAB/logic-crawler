# Synthetic sample reports

All pages describe an invented bicycle workshop. No private website data is used.

- `clean-report`: zero broken destinations, missing anchors or orphans; three link promises; AI explicitly skipped.
- `defective-report`: one broken destination (`missing.html?view=full`), one missing same-page fragment (`#absent`), one orphan (`orphan.html`); two reviewable promises; AI explicitly skipped. Pricing-to-login is a planted semantic mismatch that wiring cannot judge.

Try the README commands to generate fresh reports under `out/` without changing these shipped samples. To intentionally regenerate samples for a new release, run the corresponding fixture command with `--out examples/clean-report` or `--out examples/defective-report`; preserve old samples outside the candidate first. Run IDs change each time; expected findings remain the same. These are static reports, not model-quality demonstrations.
