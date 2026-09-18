import type { AssertionType, EntityType, EvidenceClass } from './domain.ts';

export interface SourceDocumentInput {
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
  evidenceClass?: EvidenceClass;
  metadata?: Record<string, unknown>;
}

export interface EntityCandidate {
  entityType: EntityType;
  canonicalName: string;
  jurisdiction?: string;
  status?: string;
  identifiers?: Array<{
    scheme: string;
    value: string;
    jurisdiction?: string;
    sourceDocumentId?: string;
    validFrom?: string;
    validTo?: string;
    attributes?: Record<string, unknown>;
  }>;
  aliases?: string[];
  resolutionConfidence?: number;
  attributes?: Record<string, unknown>;
}

export interface RelationshipCandidate {
  subjectEntityId: string;
  predicate: string;
  objectEntityId: string;
  validFrom?: string;
  validTo?: string;
  observedAt?: string;
  amount?: number;
  currency?: string;
  percentage?: number;
  shares?: number;
  assertionType: AssertionType;
  confidence: number;
  resolutionConfidence: number;
  sourceDocumentId: string;
  sourceRecordId?: string;
  sourceUrl: string;
  extractionMethod: string;
  evidenceClass?: EvidenceClass;
  evidence: string;
  attributes?: Record<string, unknown>;
}

export interface EventCandidate {
  eventType: string;
  eventDate: string;
  amount?: number;
  currency?: string;
  shares?: number;
  pricePerShare?: number;
  description: string;
  sourceDocumentId: string;
  sourceRecordId: string;
  extractionMethod: string;
  assertionType?: AssertionType;
  evidenceClass?: EvidenceClass;
  confidence: number;
  evidence: string;
  attributes?: Record<string, unknown>;
  participants: Array<{ entityId: string; role: string }>;
}

export interface GraphSnapshot {
  generatedAt: string;
  run: Record<string, unknown>;
  root: Record<string, unknown>;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  facts: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  rejectedCandidates: Array<Record<string, unknown>>;
  stats: Record<string, unknown>;
}
