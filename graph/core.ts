import type {
  CandidateBatch, ClaimCandidate, CrossSourceResolutionStatus, EntityCandidate, EntityReference, EventCandidate, IdentifierCandidate, RelationshipCandidate,
  ResolutionCandidate, SourceDocumentCandidate, SourceReference,
} from './domain.ts';
import { validateClaimCandidate, validateEntityCandidate, validateEventCandidate, validateIdentifierCandidate, validateRelationshipCandidate, validateSourceCandidate } from './validator.ts';
import { EvidenceStore } from './store.ts';
import { randomUUID } from 'node:crypto';

const AUTHORITATIVE_IDENTIFIER_SCHEMES = new Set([
  'SEC_CIK', 'LEI', 'EIN', 'COMPANIES_HOUSE', 'COMPANIES_HOUSE_OFFICER_ID', 'REGISTRY_ID', 'FEC_ID', 'FEC_CANDIDATE_ID',
  'FEC_COMMITTEE_ID', 'UEI', 'CUSIP', 'ISIN',
  'DUNS', 'USASPENDING_RECIPIENT_ID', 'USASPENDING_TOP_TIER_AGENCY_CODE', 'USASPENDING_SUB_TIER_AGENCY_CODE',
  'USASPENDING_OFFICE_CODE', 'USASPENDING_AWARD_ID', 'USASPENDING_SUBAWARD_ID',
  'SEC_REPORTING_OWNER_ID', 'INTERNAL',
]);

export class GraphCore {
  readonly store: EvidenceStore;
  private readonly candidateEntities = new Map<string, string>();

  constructor(store: EvidenceStore) {
    this.store = store;
  }

  startRun(agentType: string, metadata: Record<string, unknown> = {}): string {
    return this.store.startRun(agentType, metadata);
  }

  setRunTarget(runId: string, entityId: string): void { this.store.setRunTarget(runId, entityId); }
  finishRun(runId: string, status: 'COMPLETED' | 'FAILED', errors: unknown[] = []): void { this.store.finishRun(runId, status, errors); }
  resolvePersonForIssuer(name: string, issuerId: string, predicates: string[]): string | undefined {
    return this.store.resolvePersonForIssuer(name, issuerId, predicates);
  }

  ingestSource(runId: string, candidate: SourceDocumentCandidate): string | undefined {
    const validation = validateSourceCandidate(candidate);
    this.store.saveValidationResult(runId, validation);
    if (!validation.valid) return this.store.rejectCandidate(runId, 'SOURCE', candidate, validation.reasons);
    return this.store.saveSource({
      provider: candidate.provider,
      documentType: candidate.documentType,
      externalId: candidate.externalId,
      title: candidate.title,
      accessionNumber: candidate.accessionNumber,
      filedAt: candidate.filedAt,
      publishedAt: candidate.publishedAt,
      retrievedAt: candidate.retrievedAt,
      sourceUrl: candidate.sourceUrl,
      rawStoragePath: candidate.rawStoragePath,
      sha256: candidate.sha256,
      parserVersion: candidate.parserVersion,
      evidenceClass: candidate.evidenceClass,
      metadata: { ...candidate.metadata, sourceAgent: candidate.sourceAgent },
    }, runId);
  }

