import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceStore } from '../graph/store.ts';
import { GraphCore } from '../graph/core.ts';
import { ingestDeepTraversalFixture } from '../graph/fixtures.ts';
import {
  appendTraversalTrail, findPath, getCareerTransitions, getNeighbors, getTimeline, mergeGraphs, searchEntities, traverseGraph,
} from '../graph/traversal.ts';

function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }

function source(core: GraphCore, runId: string, provider: string, externalId: string) {
  return core.ingestSource(runId, {
    provider, documentType: 'PUBLIC_RECORD', externalId, title: `${provider} record`, publishedAt: '2024-01-01',
    sourceUrl: `https://example.com/${provider.toLowerCase()}/${externalId}`, rawStoragePath: `work/${externalId}.txt`,
    sha256: digest(`${provider}:${externalId}`), parserVersion: 'test/1',
    evidenceClass: provider === 'JOURNALISM' ? 'SINGLE_SOURCE_REPORTING' : provider === 'TEST_FIXTURE' ? 'FIRST_PARTY' : 'OFFICIAL_RECORD',
    sourceAgent: `${provider}Agent`,
  })!;
}

test('canonical ingestion resolves authoritative identifiers across source agents but never people by name alone', () => {
  const store = new EvidenceStore(':memory:'); const core = new GraphCore(store); const runId = core.startRun('ContractTest');
  const registrySource = source(core, runId, 'REGISTRY', 'company-1');
  const journalismSource = source(core, runId, 'JOURNALISM', 'company-1-report');
  const companyA = core.ingestEntity(runId, {
    entityType: 'COMPANY', canonicalName: 'Example Holdings Ltd', identifiers: [{ scheme: 'LEI', value: 'LEI-EXAMPLE-1', sourceDocumentId: registrySource }],
    aliases: ['Example Holdings'], sourceDocument: { sourceDocumentId: registrySource }, sourceAgent: 'RegistryAgent',
  });
  const companyB = core.ingestEntity(runId, {
    entityType: 'COMPANY', canonicalName: 'Example Holdings Limited', identifiers: [{ scheme: 'LEI', value: 'LEI-EXAMPLE-1', sourceDocumentId: journalismSource }],
    sourceDocument: { sourceDocumentId: journalismSource }, sourceAgent: 'RelationshipIntelligenceAgent',
  });
  assert.equal(companyA, companyB);
  const personA = core.ingestEntity(runId, { entityType: 'PERSON', canonicalName: 'Alex Smith', identifiers: [], sourceAgent: 'RegistryAgent' });
  const personB = core.ingestEntity(runId, { entityType: 'PERSON', canonicalName: 'Alex Smith', identifiers: [], sourceAgent: 'JournalismAgent' });
  assert.notEqual(personA, personB);
  const organizationA = core.ingestEntity(runId, { entityType: 'ORGANIZATION', canonicalName: 'Shared Name LLC', identifiers: [], sourceAgent: 'RegistryAgent' });
  const organizationB = core.ingestEntity(runId, { entityType: 'ORGANIZATION', canonicalName: 'Shared Name LLC', identifiers: [], sourceAgent: 'JournalismAgent' });
  assert.notEqual(organizationA, organizationB);
  assert.equal((store.db.prepare('SELECT COUNT(*) n FROM resolution_candidates').get() as { n: number }).n, 6);
  store.close();
});

