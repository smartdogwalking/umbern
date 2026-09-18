import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { AssertionType, CrossSourceResolutionCase, CrossSourceResolutionStatus, EvidenceClass } from './domain.ts';
import type { EntityCandidate, EventCandidate, GraphSnapshot, RelationshipCandidate, SourceDocumentInput } from './storage-types.ts';
import { normalizeName, stableId } from '../shared/identity.ts';
import { validateEvent, validateRelationship } from './storage-validator.ts';

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, canonical_name TEXT NOT NULL,
  jurisdiction TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', resolution_confidence REAL NOT NULL DEFAULT 1,
  attributes TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entity_identifiers (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id), scheme TEXT NOT NULL, value TEXT NOT NULL,
  jurisdiction TEXT, source_document_id TEXT, valid_from TEXT, valid_to TEXT,
  attributes TEXT NOT NULL DEFAULT '{}', UNIQUE(scheme, value, jurisdiction)
);
CREATE TABLE IF NOT EXISTS entity_aliases (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id), alias TEXT NOT NULL, normalized_alias TEXT NOT NULL,
  UNIQUE(entity_id, normalized_alias)
);
CREATE TABLE IF NOT EXISTS source_documents (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, document_type TEXT NOT NULL, external_id TEXT NOT NULL,
  title TEXT, accession_number TEXT, filed_at TEXT, published_at TEXT, retrieved_at TEXT NOT NULL, source_url TEXT NOT NULL,
  raw_storage_path TEXT NOT NULL, sha256 TEXT NOT NULL, parser_version TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}',
  evidence_class TEXT NOT NULL DEFAULT 'OFFICIAL_RECORD',
  UNIQUE(provider, external_id, sha256)
);
CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY, subject_entity_id TEXT NOT NULL REFERENCES entities(id), predicate TEXT NOT NULL,
  object_entity_id TEXT NOT NULL REFERENCES entities(id), valid_from TEXT, valid_to TEXT, observed_at TEXT NOT NULL,
  amount REAL, currency TEXT, percentage REAL, shares REAL, assertion_type TEXT NOT NULL,
  confidence REAL NOT NULL, resolution_confidence REAL NOT NULL, source_document_id TEXT NOT NULL REFERENCES source_documents(id),
  source_provider TEXT NOT NULL DEFAULT 'SEC', source_record_id TEXT, source_url TEXT NOT NULL,
  extraction_method TEXT NOT NULL, evidence_class TEXT NOT NULL DEFAULT 'OFFICIAL_RECORD', evidence TEXT NOT NULL, attributes TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, event_type TEXT NOT NULL, event_date TEXT NOT NULL, amount REAL, currency TEXT,
  shares REAL, price_per_share REAL, description TEXT NOT NULL, attributes TEXT NOT NULL DEFAULT '{}',
  source_document_id TEXT NOT NULL REFERENCES source_documents(id), source_record_id TEXT NOT NULL,
  extraction_method TEXT NOT NULL, assertion_type TEXT NOT NULL DEFAULT 'ASSERTED', evidence_class TEXT NOT NULL DEFAULT 'OFFICIAL_RECORD',
  confidence REAL NOT NULL, evidence TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS event_participants (
  event_id TEXT NOT NULL REFERENCES events(id), entity_id TEXT NOT NULL REFERENCES entities(id), role TEXT NOT NULL,
  PRIMARY KEY(event_id, entity_id, role)
);
CREATE TABLE IF NOT EXISTS financial_facts (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id), taxonomy TEXT NOT NULL, concept TEXT NOT NULL,
  label TEXT NOT NULL, unit TEXT NOT NULL, value REAL NOT NULL, period_start TEXT, period_end TEXT NOT NULL,
  filed_at TEXT, accession_number TEXT, form TEXT, fiscal_year INTEGER, fiscal_period TEXT,
  source_document_id TEXT NOT NULL REFERENCES source_documents(id)
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY, agent_type TEXT NOT NULL, target_entity_id TEXT, started_at TEXT NOT NULL, completed_at TEXT,
  status TEXT NOT NULL, model TEXT, tool_calls_count INTEGER NOT NULL DEFAULT 0, documents_processed INTEGER NOT NULL DEFAULT 0,
  relationships_created INTEGER NOT NULL DEFAULT 0, events_created INTEGER NOT NULL DEFAULT 0,
  errors TEXT NOT NULL DEFAULT '[]', metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS rejected_candidates (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id), candidate_type TEXT NOT NULL,
  candidate TEXT NOT NULL, reasons TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_source_documents (
  run_id TEXT NOT NULL REFERENCES agent_runs(id), source_document_id TEXT NOT NULL REFERENCES source_documents(id),
  PRIMARY KEY(run_id, source_document_id)
);
CREATE TABLE IF NOT EXISTS run_relationships (
  run_id TEXT NOT NULL REFERENCES agent_runs(id), relationship_id TEXT NOT NULL REFERENCES relationships(id),
  PRIMARY KEY(run_id, relationship_id)
);
CREATE TABLE IF NOT EXISTS run_events (
  run_id TEXT NOT NULL REFERENCES agent_runs(id), event_id TEXT NOT NULL REFERENCES events(id),
  PRIMARY KEY(run_id, event_id)
);
CREATE TABLE IF NOT EXISTS run_claims (
  run_id TEXT NOT NULL REFERENCES agent_runs(id), claim_id TEXT NOT NULL REFERENCES claims(id),
  PRIMARY KEY(run_id, claim_id)
);
CREATE TABLE IF NOT EXISTS evidence_assertions (
  id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
  source_document_id TEXT NOT NULL REFERENCES source_documents(id), evidence_class TEXT NOT NULL,
  assertion_type TEXT NOT NULL, evidence TEXT NOT NULL, extraction_method TEXT NOT NULL,
  confidence REAL NOT NULL, attributes TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
  UNIQUE(subject_type, subject_id, source_document_id, evidence)
);
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY, subject_entity_id TEXT REFERENCES entities(id), claim_type TEXT NOT NULL, statement TEXT NOT NULL,
  valid_from TEXT, valid_to TEXT, observed_at TEXT NOT NULL, assertion_type TEXT NOT NULL, confidence REAL NOT NULL,
  source_document_id TEXT NOT NULL REFERENCES source_documents(id), source_record_id TEXT,
  evidence_assertion_id TEXT REFERENCES evidence_assertions(id), attributes TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS resolution_candidates (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id), candidate_key TEXT NOT NULL,
  candidate_type TEXT NOT NULL, candidate TEXT NOT NULL, proposed_entity_id TEXT REFERENCES entities(id),
  status TEXT NOT NULL, confidence REAL NOT NULL, reasons TEXT NOT NULL DEFAULT '[]', hints TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS resolution_cases (
  id TEXT PRIMARY KEY, source_provider TEXT NOT NULL, source_identifier TEXT, candidate_key TEXT NOT NULL,
  existing_entity_id TEXT NOT NULL REFERENCES entities(id), source_document_id TEXT REFERENCES source_documents(id),
  status TEXT NOT NULL, score REAL NOT NULL, candidate TEXT NOT NULL, matching_evidence TEXT NOT NULL DEFAULT '[]',
  conflicting_evidence TEXT NOT NULL DEFAULT '[]', reason TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(source_provider, candidate_key, existing_entity_id)
);
CREATE TABLE IF NOT EXISTS resolution_decisions (
  id TEXT PRIMARY KEY, resolution_case_id TEXT NOT NULL REFERENCES resolution_cases(id), decision_type TEXT NOT NULL,
  decision_actor TEXT NOT NULL, reason TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '[]', decided_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS validation_results (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id), candidate_type TEXT NOT NULL,
  candidate_key TEXT NOT NULL, is_valid INTEGER NOT NULL, reasons TEXT NOT NULL DEFAULT '[]',
  validator_version TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_relationship_natural ON relationships(
  subject_entity_id, predicate, object_entity_id, source_document_id, ifnull(valid_from,''), ifnull(source_record_id,'')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_source_record ON events(source_document_id, source_record_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fact_natural ON financial_facts(entity_id, taxonomy, concept, unit, period_end, value, source_document_id);
CREATE INDEX IF NOT EXISTS idx_relationship_subject ON relationships(subject_entity_id);
CREATE INDEX IF NOT EXISTS idx_relationship_object ON relationships(object_entity_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_facts_entity_concept ON financial_facts(entity_id, concept, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_claims_subject ON claims(subject_entity_id, claim_type);
CREATE INDEX IF NOT EXISTS idx_evidence_subject ON evidence_assertions(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_resolution_run ON resolution_candidates(run_id, candidate_key);
CREATE INDEX IF NOT EXISTS idx_resolution_cases_status ON resolution_cases(status, source_provider);
CREATE INDEX IF NOT EXISTS idx_resolution_decisions_case ON resolution_decisions(resolution_case_id, decided_at);
CREATE INDEX IF NOT EXISTS idx_validation_run ON validation_results(run_id, candidate_key);
`;

export class EvidenceStore {
  readonly db: DatabaseSync;

  constructor(databasePath = 'data/sec-research.db') {
    this.db = new DatabaseSync(databasePath);
    this.db.exec(SCHEMA);
    const eventColumns = this.db.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>;
    if (!eventColumns.some((column) => column.name === 'extraction_method')) {
      this.db.exec("ALTER TABLE events ADD COLUMN extraction_method TEXT NOT NULL DEFAULT 'DETERMINISTIC_HTML'");
    }
    this.addColumn('source_documents', 'title', 'TEXT');
    this.addColumn('source_documents', 'evidence_class', "TEXT NOT NULL DEFAULT 'OFFICIAL_RECORD'");
    this.addColumn('relationships', 'evidence_class', "TEXT NOT NULL DEFAULT 'OFFICIAL_RECORD'");
    this.addColumn('events', 'assertion_type', "TEXT NOT NULL DEFAULT 'ASSERTED'");
    this.addColumn('events', 'evidence_class', "TEXT NOT NULL DEFAULT 'OFFICIAL_RECORD'");
    this.addColumn('entity_identifiers', 'attributes', "TEXT NOT NULL DEFAULT '{}'");
    this.migrateLegacyHoldingEdges();
    this.migrateLegacySecNameOnlyOwners();
    this.backfillEvidenceAssertions();
    this.db.exec('PRAGMA optimize');
  }

  close(): void { this.db.close(); }

  startRun(agentType: string, metadata: Record<string, unknown> = {}): string {
    const startedAt = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`INSERT INTO agent_runs (id, agent_type, started_at, status, metadata) VALUES (?, ?, ?, 'RUNNING', ?)`).run(id, agentType, startedAt, JSON.stringify(metadata));
    return id;
  }

  setRunTarget(runId: string, entityId: string): void {
    this.db.prepare('UPDATE agent_runs SET target_entity_id = ? WHERE id = ?').run(entityId, runId);
  }

  finishRun(runId: string, status: 'COMPLETED' | 'FAILED', errors: unknown[] = []): void {
    const counts = this.db.prepare(`
      SELECT (SELECT COUNT(*) FROM run_source_documents WHERE run_id = ?) documents,
             (SELECT COUNT(*) FROM run_relationships WHERE run_id = ?) relationships,
             (SELECT COUNT(*) FROM run_events WHERE run_id = ?) events
    `).get(runId, runId, runId) as Record<string, number>;
    this.db.prepare(`UPDATE agent_runs SET completed_at = ?, status = ?, documents_processed = ?, relationships_created = ?, events_created = ?, errors = ? WHERE id = ?`)
      .run(new Date().toISOString(), status, counts.documents, counts.relationships, counts.events, JSON.stringify(errors), runId);
  }

  saveSource(source: SourceDocumentInput, runId?: string): string {
    const id = stableId('source', `${source.provider}:${source.externalId}:${source.sha256}`);
    this.db.prepare(`INSERT OR IGNORE INTO source_documents
      (id, provider, document_type, external_id, title, accession_number, filed_at, published_at, retrieved_at, source_url, raw_storage_path, sha256, parser_version, metadata, evidence_class)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`) 
      .run(id, source.provider, source.documentType, source.externalId, source.title ?? null, source.accessionNumber ?? null, source.filedAt ?? null,
        source.publishedAt ?? null, source.retrievedAt ?? new Date().toISOString(), source.sourceUrl, source.rawStoragePath, source.sha256,
        source.parserVersion, JSON.stringify(source.metadata ?? {}), source.evidenceClass ?? (source.provider === 'SEC' ? 'OFFICIAL_RECORD' : 'FIRST_PARTY'));
    if (runId) this.linkSourceToRun(runId, id);
    return id;
  }

  findExistingEntity(identifier?: { scheme: string; value: string }): string | undefined {
    if (!identifier) return undefined;
    const row = this.db.prepare('SELECT entity_id FROM entity_identifiers WHERE scheme = ? AND value = ?').get(identifier.scheme, identifier.value) as { entity_id: string } | undefined;
    return row?.entity_id;
  }

  getIdentifier(identifier: { scheme: string; value: string }): Record<string, any> | undefined {
    const row = this.db.prepare('SELECT * FROM entity_identifiers WHERE scheme = ? AND value = ?')
      .get(identifier.scheme, identifier.value) as Record<string, any> | undefined;
    return row ? parseJsonFields(row) : undefined;
  }

  getEntity(entityId: string): Record<string, any> | undefined {
    const row = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(entityId) as Record<string, any> | undefined;
    return row ? parseJsonFields(row) : undefined;
  }

  getEntityIdentity(entityId: string): Record<string, any> | undefined {
    const entity = this.getEntity(entityId);
    if (!entity) return undefined;
    const identifiers = this.db.prepare('SELECT * FROM entity_identifiers WHERE entity_id = ? ORDER BY scheme, value')
      .all(entityId).map((row) => parseJsonFields(row as Record<string, any>));
    const aliases = this.db.prepare('SELECT alias FROM entity_aliases WHERE entity_id = ? ORDER BY alias')
      .all(entityId).map((row: any) => row.alias);
    return { ...entity, identifiers, aliases };
  }

  findSource(reference: { sourceDocumentId?: string; provider?: string; externalId?: string; sha256?: string }): Record<string, any> | undefined {
    if (reference.sourceDocumentId) return this.db.prepare('SELECT * FROM source_documents WHERE id = ?').get(reference.sourceDocumentId) as Record<string, any> | undefined;
    if (!reference.provider || !reference.externalId) return undefined;
    return this.db.prepare(`SELECT * FROM source_documents WHERE provider = ? AND external_id = ?
      ${reference.sha256 ? 'AND sha256 = ?' : ''} ORDER BY retrieved_at DESC LIMIT 1`)
      .get(...(reference.sha256 ? [reference.provider, reference.externalId, reference.sha256] : [reference.provider, reference.externalId])) as Record<string, any> | undefined;
  }

  resolvePersonForIssuer(name: string, issuerId: string, predicates: string[]): string | undefined {
    const rows = this.db.prepare(`SELECT DISTINCT e.id, e.canonical_name FROM entities e
      JOIN relationships r ON r.subject_entity_id = e.id
      WHERE e.entity_type = 'PERSON' AND r.object_entity_id = ? AND r.predicate IN (${predicates.map(() => '?').join(',')})`)
      .all(issuerId, ...predicates) as Array<{ id: string; canonical_name: string }>;
    const [first, ...rest] = normalizeName(name).toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ');
    const last = rest.at(-1) ?? '';
    const matches = rows.filter((row) => {
      const tokens = normalizeName(row.canonical_name).toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ');
      return normalizeName(row.canonical_name).toLowerCase() === normalizeName(name).toLowerCase()
        || (tokens[0]?.[0] === first?.[0] && tokens.at(-1) === last);
    });
    return matches.length === 1 ? matches[0].id : undefined;
  }

  saveEntity(candidate: EntityCandidate): string {
    const authoritative = candidate.identifiers?.find((identifier) => ['SEC_CIK', 'CUSIP', 'ISIN', 'LEI', 'EIN', 'COMPANIES_HOUSE', 'COMPANIES_HOUSE_OFFICER_ID', 'REGISTRY_ID', 'FEC_ID', 'FEC_CANDIDATE_ID', 'FEC_COMMITTEE_ID', 'UEI', 'DUNS', 'USASPENDING_RECIPIENT_ID', 'USASPENDING_TOP_TIER_AGENCY_CODE', 'USASPENDING_SUB_TIER_AGENCY_CODE', 'USASPENDING_OFFICE_CODE', 'USASPENDING_AWARD_ID', 'USASPENDING_SUBAWARD_ID', 'SEC_REPORTING_OWNER_ID', 'INTERNAL'].includes(identifier.scheme));
    const existing = this.findExistingEntity(authoritative);
    if (existing) {
      const current = this.getEntity(existing);
      const mergedAttributes = { ...current?.attributes, ...candidate.attributes };
      this.db.prepare(`UPDATE entities SET canonical_name = ?,
        entity_type = CASE WHEN entity_type = 'ORGANIZATION' AND ? = 'COMPANY' THEN 'COMPANY' ELSE entity_type END,
        jurisdiction = coalesce(?, jurisdiction), attributes = ?, updated_at = ? WHERE id = ?`)
        .run(normalizeName(candidate.canonicalName), candidate.entityType, candidate.jurisdiction ?? null, JSON.stringify(mergedAttributes), new Date().toISOString(), existing);
      this.saveIdentifiers(existing, candidate.identifiers ?? []);
      this.saveAliases(existing, candidate.aliases ?? []);
      return existing;
    }
    const id = authoritative ? stableId('entity', `${authoritative.scheme}:${authoritative.value}`) : randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`INSERT OR IGNORE INTO entities (id, entity_type, canonical_name, jurisdiction, status, resolution_confidence, attributes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, candidate.entityType, normalizeName(candidate.canonicalName), candidate.jurisdiction ?? null, candidate.status ?? 'ACTIVE', candidate.resolutionConfidence ?? 1, JSON.stringify(candidate.attributes ?? {}), now, now);
    this.saveIdentifiers(id, candidate.identifiers ?? []);
    this.saveAliases(id, candidate.aliases ?? []);
    return id;
  }

  enrichEntity(entityId: string, candidate: EntityCandidate): string {
    const current = this.getEntity(entityId);
    if (!current) throw new Error(`Canonical entity not found: ${entityId}`);
    for (const identifier of candidate.identifiers ?? []) {
      const owner = this.findExistingEntity(identifier);
      if (owner && owner !== entityId) throw new Error(`${identifier.scheme}:${identifier.value} already belongs to canonical entity ${owner}`);
    }
    const mergedAttributes = { ...current.attributes, ...candidate.attributes };
    this.db.prepare(`UPDATE entities SET
      entity_type = CASE WHEN entity_type = 'ORGANIZATION' AND ? = 'COMPANY' THEN 'COMPANY' ELSE entity_type END,
      jurisdiction = coalesce(jurisdiction, ?), attributes = ?, resolution_confidence = max(resolution_confidence, ?), updated_at = ?
      WHERE id = ?`).run(
        candidate.entityType, candidate.jurisdiction ?? null, JSON.stringify(mergedAttributes),
        candidate.resolutionConfidence ?? 1, new Date().toISOString(), entityId,
      );
    this.saveIdentifiers(entityId, candidate.identifiers ?? []);
    const aliases = [...(candidate.aliases ?? [])];
    if (normalizeName(candidate.canonicalName).toLowerCase() !== String(current.canonical_name).toLowerCase()) aliases.push(candidate.canonicalName);
    this.saveAliases(entityId, aliases);
    return entityId;
  }

  saveRelationship(runId: string, candidate: RelationshipCandidate): string | undefined {
    const validation = validateRelationship(candidate);
    if (!validation.valid) return this.reject(runId, 'RELATIONSHIP', candidate, validation.reasons);
    const recordKey = candidate.sourceRecordId ?? '';
    const id = stableId('relationship', `${candidate.subjectEntityId}:${candidate.predicate}:${candidate.objectEntityId}:${candidate.sourceDocumentId}:${candidate.validFrom ?? ''}:${recordKey}`);
    const source = this.findSource({ sourceDocumentId: candidate.sourceDocumentId });
    this.db.prepare(`INSERT OR IGNORE INTO relationships
      (id, subject_entity_id, predicate, object_entity_id, valid_from, valid_to, observed_at, amount, currency, percentage, shares,
       assertion_type, confidence, resolution_confidence, source_document_id, source_provider, source_record_id, source_url, extraction_method, evidence_class, evidence, attributes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`) 
      .run(id, candidate.subjectEntityId, candidate.predicate, candidate.objectEntityId, candidate.validFrom ?? null, candidate.validTo ?? null,
        candidate.observedAt ?? new Date().toISOString(), candidate.amount ?? null, candidate.currency ?? null, candidate.percentage ?? null,
        candidate.shares ?? null, candidate.assertionType, candidate.confidence, candidate.resolutionConfidence, candidate.sourceDocumentId,
        source?.provider ?? 'UNKNOWN', candidate.sourceRecordId ?? null, candidate.sourceUrl, candidate.extractionMethod,
        candidate.evidenceClass ?? source?.evidence_class ?? 'OFFICIAL_RECORD', candidate.evidence, JSON.stringify(candidate.attributes ?? {}));
    this.linkSourceToRun(runId, candidate.sourceDocumentId);
    this.db.prepare('INSERT OR IGNORE INTO run_relationships (run_id, relationship_id) VALUES (?, ?)').run(runId, id);
    return id;
  }

  saveEvent(runId: string, candidate: EventCandidate): string | undefined {
    const validation = validateEvent(candidate);
    if (!validation.valid) return this.reject(runId, 'EVENT', candidate, validation.reasons);
    const id = stableId('event', `${candidate.sourceDocumentId}:${candidate.sourceRecordId}`);
    const now = new Date().toISOString();
    const source = this.findSource({ sourceDocumentId: candidate.sourceDocumentId });
    this.db.prepare(`INSERT OR IGNORE INTO events
      (id, event_type, event_date, amount, currency, shares, price_per_share, description, attributes, source_document_id,
       source_record_id, extraction_method, assertion_type, evidence_class, confidence, evidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET extraction_method = excluded.extraction_method, updated_at = excluded.updated_at`) 
      .run(id, candidate.eventType, candidate.eventDate, candidate.amount ?? null, candidate.currency ?? null, candidate.shares ?? null,
        candidate.pricePerShare ?? null, candidate.description, JSON.stringify(candidate.attributes ?? {}), candidate.sourceDocumentId,
        candidate.sourceRecordId, candidate.extractionMethod, candidate.assertionType ?? 'ASSERTED',
        candidate.evidenceClass ?? source?.evidence_class ?? 'OFFICIAL_RECORD', candidate.confidence, candidate.evidence, now, now);
    for (const participant of candidate.participants) {
      this.db.prepare('INSERT OR IGNORE INTO event_participants (event_id, entity_id, role) VALUES (?, ?, ?)').run(id, participant.entityId, participant.role);
    }
    this.linkSourceToRun(runId, candidate.sourceDocumentId);
    this.db.prepare('INSERT OR IGNORE INTO run_events (run_id, event_id) VALUES (?, ?)').run(runId, id);
    return id;
  }

  saveFact(entityId: string, sourceDocumentId: string, fact: Record<string, any>): string {
    const id = stableId('fact', `${entityId}:${fact.taxonomy}:${fact.concept}:${fact.unit}:${fact.periodEnd}:${fact.value}:${sourceDocumentId}`);
    this.db.prepare(`INSERT OR IGNORE INTO financial_facts
      (id, entity_id, taxonomy, concept, label, unit, value, period_start, period_end, filed_at, accession_number, form, fiscal_year, fiscal_period, source_document_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, entityId, fact.taxonomy, fact.concept, fact.label, fact.unit, fact.value, fact.periodStart ?? null, fact.periodEnd,
        fact.filedAt ?? null, fact.accessionNumber ?? null, fact.form ?? null, fact.fiscalYear ?? null, fact.fiscalPeriod ?? null, sourceDocumentId);
    return id;
  }

  saveEvidenceAssertion(input: {
    subjectType: 'ENTITY' | 'IDENTIFIER' | 'RELATIONSHIP' | 'EVENT' | 'CLAIM'; subjectId: string; sourceDocumentId: string;
    evidenceClass: EvidenceClass; assertionType: AssertionType; evidence: string; extractionMethod: string;
    confidence: number; attributes?: Record<string, unknown>;
  }): string {
    const id = stableId('evidence', `${input.subjectType}:${input.subjectId}:${input.sourceDocumentId}:${input.evidence}`);
    this.db.prepare(`INSERT OR IGNORE INTO evidence_assertions
      (id, subject_type, subject_id, source_document_id, evidence_class, assertion_type, evidence, extraction_method, confidence, attributes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, input.subjectType, input.subjectId, input.sourceDocumentId, input.evidenceClass, input.assertionType,
        input.evidence, input.extractionMethod, input.confidence, JSON.stringify(input.attributes ?? {}), new Date().toISOString(),
      );
    return id;
  }

  saveClaim(runId: string, input: {
    subjectEntityId?: string; claimType: string; statement: string; validFrom?: string; validTo?: string; observedAt?: string;
    assertionType: AssertionType; confidence: number; sourceDocumentId: string; sourceRecordId?: string;
    evidenceAssertionId?: string; attributes?: Record<string, unknown>;
  }): string {
    const id = stableId('claim', `${input.subjectEntityId ?? ''}:${input.claimType}:${input.sourceDocumentId}:${input.sourceRecordId ?? input.statement}`);
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO claims
      (id, subject_entity_id, claim_type, statement, valid_from, valid_to, observed_at, assertion_type, confidence,
       source_document_id, source_record_id, evidence_assertion_id, attributes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET statement = excluded.statement, confidence = excluded.confidence,
        evidence_assertion_id = excluded.evidence_assertion_id, attributes = excluded.attributes, updated_at = excluded.updated_at`).run(
        id, input.subjectEntityId ?? null, input.claimType, input.statement, input.validFrom ?? null, input.validTo ?? null,
        input.observedAt ?? now, input.assertionType, input.confidence, input.sourceDocumentId, input.sourceRecordId ?? null,
        input.evidenceAssertionId ?? null, JSON.stringify(input.attributes ?? {}), now, now,
      );
    this.linkSourceToRun(runId, input.sourceDocumentId);
    this.db.prepare('INSERT OR IGNORE INTO run_claims (run_id, claim_id) VALUES (?, ?)').run(runId, id);
    return id;
  }

  saveResolutionCandidate(runId: string, input: {
    candidateKey: string; candidateType?: 'ENTITY' | 'IDENTIFIER'; candidate: unknown; proposedEntityId?: string; status: string; confidence: number;
    reasons: string[]; hints?: unknown[];
  }): string {
    const id = stableId('resolution', `${runId}:${input.candidateKey}:${input.proposedEntityId ?? ''}:${input.status}`);
    this.db.prepare(`INSERT OR REPLACE INTO resolution_candidates
      (id, run_id, candidate_key, candidate_type, candidate, proposed_entity_id, status, confidence, reasons, hints, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, runId, input.candidateKey, input.candidateType ?? 'ENTITY', JSON.stringify(input.candidate), input.proposedEntityId ?? null,
        input.status, input.confidence, JSON.stringify(input.reasons), JSON.stringify(input.hints ?? []), new Date().toISOString(),
      );
    return id;
  }

  saveResolutionCase(input: {
    sourceProvider: string; sourceIdentifier?: string; candidateKey: string; existingEntityId: string;
    sourceDocumentId?: string; status: CrossSourceResolutionStatus; score: number; candidate: unknown;
    matchingEvidence: Array<Record<string, unknown>>; conflictingEvidence: Array<Record<string, unknown>>; reason: string;
  }): string {
    const id = stableId('resolution-case', `${input.sourceProvider}:${input.candidateKey}:${input.existingEntityId}`);
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO resolution_cases
      (id, source_provider, source_identifier, candidate_key, existing_entity_id, source_document_id, status, score,
       candidate, matching_evidence, conflicting_evidence, reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET source_document_id = excluded.source_document_id, status = excluded.status,
       score = excluded.score, candidate = excluded.candidate, matching_evidence = excluded.matching_evidence,
       conflicting_evidence = excluded.conflicting_evidence, reason = excluded.reason, updated_at = excluded.updated_at`).run(
        id, input.sourceProvider, input.sourceIdentifier ?? null, input.candidateKey, input.existingEntityId,
        input.sourceDocumentId ?? null, input.status, input.score, JSON.stringify(input.candidate),
        JSON.stringify(input.matchingEvidence), JSON.stringify(input.conflictingEvidence), input.reason, now, now,
      );
    return id;
  }

  listResolutionCases(status?: CrossSourceResolutionStatus): CrossSourceResolutionCase[] {
    const rows = this.db.prepare(`SELECT * FROM resolution_cases ${status ? 'WHERE status = ?' : ''} ORDER BY updated_at DESC`)
      .all(...(status ? [status] : [])) as Array<Record<string, any>>;
    return rows.map(toResolutionCase);
  }

  getResolutionCase(id: string): CrossSourceResolutionCase | undefined {
    const row = this.db.prepare('SELECT * FROM resolution_cases WHERE id = ?').get(id) as Record<string, any> | undefined;
    return row ? toResolutionCase(row) : undefined;
  }

  setResolutionCaseStatus(id: string, status: CrossSourceResolutionStatus, reason: string): void {
    this.db.prepare('UPDATE resolution_cases SET status = ?, reason = ?, updated_at = ? WHERE id = ?')
      .run(status, reason, new Date().toISOString(), id);
  }

  saveResolutionDecision(input: {
    resolutionCaseId: string; decisionType: string; decisionActor: string; reason: string;
    evidence?: Array<Record<string, unknown>>;
  }): string {
    const id = stableId('resolution-decision', `${input.resolutionCaseId}:${input.decisionType}:${input.decisionActor}:${input.reason}`);
    this.db.prepare(`INSERT OR IGNORE INTO resolution_decisions
      (id, resolution_case_id, decision_type, decision_actor, reason, evidence, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.resolutionCaseId, input.decisionType, input.decisionActor, input.reason,
        JSON.stringify(input.evidence ?? []), new Date().toISOString());
    return id;
  }

  saveValidationResult(runId: string, input: {
    candidateType: string; candidateKey: string; valid: boolean; reasons: string[]; validatorVersion: string;
  }): string {
    const id = stableId('validation', `${runId}:${input.candidateType}:${input.candidateKey}:${input.validatorVersion}`);
    this.db.prepare(`INSERT OR REPLACE INTO validation_results
      (id, run_id, candidate_type, candidate_key, is_valid, reasons, validator_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, runId, input.candidateType, input.candidateKey, input.valid ? 1 : 0,
        JSON.stringify(input.reasons), input.validatorVersion, new Date().toISOString(),
      );
    return id;
  }

  rejectCandidate(runId: string, type: string, candidate: unknown, reasons: string[]): undefined {
    return this.reject(runId, type, candidate, reasons);
  }

  async exportGraph(rootEntityId: string, outputPath: string, runId?: string): Promise<GraphSnapshot> {
    const root = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(rootEntityId) as Record<string, unknown>;
    const entities = this.db.prepare(`SELECT e.*,
      (SELECT group_concat(i.scheme || ':' || i.value, '|') FROM entity_identifiers i WHERE i.entity_id = e.id) identifiers,
      (SELECT group_concat(a.alias, '|') FROM entity_aliases a WHERE a.entity_id = e.id) aliases
      FROM entities e ORDER BY e.entity_type, e.canonical_name`).all() as Array<Record<string, unknown>>;
    const relationships = this.db.prepare(`SELECT r.*, s.document_type source_form, s.accession_number, s.filed_at source_filed_at,
      se.canonical_name subject_name, oe.canonical_name object_name
      FROM relationships r JOIN source_documents s ON s.id = r.source_document_id
      JOIN entities se ON se.id = r.subject_entity_id JOIN entities oe ON oe.id = r.object_entity_id
      WHERE ${runId ? 'EXISTS (SELECT 1 FROM run_relationships rr WHERE rr.relationship_id = r.id AND rr.run_id = ?)' : '(r.subject_entity_id = ? OR r.object_entity_id = ?)'}
      ORDER BY r.predicate, se.canonical_name`).all(...(runId ? [runId] : [rootEntityId, rootEntityId])) as Array<Record<string, any>>;
    const events = this.db.prepare(`SELECT e.*, s.source_url, s.document_type source_form, s.accession_number, s.filed_at source_filed_at,
      group_concat(p.entity_id || ':' || p.role, '|') participants
      FROM events e JOIN source_documents s ON s.id = e.source_document_id
      LEFT JOIN event_participants p ON p.event_id = e.id
      WHERE EXISTS (SELECT 1 FROM event_participants root_participant WHERE root_participant.event_id = e.id AND root_participant.entity_id = ?)
      ${runId ? 'AND EXISTS (SELECT 1 FROM run_events re WHERE re.event_id = e.id AND re.run_id = ?)' : ''}
      GROUP BY e.id ORDER BY e.event_date DESC`).all(...(runId ? [rootEntityId, runId] : [rootEntityId])) as Array<Record<string, any>>;
    const facts = this.db.prepare(`SELECT * FROM financial_facts WHERE entity_id = ?
      ${runId ? 'AND EXISTS (SELECT 1 FROM run_source_documents rs WHERE rs.source_document_id = financial_facts.source_document_id AND rs.run_id = ?)' : ''}
      ORDER BY concept, period_end DESC`).all(...(runId ? [rootEntityId, runId] : [rootEntityId])) as Array<Record<string, unknown>>;
    const sources = this.db.prepare(`SELECT s.* FROM source_documents s
      ${runId ? 'JOIN run_source_documents rs ON rs.source_document_id = s.id WHERE rs.run_id = ?' : ''}
      ORDER BY coalesce(s.filed_at, s.retrieved_at) DESC`).all(...(runId ? [runId] : [])) as Array<Record<string, unknown>>;
    const rejected = this.db.prepare(`SELECT * FROM rejected_candidates ${runId ? 'WHERE run_id = ?' : ''} ORDER BY created_at DESC`)
      .all(...(runId ? [runId] : [])) as Array<Record<string, unknown>>;
    const run = runId ? (this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as Record<string, unknown>) : {};

    const nodeIds = new Set([rootEntityId]);
    for (const relationship of relationships) { nodeIds.add(relationship.subject_entity_id); nodeIds.add(relationship.object_entity_id); }
    for (const event of events) for (const token of String(event.participants ?? '').split('|')) nodeIds.add(token.split(':')[0]);
    const nodes = entities.filter((entity) => nodeIds.has(String(entity.id))).map(parseJsonFields);
    const relevantSources = sources;
    const predicateCounts = Object.fromEntries([...new Set(relationships.map((edge) => edge.predicate))].map((predicate) => [predicate, relationships.filter((edge) => edge.predicate === predicate).length]));
    const eventCounts = Object.fromEntries([...new Set(events.map((event) => event.event_type))].map((type) => [type, events.filter((event) => event.event_type === type).length]));
    const formCounts = Object.fromEntries([...new Set(relevantSources.map((source) => source.document_type))].map((form) => [form, relevantSources.filter((source) => source.document_type === form).length]));
    const stats = {
      entities: nodes.length,
      people: nodes.filter((node) => node.entity_type === 'PERSON').length,
      organizations: nodes.filter((node) => node.entity_type === 'ORGANIZATION').length,
      funds: nodes.filter((node) => node.entity_type === 'FUND').length,
      securities: nodes.filter((node) => node.entity_type === 'SECURITY').length,
      relationships: relationships.length,
      events: events.length,
      sources: relevantSources.length,
      deterministicExtractions: relationships.filter((edge) => edge.extraction_method !== 'LLM_STRUCTURED').length + events.length + facts.length,
      llmExtractions: relationships.filter((edge) => edge.extraction_method === 'LLM_STRUCTURED').length,
      rejectedCandidates: rejected.length,
      predicates: predicateCounts,
      eventTypes: eventCounts,
      forms: formCounts,
    };
    const snapshot: GraphSnapshot = {
      generatedAt: new Date().toISOString(), run: parseJsonFields(run), root: parseJsonFields(root), nodes,
      edges: relationships.map(parseJsonFields), events: events.map(parseJsonFields), facts: facts.map(parseJsonFields),
      sources: relevantSources.map(parseJsonFields), rejectedCandidates: rejected.map(parseJsonFields), stats,
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    return snapshot;
  }

  async exportCanonicalGraph(outputPath: string, options: { includeTestFixtures?: boolean } = {}): Promise<import('./domain.ts').CanonicalGraphSnapshot> {
    const includeFixtures = options.includeTestFixtures === true;
    const sourceFilter = includeFixtures ? '' : "WHERE provider <> 'TEST_FIXTURE'";
    const relationshipFilter = includeFixtures ? '' : "WHERE s.provider <> 'TEST_FIXTURE'";
    const entityFilter = includeFixtures ? '' : `WHERE e.attributes NOT LIKE '%"fixture":true%'`;
    const nodes = this.db.prepare(`SELECT e.*,
      (SELECT group_concat(i.scheme || ':' || i.value, '|') FROM entity_identifiers i WHERE i.entity_id = e.id) identifiers,
      (SELECT group_concat(a.alias, '|') FROM entity_aliases a WHERE a.entity_id = e.id) aliases
      FROM entities e ${entityFilter} ORDER BY e.entity_type, e.canonical_name`).all().map((row) => parseJsonFields(row as Record<string, any>));
    const nodeIds = new Set(nodes.map((node) => String(node.id)));
    const edges = (this.db.prepare(`SELECT r.*, s.document_type source_form, s.title source_title, s.accession_number,
      s.filed_at source_filed_at, se.canonical_name subject_name, oe.canonical_name object_name
      FROM relationships r JOIN source_documents s ON s.id = r.source_document_id
      JOIN entities se ON se.id = r.subject_entity_id JOIN entities oe ON oe.id = r.object_entity_id
      ${relationshipFilter} ORDER BY r.observed_at DESC`).all() as Array<Record<string, any>>)
      .filter((edge) => nodeIds.has(String(edge.subject_entity_id)) && nodeIds.has(String(edge.object_entity_id))).map(parseJsonFields);
    const events = (this.db.prepare(`SELECT e.*, s.source_url, s.provider source_provider, s.document_type source_form,
      s.title source_title, s.accession_number, s.filed_at source_filed_at,
      group_concat(p.entity_id || ':' || p.role, '|') participants
      FROM events e JOIN source_documents s ON s.id = e.source_document_id
      LEFT JOIN event_participants p ON p.event_id = e.id ${relationshipFilter}
      GROUP BY e.id ORDER BY e.event_date DESC`).all() as Array<Record<string, any>>)
      .filter((event) => String(event.participants ?? '').split('|').every((token) => !token || nodeIds.has(token.split(':')[0]))).map(parseJsonFields);
    const sources = (this.db.prepare(`SELECT * FROM source_documents ${sourceFilter} ORDER BY coalesce(filed_at, published_at, retrieved_at) DESC`).all() as Array<Record<string, any>>).map(parseJsonFields);
    const claims = (this.db.prepare(`SELECT c.*, s.provider source_provider, s.source_url, s.document_type source_type,
      s.title source_title, s.external_id source_external_id FROM claims c JOIN source_documents s ON s.id = c.source_document_id
      ${relationshipFilter} ORDER BY c.observed_at DESC`).all() as Array<Record<string, any>>)
      .filter((claim) => !claim.subject_entity_id || nodeIds.has(String(claim.subject_entity_id))).map(parseJsonFields);
    const evidenceAssertions = (this.db.prepare(`SELECT ea.*, s.provider source_provider, s.source_url, s.document_type source_type,
      s.title source_title, s.external_id source_external_id FROM evidence_assertions ea
      JOIN source_documents s ON s.id = ea.source_document_id ${relationshipFilter} ORDER BY ea.created_at DESC`).all() as Array<Record<string, any>>).map(parseJsonFields);
    const facts = (this.db.prepare(`SELECT f.* FROM financial_facts f JOIN source_documents s ON s.id = f.source_document_id
      ${relationshipFilter} ORDER BY f.period_end DESC`).all() as Array<Record<string, any>>)
      .filter((fact) => nodeIds.has(String(fact.entity_id))).map(parseJsonFields);
    const stats = {
      entities: nodes.length,
      relationships: edges.length,
      events: events.length,
      claims: claims.length,
      sources: sources.length,
      evidenceAssertions: evidenceAssertions.length,
      entityTypes: Object.fromEntries([...new Set(nodes.map((node) => node.entity_type))].sort((left, right) => String(left).localeCompare(String(right))).map((type) => [type, nodes.filter((node) => node.entity_type === type).length])),
      predicates: Object.fromEntries([...new Set(edges.map((edge) => edge.predicate))].sort((left, right) => String(left).localeCompare(String(right))).map((predicate) => [predicate, edges.filter((edge) => edge.predicate === predicate).length])),
    };
    const snapshot = { generatedAt: new Date().toISOString(), nodes, edges, events, claims, sources, evidenceAssertions, facts, stats };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    return snapshot;
  }

  saveIdentifier(entityId: string, identifier: NonNullable<EntityCandidate['identifiers']>[number]): string {
    const id = stableId('identifier', `${identifier.scheme}:${identifier.value}:${identifier.jurisdiction ?? ''}`);
    this.db.prepare(`INSERT OR IGNORE INTO entity_identifiers
      (id, entity_id, scheme, value, jurisdiction, source_document_id, valid_from, valid_to, attributes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, entityId, identifier.scheme, identifier.value, identifier.jurisdiction ?? null, identifier.sourceDocumentId ?? null,
        identifier.validFrom ?? null, identifier.validTo ?? null, JSON.stringify(identifier.attributes ?? {}),
      );
    return id;
  }

  linkRunSource(runId: string, sourceDocumentId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO run_source_documents (run_id, source_document_id) VALUES (?, ?)').run(runId, sourceDocumentId);
  }

  private saveIdentifiers(entityId: string, identifiers: NonNullable<EntityCandidate['identifiers']>): void {
    for (const identifier of identifiers) {
      this.saveIdentifier(entityId, identifier);
    }
  }

  private linkSourceToRun(runId: string, sourceDocumentId: string): void {
    this.linkRunSource(runId, sourceDocumentId);
  }

  private saveAliases(entityId: string, aliases: string[]): void {
    for (const alias of aliases) {
      const normalized = normalizeName(alias).toLowerCase();
      this.db.prepare('INSERT OR IGNORE INTO entity_aliases (id, entity_id, alias, normalized_alias) VALUES (?, ?, ?, ?)')
        .run(stableId('alias', `${entityId}:${normalized}`), entityId, normalizeName(alias), normalized);
    }
  }

  private reject(runId: string, type: string, candidate: unknown, reasons: string[]): undefined {
    const id = stableId('rejection', `${runId}:${type}:${JSON.stringify(candidate)}:${reasons.join('|')}`);
    this.db.prepare('INSERT OR IGNORE INTO rejected_candidates (id, run_id, candidate_type, candidate, reasons, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, runId, type, JSON.stringify(candidate), JSON.stringify(reasons), new Date().toISOString());
    return undefined;
  }

  private addColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((existing) => existing.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  /**
   * Phase 1 represented a 13F position as manager -> issuer. The canonical
   * vocabulary distinguishes the security from its issuer, so those legacy
   * rows are superseded by manager -> security -> issuer edges.
   */
  private migrateLegacyHoldingEdges(): void {
    const legacy = this.db.prepare(`SELECT r.id FROM relationships r
      JOIN entities object_entity ON object_entity.id = r.object_entity_id
      WHERE r.predicate = 'HOLDS_SECURITY'
        AND object_entity.entity_type IN ('COMPANY', 'ORGANIZATION')
        AND r.attributes LIKE '%"securityEntityId"%'`).all() as Array<{ id: string }>;
    if (legacy.length === 0) return;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const deleteEvidence = this.db.prepare("DELETE FROM evidence_assertions WHERE subject_type = 'RELATIONSHIP' AND subject_id = ?");
      const deleteRunLink = this.db.prepare('DELETE FROM run_relationships WHERE relationship_id = ?');
      const deleteRelationship = this.db.prepare('DELETE FROM relationships WHERE id = ?');
      for (const row of legacy) {
        deleteEvidence.run(row.id);
        deleteRunLink.run(row.id);
        deleteRelationship.run(row.id);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Older SEC imports merged identifier-free Schedule 13 organizations by exact
   * name. Re-ingestion now supplies a stable source-scoped INTERNAL identifier,
   * so remove those superseded assertions and leave the source documents intact.
   */
  private migrateLegacySecNameOnlyOwners(): void {
    const legacy = this.db.prepare(`SELECT r.id relationship_id, r.subject_entity_id entity_id
      FROM relationships r JOIN entities subject_entity ON subject_entity.id = r.subject_entity_id
      JOIN source_documents source ON source.id = r.source_document_id
      WHERE r.predicate = 'BENEFICIAL_OWNER_OF' AND source.provider = 'SEC' AND source.document_type LIKE 'SC 13%'
        AND subject_entity.entity_type <> 'PERSON'
        AND NOT EXISTS (SELECT 1 FROM entity_identifiers i WHERE i.entity_id = subject_entity.id)`).all() as Array<{ relationship_id: string; entity_id: string }>;
    if (legacy.length === 0) return;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const deleteEvidence = this.db.prepare("DELETE FROM evidence_assertions WHERE subject_type = 'RELATIONSHIP' AND subject_id = ?");
      const deleteRunLink = this.db.prepare('DELETE FROM run_relationships WHERE relationship_id = ?');
      const deleteRelationship = this.db.prepare('DELETE FROM relationships WHERE id = ?');
      for (const row of legacy) {
        deleteEvidence.run(row.relationship_id);
        deleteRunLink.run(row.relationship_id);
        deleteRelationship.run(row.relationship_id);
      }
      const updateResolution = this.db.prepare('UPDATE resolution_candidates SET proposed_entity_id = NULL WHERE proposed_entity_id = ?');
      const deleteEntity = this.db.prepare(`DELETE FROM entities WHERE id = ?
        AND NOT EXISTS (SELECT 1 FROM relationships r WHERE r.subject_entity_id = entities.id OR r.object_entity_id = entities.id)
        AND NOT EXISTS (SELECT 1 FROM event_participants p WHERE p.entity_id = entities.id)
        AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.subject_entity_id = entities.id)`);
      for (const entityId of new Set(legacy.map((row) => row.entity_id))) {
        updateResolution.run(entityId);
        deleteEntity.run(entityId);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Ensure upgraded databases expose the same source-independent evidence API. */
  private backfillEvidenceAssertions(): void {
    const relationships = this.db.prepare(`SELECT r.id, r.source_document_id, r.evidence_class, r.assertion_type,
      r.evidence, r.extraction_method, r.confidence, r.attributes
      FROM relationships r WHERE NOT EXISTS (
        SELECT 1 FROM evidence_assertions ea WHERE ea.subject_type = 'RELATIONSHIP' AND ea.subject_id = r.id
      )`).all() as Array<Record<string, any>>;
    for (const row of relationships) {
      this.saveEvidenceAssertion({
        subjectType: 'RELATIONSHIP', subjectId: row.id, sourceDocumentId: row.source_document_id,
        evidenceClass: row.evidence_class, assertionType: row.assertion_type, evidence: row.evidence,
        extractionMethod: row.extraction_method, confidence: row.confidence, attributes: parseAttributes(row.attributes),
      });
    }

    const events = this.db.prepare(`SELECT e.id, e.source_document_id, e.evidence_class, e.assertion_type,
      e.evidence, e.extraction_method, e.confidence, e.attributes
      FROM events e WHERE NOT EXISTS (
        SELECT 1 FROM evidence_assertions ea WHERE ea.subject_type = 'EVENT' AND ea.subject_id = e.id
      )`).all() as Array<Record<string, any>>;
    for (const row of events) {
      this.saveEvidenceAssertion({
        subjectType: 'EVENT', subjectId: row.id, sourceDocumentId: row.source_document_id,
        evidenceClass: row.evidence_class, assertionType: row.assertion_type, evidence: row.evidence,
        extractionMethod: row.extraction_method, confidence: row.confidence, attributes: parseAttributes(row.attributes),
      });
    }

    const claims = this.db.prepare(`SELECT c.id, c.source_document_id, c.assertion_type, c.statement, c.confidence,
      c.attributes, s.evidence_class FROM claims c JOIN source_documents s ON s.id = c.source_document_id
      WHERE NOT EXISTS (
        SELECT 1 FROM evidence_assertions ea WHERE ea.subject_type = 'CLAIM' AND ea.subject_id = c.id
      )`).all() as Array<Record<string, any>>;
    const updateClaim = this.db.prepare('UPDATE claims SET evidence_assertion_id = ? WHERE id = ?');
    for (const row of claims) {
      const evidenceAssertionId = this.saveEvidenceAssertion({
        subjectType: 'CLAIM', subjectId: row.id, sourceDocumentId: row.source_document_id,
        evidenceClass: row.evidence_class, assertionType: row.assertion_type, evidence: row.statement,
        extractionMethod: 'MIGRATED_CANONICAL_RECORD', confidence: row.confidence, attributes: parseAttributes(row.attributes),
      });
      updateClaim.run(evidenceAssertionId, row.id);
    }
  }
}

function parseAttributes(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

function parseJsonFields(row: Record<string, any>): Record<string, any> {
  if (!row) return {};
  const result = { ...row };
  for (const field of ['attributes', 'metadata', 'errors', 'candidate', 'reasons']) {
    if (typeof result[field] === 'string') {
      try { result[field] = JSON.parse(result[field]); } catch { /* preserve malformed source data */ }
    }
  }
  return result;
}

function toResolutionCase(row: Record<string, any>): CrossSourceResolutionCase {
  return {
    id: row.id,
    sourceProvider: row.source_provider,
    sourceIdentifier: row.source_identifier ?? undefined,
    candidateKey: row.candidate_key,
    existingEntityId: row.existing_entity_id,
    sourceDocumentId: row.source_document_id ?? undefined,
    status: row.status,
    score: row.score,
    candidate: JSON.parse(row.candidate),
    matchingEvidence: JSON.parse(row.matching_evidence),
    conflictingEvidence: JSON.parse(row.conflicting_evidence),
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