  ingestEntity(runId: string, candidate: EntityCandidate): string | undefined {
    const candidateKey = candidate.candidateKey ?? (candidate.entityType === 'PERSON' && candidate.identifiers.length === 0
      ? `${candidate.sourceAgent}:PERSON:unresolved:${randomUUID()}`
      : `${candidate.sourceAgent}:${candidate.entityType}:${candidate.canonicalName ?? candidate.identifiers.map((identifier) => `${identifier.scheme}:${identifier.value}`).join('|')}`);
    const runCandidateKey = `${runId}:${candidateKey}`;
    const validation = validateEntityCandidate({ ...candidate, candidateKey });
    this.store.saveValidationResult(runId, validation);
    if (!validation.valid) return this.store.rejectCandidate(runId, 'ENTITY', candidate, validation.reasons);
    const remembered = this.candidateEntities.get(runCandidateKey);
    if (remembered) return remembered;
    const authoritative = candidate.identifiers.find((identifier) => AUTHORITATIVE_IDENTIFIER_SCHEMES.has(identifier.scheme));
    const existing = authoritative ? this.store.findExistingEntity(authoritative) : undefined;
    const source = candidate.sourceDocument ? this.resolveSource(candidate.sourceDocument) : undefined;
    const canonicalName = candidate.canonicalName ?? (existing ? String(this.store.getEntity(existing)?.canonical_name ?? '') : '');
    if (!canonicalName) {
      const resolution: ResolutionCandidate = {
        candidateKey, candidateType: 'ENTITY', status: 'REJECTED', confidence: 0,
        reasons: ['canonical name is required when no authoritative identifier resolves'], hints: candidate.resolutionHints ?? [],
      };
      this.store.saveResolutionCandidate(runId, { ...resolution, candidate });
      return this.store.rejectCandidate(runId, 'ENTITY', candidate, resolution.reasons);
    }
    const identifiers = candidate.identifiers.map((identifier) => ({
      ...identifier,
      sourceDocumentId: identifier.sourceDocumentId ?? source?.id,
    }));
    const entityId = this.store.saveEntity({
      entityType: candidate.entityType,
      canonicalName,
      identifiers,
      aliases: candidate.aliases,
      jurisdiction: candidate.jurisdiction,
      status: candidate.status,
      attributes: candidate.attributes,
      resolutionConfidence: candidate.confidence ?? (authoritative ? 1 : 0.8),
    });
    this.saveEntityEvidence(entityId, source, candidate);
    const resolution: ResolutionCandidate = {
      candidateKey, candidateType: 'ENTITY', proposedEntityId: entityId,
      status: existing ? 'RESOLVED' : 'CREATED', confidence: candidate.confidence ?? (authoritative ? 1 : 0.8),
      reasons: existing ? [`matched authoritative identifier ${authoritative?.scheme}`] : [authoritative ? `created from authoritative identifier ${authoritative.scheme}` : 'created as a distinct unresolved identity; name-only merging is disabled'],
      hints: candidate.resolutionHints ?? [],
    };
    this.store.saveResolutionCandidate(runId, { ...resolution, candidate });
    this.candidateEntities.set(runCandidateKey, entityId);
    return entityId;
  }

  ingestResolvedEntity(runId: string, candidate: EntityCandidate, existingEntityId: string, decision: {
    status: Extract<CrossSourceResolutionStatus, 'AUTO_RESOLVED' | 'APPROVED'>;
    score: number;
    matchingEvidence: Array<Record<string, unknown>>;
    conflictingEvidence?: Array<Record<string, unknown>>;
    reason: string;
    decisionActor: string;
    sourceProvider: string;
    sourceIdentifier?: string;
  }): { entityId: string; resolutionCaseId: string } {
    const candidateKey = candidate.candidateKey ?? `${candidate.sourceAgent}:${candidate.entityType}:${candidate.identifiers.map((identifier) => `${identifier.scheme}:${identifier.value}`).join('|')}`;
    const validation = validateEntityCandidate({ ...candidate, candidateKey });
    this.store.saveValidationResult(runId, validation);
    if (!validation.valid) throw new Error(`Resolved entity candidate is invalid: ${validation.reasons.join('; ')}`);
    if (!this.store.getEntity(existingEntityId)) throw new Error(`Resolution target not found: ${existingEntityId}`);
    const source = candidate.sourceDocument ? this.resolveSource(candidate.sourceDocument) : undefined;
    if (candidate.sourceDocument && !source) throw new Error('Resolution source document could not be resolved');
    const entityId = this.store.enrichEntity(existingEntityId, {
      entityType: candidate.entityType,
      canonicalName: candidate.canonicalName!,
      identifiers: candidate.identifiers.map((identifier) => ({ ...identifier, sourceDocumentId: identifier.sourceDocumentId ?? source?.id })),
      aliases: candidate.aliases,
      jurisdiction: candidate.jurisdiction,
      status: candidate.status,
      attributes: candidate.attributes,
      resolutionConfidence: decision.score,
    });
    this.saveEntityEvidence(entityId, source, candidate);
    const resolutionCaseId = this.store.saveResolutionCase({
      sourceProvider: decision.sourceProvider,
      sourceIdentifier: decision.sourceIdentifier,
      candidateKey,
      existingEntityId,
      sourceDocumentId: source ? String(source.id) : undefined,
      status: decision.status,
      score: decision.score,
      candidate,
      matchingEvidence: decision.matchingEvidence,
      conflictingEvidence: decision.conflictingEvidence ?? [],
      reason: decision.reason,
    });
    this.store.saveResolutionDecision({
      resolutionCaseId,
      decisionType: decision.status,
      decisionActor: decision.decisionActor,
      reason: decision.reason,
      evidence: decision.matchingEvidence,
    });
    this.store.saveResolutionCandidate(runId, {
      candidateKey,
      candidate,
      proposedEntityId: existingEntityId,
      status: decision.status,
      confidence: decision.score,
      reasons: [decision.reason],
      hints: candidate.resolutionHints,
    });
    this.candidateEntities.set(`${runId}:${candidateKey}`, entityId);
    return { entityId, resolutionCaseId };
  }

