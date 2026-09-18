# Design decisions

## One canonical store

Source workers produce shared candidate types. `GraphCore` owns the ingestion boundary and records validation and resolution decisions alongside accepted records. SQLite retains entities, identifiers, relationships, events, claims, source documents, evidence assertions, and independently attributable agent runs.

## Conservative resolution

Authoritative identifiers can connect differently named records to the same canonical entity. Matching names alone do not merge people or organizations. False separation is preferable to silently linking different actors. Identifier conflict and review primitives exist in the core, but this public release is not an operational review system.

## Evidence belongs to the assertion

An accepted relationship retains its source, evidence excerpt, evidence class, extraction method, confidence, and assertion type. Rejected candidates remain inspectable. Source-document hashes identify the represented content; this slice does not contain or verify the private raw-source cache.

## Bounded queries

Traversal caps depth, handles cycles, supports filters, and returns source-backed path hops. The current exported-graph approach is intentionally small-scale. Production-sized graphs would need indexed query execution and measured resource bounds.

## Precise semantics

Ownership, employment, accounting consolidation, contributions, and independent expenditures are different predicates. Temporal fields preserve when a relationship is supported. The research interface should show documented structure and chronology without manufacturing a verdict.

## Deterministic extraction before model extraction

The included Exhibit 21 parser uses document structure rather than an LLM. Its limited HTML heuristics are appropriate to inspect and fixture-test, but do not guarantee exhaustive filing coverage. The full source pipelines, API retry policies, and LLM extraction code are outside this release.
