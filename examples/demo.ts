import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphCore } from '../graph/core.ts';
import { EvidenceStore } from '../graph/store.ts';
import { ingestDeepTraversalFixture } from '../graph/fixtures.ts';
import { findPath } from '../graph/traversal.ts';

const directory = await mkdtemp(join(tmpdir(), 'umbern-demo-'));
const store = new EvidenceStore(':memory:');
try {
  const core = new GraphCore(store);
  const run = core.startRun('ShowcaseDemo');
  const ids = ingestDeepTraversalFixture(core, run);
  core.finishRun(run, 'COMPLETED');
  const graph = await core.exportCanonicalGraph(join(directory, 'graph.json'), { includeTestFixtures: true });
  const path = findPath(graph, ids.personA, ids.organizationB, { maxDepth: 4 });
  console.log('Umbern: synthetic offline demonstration (not real-world findings)');
  console.log(`Graph: ${graph.nodes.length} entities, ${graph.edges.length} relationships`);
  console.log(`Evidence-backed path: ${path.found ? 'found' : 'not found'}, ${path.depth} hops`);
  for (const hop of path.hops) {
    console.log(`${hop.relationship.predicate}: ${hop.relationship.evidence}`);
  }
  console.log('A documented path does not establish causation or wrongdoing.');
} finally {
  store.close();
  await rm(directory, { recursive: true, force: true });
}