test('candidate validation and source-independent evidence are persisted before graph commit', () => {
  const store = new EvidenceStore(':memory:'); const core = new GraphCore(store); const runId = core.startRun('PoliticalMoneyAgent');
  const sourceId = source(core, runId, 'FEC', 'contribution-1');
  const person = core.ingestEntity(runId, { entityType: 'PERSON', canonicalName: 'Contributor', identifiers: [{ scheme: 'FEC_ID', value: 'P-1', sourceDocumentId: sourceId }], sourceAgent: 'PoliticalMoneyAgent' })!;
  const committee = core.ingestEntity(runId, { entityType: 'PAC', canonicalName: 'Committee', identifiers: [{ scheme: 'FEC_ID', value: 'C-1', sourceDocumentId: sourceId }], sourceAgent: 'PoliticalMoneyAgent' })!;
  const relationshipId = core.ingestRelationship(runId, {
    subject: { entityId: person }, predicate: 'DONATED_TO', object: { entityId: committee }, validFrom: '2024-01-01', amount: 500, currency: 'USD',
    assertionType: 'ASSERTED', confidence: 0.99, sourceDocument: { sourceDocumentId: sourceId }, sourceRecordId: 'row-1',
    evidence: { excerpt: 'Official filing records a $500 contribution.', evidenceClass: 'OFFICIAL_RECORD', fields: { amount: 500 } },
    extractionMethod: 'FEC_STRUCTURED', sourceAgent: 'PoliticalMoneyAgent',
  });
  assert.ok(relationshipId);
  const badRelationship = core.ingestRelationship(runId, {
    subject: { entityId: person }, predicate: 'DONATED_TO', object: { entityId: committee }, assertionType: 'ASSERTED', confidence: 1,
    sourceDocument: { sourceDocumentId: sourceId }, evidence: { excerpt: '', evidenceClass: 'OFFICIAL_RECORD' }, extractionMethod: 'FEC_STRUCTURED', sourceAgent: 'PoliticalMoneyAgent',
  });
  assert.equal(badRelationship, undefined);
  const eventId = core.ingestEvent(runId, {
    eventType: 'DONATION', eventDate: '2024-01-01', amount: 500, currency: 'USD', description: 'Contribution event',
    participants: [{ entity: { entityId: person }, role: 'CONTRIBUTOR' }, { entity: { entityId: committee }, role: 'RECIPIENT' }],
    assertionType: 'ASSERTED', confidence: 0.99, sourceDocument: { sourceDocumentId: sourceId }, sourceRecordId: 'event-1',
    evidence: { excerpt: 'Official filing records a contribution event.', evidenceClass: 'OFFICIAL_RECORD' }, extractionMethod: 'FEC_STRUCTURED', sourceAgent: 'PoliticalMoneyAgent',
  });
  assert.ok(eventId);
  const claimId = core.ingestClaim(runId, {
    subject: { entityId: committee }, claimType: 'PUBLIC_DESCRIPTION', statement: 'The committee described its stated purpose.',
    assertionType: 'REPORTED', confidence: 0.8, sourceDocument: { sourceDocumentId: sourceId }, sourceRecordId: 'claim-1',
    evidence: { excerpt: 'The source contains the committee description.', evidenceClass: 'SINGLE_SOURCE_REPORTING' },
    extractionMethod: 'DOCUMENT_TEXT', sourceAgent: 'RelationshipIntelligenceAgent',
  });
  assert.ok(claimId);
  const badClaim = core.ingestClaim(runId, {
    subject: { entityId: committee }, claimType: 'PUBLIC_DESCRIPTION', statement: '', assertionType: 'REPORTED', confidence: 0.8,
    sourceDocument: { sourceDocumentId: sourceId }, evidence: { excerpt: 'Incomplete source record.', evidenceClass: 'SINGLE_SOURCE_REPORTING' },
    extractionMethod: 'DOCUMENT_TEXT', sourceAgent: 'RelationshipIntelligenceAgent',
  });
  assert.equal(badClaim, undefined);
  assert.equal((store.db.prepare('SELECT COUNT(*) n FROM evidence_assertions').get() as { n: number }).n, 3);
  assert.equal((store.db.prepare("SELECT assertion_type, evidence_class FROM evidence_assertions WHERE subject_type = 'CLAIM'").get() as { assertion_type: string }).assertion_type, 'REPORTED');
  assert.equal((store.db.prepare('SELECT COUNT(*) n FROM rejected_candidates').get() as { n: number }).n, 2);
  assert.ok(Number((store.db.prepare('SELECT COUNT(*) n FROM validation_results').get() as { n: number }).n) >= 5);
  store.close();
});

test('recursive traversal is bounded, cycle-safe, filterable, recenterable, and preserves evidence paths', async () => {
  const store = new EvidenceStore(':memory:'); const core = new GraphCore(store); const runId = core.startRun('FixtureAgent');
  const ids = ingestDeepTraversalFixture(core, runId);
  const directory = await mkdtemp(join(tmpdir(), 'graph-core-'));
  const graph = await core.exportCanonicalGraph(join(directory, 'with-fixtures.json'), { includeTestFixtures: true });
  assert.equal(getNeighbors(graph, ids.personA).nodes.length, 2);
  assert.equal(traverseGraph(graph, ids.personA, { depth: 2 }).nodes.length, 3);
  assert.equal(traverseGraph(graph, ids.personA, { depth: 4 }).nodes.length, 5);
  assert.throws(() => traverseGraph(graph, ids.personA, { depth: 5 }), /between 1 and 4/);
  assert.equal(traverseGraph(graph, ids.personA, { depth: 4, predicates: ['PARTNER_AT'] }).edges.length, 1);
  for (const entityId of Object.values(ids).filter((value) => value !== ids.sourceDocumentId)) assert.equal(traverseGraph(graph, entityId, { depth: 1 }).root!.id, entityId);
  const path = findPath(graph, ids.personA, ids.organizationB, { maxDepth: 4 });
  assert.equal(path.found, true); assert.equal(path.depth, 4); assert.equal(path.hops.every((hop) => hop.relationship.evidence && hop.source), true);
  assert.ok(getTimeline(graph, ids.companyA).some((entry) => entry.kind === 'EVENT'));
  const career = getCareerTransitions(graph, ids.companyA);
  assert.equal(career[0].person.id, ids.personB); assert.equal(career[0].previous.organization.id, ids.organizationB);
  assert.equal(searchEntities(graph, 'fixture person a')[0].entity.id, ids.personA);
  const trail = appendTraversalTrail(appendTraversalTrail([ids.personA], ids.fundA), ids.companyA);
  assert.deepEqual(trail, [ids.personA, ids.fundA, ids.companyA]);
  const production = await core.exportCanonicalGraph(join(directory, 'production.json'));
  assert.equal(production.nodes.some((node) => String(node.canonical_name).startsWith('Fixture')), false);
  assert.equal(production.sources.some((record) => record.provider === 'TEST_FIXTURE'), false);
  store.close();
});