  recordUnresolvedEntity(runId: string, candidate: EntityCandidate, existingEntityId: string, decision: {
    status: Extract<CrossSourceResolutionStatus, 'REVIEW_REQUIRED' | 'NO_MATCH'>;
    score: number;
    matchingEvidence: Array<Record<string, unknown>>;
    conflictingEvidence?: Array<Record<string, unknown>>;
    reason: string;
    sourceProvider: string;
    sourceIdentifier?: string;
    sourceDocumentId?: string;
  }): string {
    const candidateKey = candidate.candidateKey ?? `${candidate.sourceAgent}:${candidate.entityType}:${candidate.identifiers.map((identifier) => `${identifier.scheme}:${identifier.value}`).join('|')}`;
    const resolutionCaseId = this.store.saveResolutionCase({
      ...decision,
      candidateKey,
      existingEntityId,
      candidate,
      conflictingEvidence: decision.conflictingEvidence ?? [],
    });
    this.store.saveResolutionCandidate(runId, {
      candidateKey,
      candidate,
      proposedEntityId: existingEntityId,
      status: decision.status,
      confidence: decision.score,
      reasons: [decision.reason],
      hints: candidate.resolutionHints,
    });
    return resolutionCaseId;
  }

  ingestIdentifier(runId: string, candidate: IdentifierCandidate): {
    status: 'ATTACHED' | 'EXISTING' | 'REVIEW_REQUIRED' | 'REJECTED';
    entityId?: string;
    identifierId?: string;
    resolutionCaseId?: string;
  } {
    const candidateKey = candidate.candidateKey ?? `${candidate.sourceAgent}:${candidate.identifier.scheme}:${candidate.identifier.value}`;
    const validation = validateIdentifierCandidate({ ...candidate, candidateKey });
    this.store.saveValidationResult(runId, validation);
    if (!validation.valid) {
      this.store.rejectCandidate(runId, 'IDENTIFIER', candidate, validation.reasons);
      return { status: 'REJECTED' };
    }

    const entityId = this.resolveEntityReference(runId, candidate.entity, candidate.sourceAgent);
    const source = this.resolveSource(candidate.sourceDocument);
    const reasons = [
      ...(!entityId ? ['entity could not be resolved'] : []),
      ...(!source ? ['source document could not be resolved'] : []),
    ];
    if (reasons.length) {
      this.store.saveValidationResult(runId, { ...validation, valid: false, reasons });
      this.store.rejectCandidate(runId, 'IDENTIFIER', candidate, reasons);
      return { status: 'REJECTED' };
    }

    const existingOwner = this.store.findExistingEntity(candidate.identifier);
    if (existingOwner && existingOwner !== entityId) {
      const reason = `${candidate.identifier.scheme}:${candidate.identifier.value} already belongs to canonical entity ${existingOwner}; conflicting attachment was not merged`;
      const resolutionCaseId = this.store.saveResolutionCase({
        sourceProvider: String(source!.provider),
        sourceIdentifier: `${candidate.identifier.scheme}:${candidate.identifier.value}`,
        candidateKey,
        existingEntityId: existingOwner,
        sourceDocumentId: String(source!.id),
        status: 'REVIEW_REQUIRED',
        score: 1,
        candidate,
        matchingEvidence: [{ kind: 'AUTHORITATIVE_IDENTIFIER', scheme: candidate.identifier.scheme, value: candidate.identifier.value, entityId: existingOwner }],
        conflictingEvidence: [{ kind: 'ENTITY_OWNERSHIP_CONFLICT', existingEntityId: existingOwner, proposedEntityId: entityId }],
        reason,
      });
      this.store.saveResolutionCandidate(runId, {
        candidateKey,
        candidateType: 'IDENTIFIER',
        candidate,
        proposedEntityId: existingOwner,
        status: 'REVIEW_REQUIRED',
        confidence: 1,
        reasons: [reason],
      });
      return { status: 'REVIEW_REQUIRED', entityId, resolutionCaseId };
    }

    const identifier = { ...candidate.identifier, sourceDocumentId: String(source!.id) };
    const identifierId = this.store.saveIdentifier(entityId!, identifier);
    this.store.linkRunSource(runId, String(source!.id));
    this.store.saveEvidenceAssertion({
      subjectType: 'IDENTIFIER',
      subjectId: identifierId,
      sourceDocumentId: String(source!.id),
      evidenceClass: candidate.evidence.evidenceClass,
      assertionType: candidate.assertionType,
      evidence: candidate.evidence.excerpt,
      extractionMethod: candidate.extractionMethod,
      confidence: candidate.confidence,
      attributes: {
        ...candidate.identifier.attributes,
        ...candidate.evidence.fields,
        sourceRecordId: candidate.sourceRecordId,
        sourceAgent: candidate.sourceAgent,
      },
    });
    this.store.saveResolutionCandidate(runId, {
      candidateKey,
      candidateType: 'IDENTIFIER',
      candidate,
      proposedEntityId: entityId,
      status: existingOwner ? 'RESOLVED' : 'CREATED',
      confidence: candidate.confidence,
      reasons: [existingOwner ? 'authoritative identifier already attached to this canonical entity' : 'authoritative identifier attached through canonical ingestion'],
    });
    return { status: existingOwner ? 'EXISTING' : 'ATTACHED', entityId, identifierId };
  }

