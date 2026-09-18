# Code provenance

The source files under `graph/`, `shared/`, and `agent/` were extracted from Maxwell D'Andrea's private Follow the Money backend at commit `64eb57940279320aef44a9649981ed272b2aaa5c` on September 17, 2026. Their implementation is unchanged in this release.

`tests/graph-core.test.ts` retains the first three original tests, with unused imports removed. The test requiring private Apple/Microsoft graph exports was excluded. The retained tests cover identifier convergence and name-only separation, rejected candidates and evidence persistence, and bounded traversal with fixture exclusion from production exports.

`tests/parser.test.ts`, `tests/replay.test.ts`, `examples/demo.ts`, the documentation, package metadata, and CI workflow were prepared for this public release with AI assistance. The new tests exercise the extracted implementation; they are not represented as historical tests from the private project.

The release starts a new Git history. Private commit history and operational artifacts are not included.
