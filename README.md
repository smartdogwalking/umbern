# Umbern

[![Offline tests](https://github.com/smartdogwalking/umbern/actions/workflows/test.yml/badge.svg)](https://github.com/smartdogwalking/umbern/actions/workflows/test.yml)

An evidence-backed research graph for exploring documented relationships between companies, people, funds, and public institutions. Developed under the working name **Follow the Money**.

The engineering problem: public records use inconsistent identities and relationship semantics. A useful research tool needs to reconcile those records without losing the source, flattening subsidiaries into their parents, or treating a connection as proof of causation.

This repository is a **sanitized, runnable code showcase**, not the full application or a production service. It includes the original graph engine, a deterministic SEC Exhibit 21 parser, and offline tests with synthetic data. No API keys, accounts, external services, or dependency installation are required.

**Start here:** [Engineering review guide](docs/REVIEW_GUIDE.md) · [Design decisions](docs/ARCHITECTURE.md) · [Code provenance](docs/CODE_PROVENANCE.md)

## Try it

Use Node.js 24 or newer:

```sh
git clone https://github.com/smartdogwalking/umbern.git
cd umbern
npm test
npm run demo
```

The demo builds a synthetic graph in an in-memory SQLite database, follows a four-hop path, prints the supporting evidence, and removes its temporary export. It makes no network requests. Node may print a notice about its built-in SQLite API.

The public suite currently contains seven passing offline tests.

## What to review

| Area | Code | Behavior covered |
| --- | --- | --- |
| Shared ingestion contract | [graph/domain.ts](graph/domain.ts) | Workers emit candidates rather than writing their own canonical graphs |
| Entity resolution | [graph/core.ts](graph/core.ts) | Shared authoritative IDs converge; people and organizations do not merge by name alone |
| Evidence validation | [graph/validator.ts](graph/validator.ts) | Missing evidence and incomplete claims are rejected |
| Canonical persistence | [graph/store.ts](graph/store.ts) | SQLite stores source documents, assertions, validation results, and run attribution |
| Traversal | [graph/traversal.ts](graph/traversal.ts) | Bounded, cycle-safe paths retain relationship evidence and sources |
| Deterministic extraction | [agent/parsers/exhibit21.ts](agent/parsers/exhibit21.ts) | Table-based subsidiary extraction preserves jurisdiction and evidence text |
| Replay safety | [tests/replay.test.ts](tests/replay.test.ts) | Re-ingestion does not add canonical records or duplicate evidence in the synthetic fixture |

## Architecture

```text
Public source → specialized worker → shared candidate contract
                                      ↓
                         resolution + validation
                                      ↓
                       canonical SQLite graph + evidence
                                      ↓
                       bounded paths / research interface
```

The full private project has source-specific workers for SEC records, corporate registries, political money, and federal procurement. This public slice publishes the shared engine and one parser; it does **not** include those live acquisition pipelines, their cached data, the production database, or the frontend.

Relationships preserve source references, excerpts, extraction methods, confidence, and temporal fields. `ASSERTED`, `REPORTED`, `DERIVED`, and `ESTIMATED` remain distinct. A graph path does not establish influence, coordination, wrongdoing, or causation.

## Project ownership and AI assistance

Created by Maxwell D'Andrea with AI-assisted development, including code generation, iteration, testing, and preparation of this public release. The source and offline harness make the architecture and behavior available for direct inspection.

See [code provenance](docs/CODE_PROVENANCE.md), [design decisions and limitations](docs/ARCHITECTURE.md), and [publication boundaries](docs/SANITIZATION.md).

## Scope and limitations

- The demonstration data is entirely synthetic. Passing tests do not establish correctness for all real-world source records.
- This is a research prototype, not an audited legal-research product or production-ready service.
- The Exhibit 21 parser is heuristic and table-oriented; its deduplication uses names within one document. That is not cross-source canonical entity resolution.
- The slice has no authentication, hosted API, review interface, or large-scale query benchmark.
- The original core's entity-validation policy permits some minimally described entity candidates. Evidence requirements for relationships and claims should not be confused with universal proof of every entity field.
- The public test suite covers this slice only, not the complete private application's regression suite.

Code is shared for review. No open-source license is granted in this release.