  ingestRelationship(runId: string, candidate: RelationshipCandidate): string | undefined {
    const validation = validateRelationshipCandidate(candidate);
    this.store.saveValidationResult(runId, validation);
    if (!validation.valid) return this.store.rejectCandidate(runId, 'RELATIONSHIP', candidate, validation.reasons);
    const subjectEntityId = this.resolveEntityReference(runId, candidate.subject, candidate.sourceAgent);
    const objectEntityId = this.resolveEntityReference(runId, candidate.object, candidate.sourceAgent);
    const source = this.resolveSource(candidate.sourceDocument);
    const reasons = [
      ...(!subjectEntityId ? ['subject could not be resolved'] : []),
      ...(!objectEntityId ? ['object could not be resolved'] : []),
      ...(!source ? ['source document could not be resolved'] : []),
    ];
    if (reasons.length) {
      this.store.saveValidationResult(runId, { ...validation, valid: false, reasons: [...validation.reasons, ...reasons] });
      return this.store.rejectCandidate(runId, 'RELATIONSHIP', candidate, reasons);
    }
    const relationshipId = this.store.saveRelationship(runId, {
      subjectEntityId: subjectEntityId!, predicate: candidate.predicate, objectEntityId: objectEntityId!,
      validFrom: candidate.validFrom, validTo: candidate.validTo, observedAt: candidate.observedAt,
      amount: candidate.amount, currency: candidate.currency, percentage: candidate.percentage, shares: candidate.shares,
      assertionType: candidate.assertionType, confidence: candidate.confidence,
      resolutionConfidence: candidate.resolutionConfidence ?? 1, sourceDocumentId: String(source!.id),
      sourceRecordId: candidate.sourceRecordId, sourceUrl: String(source!.source_url),
      extractionMethod: candidate.extractionMethod, evidenceClass: candidate.evidence.evidenceClass,
      evidence: candidate.evidence.excerpt, attributes: { ...candidate.attributes, evidenceFields: candidate.evidence.fields, sourceAgent: candidate.sourceAgent },
    });
    if (relationshipId) this.store.saveEvidenceAssertion({
      subjectType: 'RELATIONSHIP', subjectId: relationshipId, sourceDocumentId: String(source!.id),
      evidenceClass: candidate.evidence.evidenceClass, assertionType: candidate.assertionType,
      evidence: candidate.evidence.excerpt, extractionMethod: candidate.extractionMethod,
      confidence: candidate.confidence, attributes: candidate.evidence.fields,
    });
    return relationshipId;
  }

