import { ASSERTION_TYPES, EVIDENCE_CLASSES } from './domain.ts';
import { ENTITY_TYPES } from './domain.ts';
import type { ClaimCandidate, EntityCandidate, EventCandidate, IdentifierCandidate, RelationshipCandidate, SourceDocumentCandidate, ValidationResult } from './domain.ts';

export const GRAPH_VALIDATOR_VERSION = 'graph-core/1.0.0';

function result(candidateType: ValidationResult['candidateType'], candidateKey: string, reasons: string[]): ValidationResult {
  return { candidateType, candidateKey, valid: reasons.length === 0, reasons, validatorVersion: GRAPH_VALIDATOR_VERSION };
}

function evidenceReasons(candidate: { assertionType: string; confidence: number; extractionMethod: string; evidence: { excerpt: string; evidenceClass: string }; sourceDocument: { sourceDocumentId?: string; provider?: string; externalId?: string } }): string[] {
  const reasons: string[] = [];
  if (!(candidate.confidence >= 0 && candidate.confidence <= 1)) reasons.push('confidence must be between 0 and 1');
  if (!candidate.extractionMethod?.trim()) reasons.push('extraction method is required');
  if (!candidate.evidence?.excerpt?.trim()) reasons.push('evidence excerpt is required');
  if (!EVIDENCE_CLASSES.includes(candidate.evidence?.evidenceClass as any)) reasons.push('recognized evidence class is required');
  if (!ASSERTION_TYPES.includes(candidate.assertionType as any)) reasons.push('recognized assertion type is required');
  if (!candidate.sourceDocument?.sourceDocumentId && !(candidate.sourceDocument?.provider && candidate.sourceDocument?.externalId)) reasons.push('source document reference is required');
  return reasons;
}

export function validateSourceCandidate(candidate: SourceDocumentCandidate): ValidationResult {
  const reasons: string[] = [];
  if (!candidate.provider?.trim()) reasons.push('provider is required');
  if (!candidate.documentType?.trim()) reasons.push('document type is required');
  if (!candidate.externalId?.trim()) reasons.push('external ID is required');
  if (!candidate.sourceUrl?.trim()) reasons.push('source URL is required');
  if (!/^[a-f0-9]{64}$/i.test(candidate.sha256)) reasons.push('SHA-256 must be a 64-character hex digest');
  if (!EVIDENCE_CLASSES.includes(candidate.evidenceClass as any)) reasons.push('recognized evidence class is required');
  return result('SOURCE', `${candidate.provider}:${candidate.externalId}`, reasons);
}

export function validateEntityCandidate(candidate: EntityCandidate): ValidationResult {
  const reasons: string[] = [];
  if (!ENTITY_TYPES.includes(candidate.entityType)) reasons.push('recognized entity type is required');
  if (!candidate.canonicalName?.trim() && candidate.identifiers.length === 0) reasons.push('canonical name or authoritative identifier is required');
  if (!candidate.sourceAgent?.trim()) reasons.push('source agent is required');
  if (candidate.confidence !== undefined && !(candidate.confidence >= 0 && candidate.confidence <= 1)) reasons.push('confidence must be between 0 and 1');
  const identifierKeys = new Set<string>();
  for (const identifier of candidate.identifiers) {
    if (!identifier.scheme?.trim() || !identifier.value?.trim()) reasons.push('identifier scheme and value are required');
    const key = `${identifier.scheme}:${identifier.value}:${identifier.jurisdiction ?? ''}`;
    if (identifierKeys.has(key)) reasons.push('duplicate identifier in entity candidate');
    identifierKeys.add(key);
  }
  if (candidate.evidence || candidate.extractionMethod || candidate.assertionType) {
    if (!candidate.evidence?.excerpt?.trim()) reasons.push('entity evidence excerpt is required');
    if (!EVIDENCE_CLASSES.includes(candidate.evidence?.evidenceClass as any)) reasons.push('recognized entity evidence class is required');
    if (!candidate.extractionMethod?.trim()) reasons.push('entity extraction method is required');
    if (!ASSERTION_TYPES.includes((candidate.assertionType ?? 'ASSERTED') as any)) reasons.push('recognized entity assertion type is required');
    if (!candidate.sourceDocument?.sourceDocumentId && !(candidate.sourceDocument?.provider && candidate.sourceDocument?.externalId)) reasons.push('entity source document reference is required');
  }
  return result('ENTITY', candidate.candidateKey ?? `${candidate.entityType}:${candidate.canonicalName ?? candidate.identifiers.map((identifier) => `${identifier.scheme}:${identifier.value}`).join('|')}`, reasons);
}

export function validateIdentifierCandidate(candidate: IdentifierCandidate): ValidationResult {
  const reasons = evidenceReasons(candidate);
  if (!candidate.sourceAgent?.trim()) reasons.push('source agent is required');
  if (!candidate.entity?.entityId && !(candidate.entity?.identifiers?.length)) reasons.push('resolvable entity reference is required');
  if (!candidate.identifier?.scheme?.trim()) reasons.push('identifier scheme is required');
  if (!candidate.identifier?.value?.trim()) reasons.push('identifier value is required');
  return result(
    'IDENTIFIER',
    candidate.candidateKey ?? `${candidate.identifier?.scheme}:${candidate.identifier?.value}`,
    reasons,
  );
}

export function validateRelationshipCandidate(candidate: RelationshipCandidate): ValidationResult {
  const reasons = evidenceReasons(candidate);
  if (!candidate.predicate?.trim()) reasons.push('predicate is required');
  if (!candidate.subject || !candidate.object) reasons.push('subject and object are required');
  if (candidate.subject?.entityId && candidate.subject.entityId === candidate.object?.entityId) reasons.push('self-relationship is unsupported');
  if (candidate.percentage !== undefined && (candidate.percentage < 0 || candidate.percentage > 100)) reasons.push('percentage must be between 0 and 100');
  if (candidate.shares !== undefined && candidate.shares < 0) reasons.push('shares cannot be negative');
  return result('RELATIONSHIP', candidate.candidateKey ?? candidate.sourceRecordId ?? candidate.predicate, reasons);
}

export function validateEventCandidate(candidate: EventCandidate): ValidationResult {
  const reasons = evidenceReasons(candidate);
  if (!candidate.eventType?.trim()) reasons.push('event type is required');
  if (!candidate.description?.trim()) reasons.push('description is required');
  if (!candidate.participants?.length) reasons.push('at least one participant is required');
  if (!candidate.sourceRecordId?.trim()) reasons.push('source record ID is required');
  return result('EVENT', candidate.candidateKey ?? candidate.sourceRecordId, reasons);
}

export function validateClaimCandidate(candidate: ClaimCandidate): ValidationResult {
  const reasons = evidenceReasons(candidate);
  if (!candidate.claimType?.trim()) reasons.push('claim type is required');
  if (!candidate.statement?.trim()) reasons.push('statement is required');
  return result('CLAIM', candidate.candidateKey ?? candidate.sourceRecordId ?? candidate.claimType, reasons);
}
