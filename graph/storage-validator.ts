import type { EventCandidate, RelationshipCandidate } from './storage-types.ts';

export interface ValidationResult {
  valid: boolean;
  reasons: string[];
}

export function validateRelationship(candidate: RelationshipCandidate): ValidationResult {
  const reasons: string[] = [];
  if (!candidate.sourceDocumentId) reasons.push('missing source document');
  if (!candidate.evidence.trim()) reasons.push('missing supporting evidence');
  if (!candidate.subjectEntityId || !candidate.objectEntityId) reasons.push('unresolved entity');
  if (candidate.subjectEntityId === candidate.objectEntityId) reasons.push('self-relationship is unsupported');
  if (candidate.confidence < 0 || candidate.confidence > 1) reasons.push('confidence outside [0,1]');
  if (candidate.resolutionConfidence < 0 || candidate.resolutionConfidence > 1) reasons.push('resolution confidence outside [0,1]');
  if (candidate.percentage !== undefined && (candidate.percentage < 0 || candidate.percentage > 100)) reasons.push('percentage outside [0,100]');
  if (candidate.shares !== undefined && candidate.shares < 0) reasons.push('negative shares');
  if (candidate.predicate === 'HOLDS_SECURITY' && /paid|payment|treasury|invested into/i.test(candidate.evidence)) {
    reasons.push('holding is incorrectly described as a payment');
  }
  return { valid: reasons.length === 0, reasons };
}

export function validateEvent(candidate: EventCandidate): ValidationResult {
  const reasons: string[] = [];
  if (!candidate.sourceDocumentId) reasons.push('missing source document');
  if (!candidate.evidence.trim()) reasons.push('missing supporting evidence');
  if (!candidate.participants.length) reasons.push('event has no participants');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate.eventDate) || Number.isNaN(Date.parse(candidate.eventDate))) reasons.push('invalid event date');
  if (candidate.shares !== undefined && candidate.shares < 0) reasons.push('negative shares');
  if (candidate.pricePerShare !== undefined && candidate.pricePerShare < 0) reasons.push('negative price');
  if (candidate.confidence < 0 || candidate.confidence > 1) reasons.push('confidence outside [0,1]');
  return { valid: reasons.length === 0, reasons };
}