  ingestEvent(runId: string, candidate: EventCandidate): string | undefined {
    const validation = validateEventCandidate(candidate);
    this.store.saveValidationResult(runId, validation);
    if (!validation.valid) return this.store.rejectCandidate(runId, 'EVENT', candidate, validation.reasons);
    const source = this.resolveSource(candidate.sourceDocument);
    const participants = candidate.participants.map((participant) => ({
      entityId: this.resolveEntityReference(runId, participant.entity, candidate.sourceAgent), role: participant.role,
    }));
    const reasons = [
      ...(!source ? ['source document could not be resolved'] : []),
      ...(participants.some((participant) => !participant.entityId) ? ['one or more participants could not be resolved'] : []),
    ];
    if (reasons.length) {
      this.store.saveValidationResult(runId, { ...validation, valid: false, reasons: [...validation.reasons, ...reasons] });
      return this.store.rejectCandidate(runId, 'EVENT', candidate, reasons);
    }
    const eventId = this.store.saveEvent(runId, {
      eventType: candidate.eventType,
      eventDate: candidate.eventDate ?? String(source!.published_at ?? source!.filed_at ?? new Date().toISOString()).slice(0, 10),
      amount: candidate.amount, currency: candidate.currency, shares: candidate.shares, pricePerShare: candidate.pricePerShare,
      description: candidate.description, sourceDocumentId: String(source!.id), sourceRecordId: candidate.sourceRecordId,
      extractionMethod: candidate.extractionMethod, assertionType: candidate.assertionType,
      evidenceClass: candidate.evidence.evidenceClass, confidence: candidate.confidence,
      evidence: candidate.evidence.excerpt, attributes: { ...candidate.attributes, evidenceFields: candidate.evidence.fields, sourceAgent: candidate.sourceAgent },
      participants: participants.map((participant) => ({ entityId: participant.entityId!, role: participant.role })),
    });
    if (eventId) this.store.saveEvidenceAssertion({
      subjectType: 'EVENT', subjectId: eventId, sourceDocumentId: String(source!.id),
      evidenceClass: candidate.evidence.evidenceClass, assertionType: candidate.assertionType,
      evidence: candidate.evidence.excerpt, extractionMethod: candidate.extractionMethod,
      confidence: candidate.confidence, attributes: candidate.evidence.fields,
    });
    return eventId;
  }

