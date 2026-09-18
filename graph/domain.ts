export const ENTITY_TYPES = [
  'PERSON', 'ORGANIZATION', 'COMPANY', 'FUND', 'NONPROFIT', 'PAC',
  'POLITICAL_COMMITTEE', 'GOVERNMENT_ENTITY', 'AWARD', 'SECURITY', 'OTHER',
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];
export const ASSERTION_TYPES = ['ASSERTED', 'REPORTED', 'DERIVED', 'ESTIMATED'] as const;
export type AssertionType = (typeof ASSERTION_TYPES)[number];
export const EVIDENCE_CLASSES = [
  'OFFICIAL_RECORD', 'FIRST_PARTY', 'CORROBORATED_REPORTING',
  'SINGLE_SOURCE_REPORTING', 'DERIVED', 'ESTIMATED',
] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export interface ExternalIdentifier {
  scheme: string;
  value: string;
  jurisdiction?: string;
  sourceDocumentId?: string;
  validFrom?: string;
  validTo?: string;
  attributes?: Record<string, unknown>;
}

export interface ResolutionHint {
  kind: string;
  value: string;
  weight?: number;
}

export interface EntityReference {
  entityId?: string;
  candidateKey?: string;
  identifiers?: ExternalIdentifier[];
  canonicalName?: string;
  entityType?: EntityType;
}

export interface SourceReference {
  sourceDocumentId?: string;
  provider?: string;
  externalId?: string;
  sha256?: string;
}

export interface EvidencePayload {
  excerpt: string;
  evidenceClass: EvidenceClass;
  fields?: Record<string, unknown>;
}

export interface SourceDocumentCandidate {
  provider: string;
  documentType: string;
  externalId: string;
  title?: string;
  accessionNumber?: string;
  filedAt?: string;
  publishedAt?: string;
  retrievedAt?: string;
  sourceUrl: string;
  rawStoragePath: string;
  sha256: string;
  parserVersion: string;
  evidenceClass: EvidenceClass;
  metadata?: Record<string, unknown>;
  sourceAgent: string;
}

export interface EntityCandidate {
  candidateKey?: string;
  entityType: EntityType;
  canonicalName?: string;
  identifiers: ExternalIdentifier[];
  aliases?: string[];
  jurisdiction?: string;
  status?: string;
  attributes?: Record<string, unknown>;
  sourceDocument?: SourceReference;
  sourceAgent: string;
  resolutionHints?: ResolutionHint[];
  confidence?: number;
  assertionType?: AssertionType;
  evidence?: EvidencePayload;
  extractionMethod?: string;
  sourceRecordId?: string;
}

/**
 * A source-backed identifier that should be attached to an already resolvable
 * canonical entity. Workers emit this instead of mutating entity identifiers.
 */
export interface IdentifierCandidate {
  candidateKey?: string;
  entity: EntityReference;
  identifier: ExternalIdentifier;
  sourceDocument: SourceReference;
  sourceAgent: string;
  assertionType: AssertionType;
  confidence: number;
  evidence: EvidencePayload;
  extractionMethod: string;
  sourceRecordId?: string;
}

export interface RelationshipCandidate {
  candidateKey?: string;
  subject: EntityReference;
  predicate: string;
  object: EntityReference;
  validFrom?: string;
  validTo?: string;
  observedAt?: string;
  amount?: number;
  currency?: string;
  percentage?: number;
  shares?: number;
  attributes?: Record<string, unknown>;
  assertionType: AssertionType;
  confidence: number;
  sourceDocument: SourceReference;
  evidence: EvidencePayload;
  extractionMethod: string;
  sourceRecordId?: string;
  sourceAgent: string;
  resolutionConfidence?: number;
}

export interface EventCandidate {
  candidateKey?: string;
  eventType: string;
  eventDate?: string;
  participants: Array<{ entity: EntityReference; role: string }>;
  amount?: number;
  currency?: string;
  shares?: number;
  pricePerShare?: number;
  description: string;
  attributes?: Record<string, unknown>;
  assertionType: AssertionType;
  confidence: number;
  sourceDocument: SourceReference;
  evidence: EvidencePayload;
  extractionMethod: string;
  sourceRecordId: string;
  sourceAgent: string;
}

export interface ClaimCandidate {
  candidateKey?: string;
  subject?: EntityReference;
  claimType: string;
  statement: string;
  validFrom?: string;
  validTo?: string;
  observedAt?: string;
  attributes?: Record<string, unknown>;
  assertionType: AssertionType;
  confidence: number;
  sourceDocument: SourceReference;
  evidence: EvidencePayload;
  extractionMethod: string;
  sourceRecordId?: string;
  sourceAgent: string;
}

export interface CandidateBatch {
  sources?: SourceDocumentCandidate[];
  entities?: EntityCandidate[];
  identifiers?: IdentifierCandidate[];
  relationships?: RelationshipCandidate[];
  events?: EventCandidate[];
  claims?: ClaimCandidate[];
}

export interface ResolutionCandidate {
  candidateKey: string;
  candidateType: 'ENTITY';
  proposedEntityId?: string;
  status: 'RESOLVED' | 'CREATED' | 'AMBIGUOUS' | 'REJECTED' | 'AUTO_RESOLVED' | 'REVIEW_REQUIRED' | 'NO_MATCH';
  confidence: number;
  reasons: string[];
  hints: ResolutionHint[];
}

export type CrossSourceResolutionStatus = 'AUTO_RESOLVED' | 'REVIEW_REQUIRED' | 'NO_MATCH' | 'APPROVED' | 'REJECTED';

export interface CrossSourceResolutionCase {
  id: string;
  sourceProvider: string;
  sourceIdentifier?: string;
  candidateKey: string;
  existingEntityId: string;
  sourceDocumentId?: string;
  status: CrossSourceResolutionStatus;
  score: number;
  candidate: EntityCandidate | IdentifierCandidate;
  matchingEvidence: Array<Record<string, unknown>>;
  conflictingEvidence: Array<Record<string, unknown>>;
  reason: string;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationResult {
  candidateType: 'ENTITY' | 'IDENTIFIER' | 'RELATIONSHIP' | 'EVENT' | 'CLAIM' | 'SOURCE';
  candidateKey: string;
  valid: boolean;
  reasons: string[];
  validatorVersion: string;
}

export interface CanonicalGraphSnapshot {
  generatedAt: string;
  nodes: Array<Record<string, any>>;
  edges: Array<Record<string, any>>;
  events: Array<Record<string, any>>;
  claims: Array<Record<string, any>>;
  sources: Array<Record<string, any>>;
  evidenceAssertions: Array<Record<string, any>>;
  facts: Array<Record<string, any>>;
  stats: Record<string, any>;
}
