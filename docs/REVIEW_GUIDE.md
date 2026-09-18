# Engineering review guide

Umbern explores a research problem: how to connect public-record relationships while preserving what each source actually supports. This release makes a small, runnable part of the implementation available for inspection. It is not a hosted application or a validated legal-research service.

## A short walkthrough

1. Run `npm test` and `npm run demo` from the repository root using Node.js 24 or newer. No dependencies or credentials are needed. The demo prints a synthetic four-hop relationship path and its supporting source evidence.
2. Read [the design decisions](ARCHITECTURE.md), then inspect [the shared candidate contract](../graph/domain.ts) and [the ingestion boundary](../graph/core.ts).
3. Compare the behaviors below with the tests. Read [code provenance](CODE_PROVENANCE.md) for the source origin, AI assistance, and release-specific changes.

## Questions the code addresses

| Research concern | Implementation to inspect | Public verification |
| --- | --- | --- |
| Could two different people be silently combined? | [Entity resolution](../graph/core.ts) uses authoritative identifiers; names alone do not merge people or organizations. | [Graph tests](../tests/graph-core.test.ts) check shared identifiers and same-name separation. |
| Can an accepted relationship be traced to a source? | [Validation](../graph/validator.ts) and [persistence](../graph/store.ts) retain assertion evidence, source references, and rejected candidates. | [Graph tests](../tests/graph-core.test.ts) check accepted evidence and rejection of an empty-evidence relationship and incomplete claim. |
| Does a path retain its underlying support? | [Traversal](../graph/traversal.ts) returns bounded, cycle-safe paths with evidence and sources. | [Graph tests](../tests/graph-core.test.ts) check depth limits, filters, and evidence on each returned hop. |
| Is extraction inspectable rather than a model-generated assertion? | [Exhibit 21 parser](../agent/parsers/exhibit21.ts) extracts subsidiary rows deterministically. | [Parser tests](../tests/parser.test.ts) check names, jurisdictions, evidence text, duplicate rows, and empty input. |
| Does replay duplicate canonical records? | [Ingestion and storage](../graph/core.ts) support repeated ingestion. | [Replay test](../tests/replay.test.ts) compares record and evidence counts after replaying the synthetic fixture. |

## How to interpret the result

A documented connection is not a finding of influence, coordination, wrongdoing, or causation. Assertion categories such as `REPORTED` and `DERIVED` remain distinct from `ASSERTED`; a numeric confidence field is not a legal conclusion.

All seven public tests use synthetic data. They demonstrate specific behaviors, not comprehensive real-record accuracy. The parser uses limited table heuristics, and the exported-graph traversal has not been benchmarked at production scale. The core also permits some minimally described entities; relationship-evidence validation does not prove every entity field.

The full application's live source acquisition, private databases, frontend, and operational review workflow are excluded. See [publication boundaries](SANITIZATION.md) and the [README's scope and limitations](../README.md#scope-and-limitations).