  ingestClaim(runId: string, candidate: ClaimCandidate): string | undefined {
    const validation = validateClaimCandidate(candidate);
    this.store.saveValidationResult(runId, validation);
    if (!validation.valid) return this.store.rejectCandidate(runId, 'CLAIM', candidate, validation.reasons);
    const source = this.resolveSource(candidate.sourceDocument);
    const subjectEntityId = candidate.subject ? this.resolveEntityReference(runId, candidate.subject, candidate.sourceAgent) : undefined;
    if (!source || (candidate.subject && !subjectEntityId)) {
      const reasons = [!source ? 'source document could not be resolved' : 'claim subject could not be resolved'];
      return this.store.rejectCandidate(runId, 'CLAIM', candidate, reasons);
    }
    const claimInput = {
      subjectEntityId, claimType: candidate.claimType, statement: candidate.statement,
      validFrom: candidate.validFrom, validTo: candidate.validTo, observedAt: candidate.observedAt,
      assertionType: candidate.assertionType, confidence: candidate.confidence, sourceDocumentId: String(source!.id),
      sourceRecordId: candidate.sourceRecordId, attributes: { ...candidate.attributes, sourceAgent: candidate.sourceAgent },
    };
    let claimId = this.store.saveClaim(runId, claimInput);
    const evidenceAssertionId = this.store.saveEvidenceAssertion({
      subjectType: 'CLAIM', subjectId: claimId, sourceDocumentId: String(source!.id),
      evidenceClass: candidate.evidence.evidenceClass, assertionType: candidate.assertionType,
      evidence: candidate.evidence.excerpt, extractionMethod: candidate.extractionMethod,
      confidence: candidate.confidence, attributes: candidate.evidence.fields,
    });
    claimId = this.store.saveClaim(runId, { ...claimInput, evidenceAssertionId });
    if (candidate.claimType === 'FINANCIAL_FACT' && subjectEntityId) {
      const fact = candidate.attributes?.fact as Record<string, any> | undefined;
      if (fact) this.store.saveFact(subjectEntityId, String(source!.id), fact);
    }
    return claimId;
  }

  ingestBatch(runId: string, batch: CandidateBatch): void {
    for (const source of batch.sources ?? []) this.ingestSource(runId, source);
    for (const entity of batch.entities ?? []) this.ingestEntity(runId, entity);
    for (const identifier of batch.identifiers ?? []) this.ingestIdentifier(runId, identifier);
    for (const relationship of batch.relationships ?? []) this.ingestRelationship(runId, relationship);
    for (const event of batch.events ?? []) this.ingestEvent(runId, event);
    for (const claim of batch.claims ?? []) this.ingestClaim(runId, claim);
  }

  exportEntityGraph(rootEntityId: string, outputPath: string, runId?: string) {
    return this.store.exportGraph(rootEntityId, outputPath, runId);
  }

  exportCanonicalGraph(outputPath: string, options?: { includeTestFixtures?: boolean }) {
    return this.store.exportCanonicalGraph(outputPath, options);
  }

  private resolveSource(reference: SourceReference): Record<string, any> | undefined {
    return this.store.findSource(reference);
  }

  private saveEntityEvidence(entityId: string, source: Record<string, any> | undefined, candidate: EntityCandidate): void {
    if (!source || !candidate.evidence || !candidate.extractionMethod) return;
    this.store.saveEvidenceAssertion({
      subjectType: 'ENTITY',
      subjectId: entityId,
      sourceDocumentId: String(source.id),
      evidenceClass: candidate.evidence.evidenceClass,
      assertionType: candidate.assertionType ?? 'ASSERTED',
      evidence: candidate.evidence.excerpt,
      extractionMethod: candidate.extractionMethod,
      confidence: candidate.confidence ?? 1,
      attributes: { ...candidate.evidence.fields, sourceRecordId: candidate.sourceRecordId, sourceAgent: candidate.sourceAgent },
    });
  }

  private resolveEntityReference(runId: string, reference: EntityReference, sourceAgent: string): string | undefined {
    if (reference.entityId && this.store.getEntity(reference.entityId)) return reference.entityId;
    const runCandidateKey = reference.candidateKey ? `${runId}:${reference.candidateKey}` : undefined;
    if (runCandidateKey && this.candidateEntities.has(runCandidateKey)) return this.candidateEntities.get(runCandidateKey);
    for (const identifier of reference.identifiers ?? []) {
      const existing = this.store.findExistingEntity(identifier);
      if (existing) return existing;
    }
    if (reference.entityType && reference.canonicalName) return this.ingestEntity(runId, {
      candidateKey: reference.candidateKey,
      entityType: reference.entityType,
      canonicalName: reference.canonicalName,
      identifiers: reference.identifiers ?? [],
      sourceAgent,
    });
    return undefined;
  }
}
