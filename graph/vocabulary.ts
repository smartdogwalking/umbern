export interface PredicateDefinition {
  predicate: string;
  category: 'CAREER' | 'OWNERSHIP' | 'MONEY' | 'GOVERNANCE' | 'CORPORATE' | 'CONTEXTUAL';
  inverse?: string;
  temporal: boolean;
}

const definitions: PredicateDefinition[] = [
  { predicate: 'PARENT_OF', inverse: 'SUBSIDIARY_OF', category: 'CORPORATE', temporal: true },
  { predicate: 'SUBSIDIARY_OF', inverse: 'PARENT_OF', category: 'CORPORATE', temporal: true },
  { predicate: 'DIRECT_ACCOUNTING_PARENT_OF', inverse: 'DIRECTLY_ACCOUNTING_CONSOLIDATED_BY', category: 'CORPORATE', temporal: true },
  { predicate: 'DIRECTLY_ACCOUNTING_CONSOLIDATED_BY', inverse: 'DIRECT_ACCOUNTING_PARENT_OF', category: 'CORPORATE', temporal: true },
  { predicate: 'ULTIMATE_ACCOUNTING_PARENT_OF', inverse: 'ULTIMATELY_ACCOUNTING_CONSOLIDATED_BY', category: 'CORPORATE', temporal: true },
  { predicate: 'ULTIMATELY_ACCOUNTING_CONSOLIDATED_BY', inverse: 'ULTIMATE_ACCOUNTING_PARENT_OF', category: 'CORPORATE', temporal: true },
  { predicate: 'SUCCESSOR_OF', inverse: 'PREDECESSOR_OF', category: 'CORPORATE', temporal: true },
  { predicate: 'PREDECESSOR_OF', inverse: 'SUCCESSOR_OF', category: 'CORPORATE', temporal: true },
  { predicate: 'ISSUED_BY', category: 'CORPORATE', temporal: true },
  { predicate: 'OFFICER_OF', category: 'CAREER', temporal: true },
  { predicate: 'SECRETARY_OF', category: 'GOVERNANCE', temporal: true },
  { predicate: 'LLP_MEMBER_OF', category: 'GOVERNANCE', temporal: true },
  { predicate: 'CEO_OF', category: 'CAREER', temporal: true },
  { predicate: 'CFO_OF', category: 'CAREER', temporal: true },
  { predicate: 'DIRECTOR_OF', category: 'GOVERNANCE', temporal: true },
  { predicate: 'CHAIR_OF', category: 'GOVERNANCE', temporal: true },
  { predicate: 'WORKED_AT', category: 'CAREER', temporal: true },
  { predicate: 'PARTNER_AT', category: 'CAREER', temporal: true },
  { predicate: 'FOUNDED', category: 'CAREER', temporal: true },
  { predicate: 'COFOUNDED', category: 'CAREER', temporal: true },
  { predicate: 'BENEFICIAL_OWNER_OF', category: 'OWNERSHIP', temporal: true },
  { predicate: 'HAS_SIGNIFICANT_CONTROL_OVER', category: 'OWNERSHIP', temporal: true },
  { predicate: 'HOLDS_SECURITY', category: 'MONEY', temporal: true },
  { predicate: 'INVESTED_IN', category: 'MONEY', temporal: true },
  { predicate: 'MANAGES', category: 'MONEY', temporal: true },
  { predicate: 'CONTRIBUTED_TO', category: 'MONEY', temporal: true },
  { predicate: 'INDEPENDENT_EXPENDITURE_SUPPORT', category: 'MONEY', temporal: true },
  { predicate: 'INDEPENDENT_EXPENDITURE_OPPOSE', category: 'MONEY', temporal: true },
  { predicate: 'PRIME_RECIPIENT_OF', category: 'MONEY', temporal: true },
  { predicate: 'AWARDING_AGENCY_OF', category: 'MONEY', temporal: true },
  { predicate: 'AWARDING_SUBAGENCY_OF', category: 'MONEY', temporal: true },
  { predicate: 'FUNDING_AGENCY_OF', category: 'MONEY', temporal: true },
  { predicate: 'FUNDING_SUBAGENCY_OF', category: 'MONEY', temporal: true },
  { predicate: 'SUBAWARD_RECIPIENT_OF', category: 'MONEY', temporal: true },
  { predicate: 'PARENT_AWARD_OF', category: 'MONEY', temporal: true },
  { predicate: 'AUTHORIZED_COMMITTEE_OF', category: 'GOVERNANCE', temporal: true },
  { predicate: 'PRINCIPAL_CAMPAIGN_COMMITTEE_OF', category: 'GOVERNANCE', temporal: true },
  { predicate: 'ACQUIRED', inverse: 'ACQUIRED_BY', category: 'CORPORATE', temporal: true },
  { predicate: 'ACQUIRED_BY', inverse: 'ACQUIRED', category: 'CORPORATE', temporal: true },
  { predicate: 'RELATED_PARTY_TO', category: 'CONTEXTUAL', temporal: true },
];

export const PREDICATE_VOCABULARY = new Map(definitions.map((definition) => [definition.predicate, definition]));
export const CAREER_PREDICATES = new Set(definitions.filter((definition) => ['CAREER', 'GOVERNANCE'].includes(definition.category)).map((definition) => definition.predicate));

export function predicateDefinition(predicate: string): PredicateDefinition {
  return PREDICATE_VOCABULARY.get(predicate) ?? { predicate, category: 'CONTEXTUAL', temporal: true };
}
