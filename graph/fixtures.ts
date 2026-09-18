import { createHash } from 'node:crypto';
import type { GraphCore } from './core.ts';

const fixtureText = 'Synthetic deep traversal fixture. Not production data.\n';

export function ingestDeepTraversalFixture(core: GraphCore, runId: string) {
  const sourceDocumentId = core.ingestSource(runId, {
    provider: 'TEST_FIXTURE', documentType: 'SYNTHETIC_GRAPH', externalId: 'deep-traversal-v1',
    title: 'Deep traversal synthetic fixture', publishedAt: '2020-01-01', sourceUrl: 'https://example.invalid/test-fixture/deep-traversal-v1',
    rawStoragePath: 'tests/fixtures/deep-traversal.txt', sha256: createHash('sha256').update(fixtureText).digest('hex'),
    parserVersion: 'test-fixture/1.0.0', evidenceClass: 'FIRST_PARTY', metadata: { fixture: true }, sourceAgent: 'FixtureAgent',
  })!;
  const entity = (candidateKey: string, entityType: any, canonicalName: string) => core.ingestEntity(runId, {
    candidateKey, entityType, canonicalName, identifiers: [{ scheme: 'INTERNAL', value: `fixture:${candidateKey}`, sourceDocumentId }],
    attributes: { fixture: true }, sourceDocument: { sourceDocumentId }, sourceAgent: 'FixtureAgent', confidence: 1,
  })!;
  const personA = entity('person-a', 'PERSON', 'Fixture Person A');
  const fundA = entity('fund-a', 'FUND', 'Fixture Fund A');
  const companyA = entity('company-a', 'COMPANY', 'Fixture Company A');
  const personB = entity('person-b', 'PERSON', 'Fixture Person B');
  const organizationB = entity('organization-b', 'ORGANIZATION', 'Fixture Organization B');
  const relationship = (subject: string, predicate: string, object: string, validFrom: string, validTo?: string) => core.ingestRelationship(runId, {
    subject: { entityId: subject }, predicate, object: { entityId: object }, validFrom, validTo,
    assertionType: 'ASSERTED', confidence: 1, sourceDocument: { sourceDocumentId },
    evidence: { excerpt: `Synthetic fixture asserts ${predicate} for traversal testing.`, evidenceClass: 'FIRST_PARTY' },
    extractionMethod: 'TEST_FIXTURE', sourceRecordId: `${subject}:${predicate}:${object}`, sourceAgent: 'FixtureAgent',
  });
  relationship(personA, 'PARTNER_AT', fundA, '2016-01-01', '2018-12-31');
  relationship(fundA, 'INVESTED_IN', companyA, '2018-06-01');
  relationship(personB, 'CEO_OF', companyA, '2019-01-01');
  relationship(personB, 'WORKED_AT', organizationB, '2014-01-01', '2018-12-31');
  relationship(companyA, 'BACKED', fundA, '2020-01-01');
  core.ingestEvent(runId, {
    eventType: 'INVESTMENT', eventDate: '2018-06-01', amount: 1_000_000, currency: 'USD',
    description: 'Synthetic investment event for traversal testing.',
    participants: [{ entity: { entityId: fundA }, role: 'INVESTOR' }, { entity: { entityId: companyA }, role: 'RECIPIENT' }],
    assertionType: 'ASSERTED', confidence: 1, sourceDocument: { sourceDocumentId },
    evidence: { excerpt: 'Synthetic fixture investment of $1,000,000.', evidenceClass: 'FIRST_PARTY' },
    extractionMethod: 'TEST_FIXTURE', sourceRecordId: 'investment-1', sourceAgent: 'FixtureAgent',
  });
  return { sourceDocumentId, personA, fundA, companyA, personB, organizationB };
}

export const DEEP_TRAVERSAL_FIXTURE_TEXT = fixtureText;
