import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphCore } from '../graph/core.ts';
import { EvidenceStore } from '../graph/store.ts';
import { ingestDeepTraversalFixture } from '../graph/fixtures.ts';

test('replaying the synthetic fixture adds no canonical records or evidence', () => {
  const store = new EvidenceStore(':memory:');
  try {
    const core = new GraphCore(store);
    const tables = ['entities', 'entity_identifiers', 'relationships', 'events', 'source_documents', 'evidence_assertions'];
    const counts = () => tables.map(table => (store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
    const first = ingestDeepTraversalFixture(core, core.startRun('FixtureAgent'));
    const before = counts();
    const second = ingestDeepTraversalFixture(core, core.startRun('FixtureAgent'));
    assert.deepEqual(second, first);
    assert.deepEqual(counts(), before);
  } finally {
    store.close();
  }
});
