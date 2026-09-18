import { CAREER_PREDICATES } from './vocabulary.ts';

export interface GraphLike {
  nodes: Array<Record<string, any>>;
  edges: Array<Record<string, any>>;
  events?: Array<Record<string, any>>;
  sources?: Array<Record<string, any>>;
  claims?: Array<Record<string, any>>;
}

export interface TraversalOptions {
  depth?: number;
  predicates?: string[];
  entityTypes?: string[];
  direction?: 'in' | 'out' | 'both';
  dateFrom?: string;
  dateTo?: string;
}

export function mergeGraphs(graphs: GraphLike[]): GraphLike & { claims: Array<Record<string, any>> } {
  const unique = (records: Array<Record<string, any>>) => [...new Map(records.map((record) => [String(record.id), record])).values()];
  return {
    nodes: unique(graphs.flatMap((graph) => graph.nodes)),
    edges: unique(graphs.flatMap((graph) => graph.edges)),
    events: unique(graphs.flatMap((graph) => graph.events ?? [])),
    sources: unique(graphs.flatMap((graph) => graph.sources ?? [])),
    claims: unique(graphs.flatMap((graph) => graph.claims ?? [])),
  };
}

const MAX_DEPTH = 4;

function safeDepth(depth = 1): number {
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH) throw new Error(`depth must be an integer between 1 and ${MAX_DEPTH}`);
  return depth;
}

function edgeInDateRange(edge: Record<string, any>, dateFrom?: string, dateTo?: string): boolean {
  const start = edge.valid_from ?? edge.observed_at?.slice(0, 10);
  const end = edge.valid_to ?? start;
  if (dateFrom && end && end < dateFrom) return false;
  if (dateTo && start && start > dateTo) return false;
  return true;
}

function adjacent(edge: Record<string, any>, entityId: string, direction: TraversalOptions['direction']): string | undefined {
  if ((direction === 'out' || direction === 'both') && edge.subject_entity_id === entityId) return edge.object_entity_id;
  if ((direction === 'in' || direction === 'both') && edge.object_entity_id === entityId) return edge.subject_entity_id;
  return undefined;
}

export function traverseGraph(graph: GraphLike, rootEntityId: string, options: TraversalOptions = {}) {
  const depth = safeDepth(options.depth);
  const direction = options.direction ?? 'both';
  if (!['in', 'out', 'both'].includes(direction)) throw new Error('direction must be in, out, or both');
  const nodeById = new Map(graph.nodes.map((node) => [String(node.id), node]));
  if (!nodeById.has(rootEntityId)) throw new Error('entity not found');
  const visited = new Map<string, number>([[rootEntityId, 0]]);
  let frontier = [rootEntityId];
  const edgeById = new Map<string, Record<string, any>>();
  for (let level = 0; level < depth && frontier.length; level += 1) {
    const next: string[] = [];
    for (const entityId of frontier) {
      for (const edge of graph.edges) {
        if (options.predicates?.length && !options.predicates.includes(String(edge.predicate))) continue;
        if (!edgeInDateRange(edge, options.dateFrom, options.dateTo)) continue;
        const otherId = adjacent(edge, entityId, direction);
        if (!otherId) continue;
        const other = nodeById.get(String(otherId));
        if (!other) continue;
        if (options.entityTypes?.length && !options.entityTypes.includes(String(other.entity_type))) continue;
        edgeById.set(String(edge.id), edge);
        if (!visited.has(String(otherId))) {
          visited.set(String(otherId), level + 1);
          next.push(String(otherId));
        }
      }
    }
    frontier = next;
  }
  return {
    root: nodeById.get(rootEntityId),
    nodes: [...visited].map(([id, distance]) => ({ ...nodeById.get(id), distance })),
    edges: [...edgeById.values()],
    depth,
    direction,
  };
}

export function getNeighbors(graph: GraphLike, entityId: string, options: Omit<TraversalOptions, 'depth'> = {}) {
  return traverseGraph(graph, entityId, { ...options, depth: 1 });
}

export function findPath(graph: GraphLike, from: string, to: string, options: TraversalOptions & { maxDepth?: number } = {}) {
  const maxDepth = safeDepth(options.maxDepth ?? options.depth ?? MAX_DEPTH);
  const direction = options.direction ?? 'both';
  const nodeById = new Map(graph.nodes.map((node) => [String(node.id), node]));
  if (!nodeById.has(from) || !nodeById.has(to)) throw new Error('from and to must identify canonical entities');
  if (from === to) return { found: true, entities: [nodeById.get(from)], hops: [], depth: 0 };
  const sourceById = new Map((graph.sources ?? []).map((source) => [String(source.id), source]));
  const queue: Array<{ entityId: string; entities: string[]; hops: Array<Record<string, any>> }> = [{ entityId: from, entities: [from], hops: [] }];
  const visited = new Set([from]);
  while (queue.length) {
    const current = queue.shift()!;
    if (current.hops.length >= maxDepth) continue;
    for (const edge of graph.edges) {
      if (options.predicates?.length && !options.predicates.includes(String(edge.predicate))) continue;
      if (!edgeInDateRange(edge, options.dateFrom, options.dateTo)) continue;
      const nextId = adjacent(edge, current.entityId, direction);
      if (!nextId || visited.has(String(nextId))) continue;
      const node = nodeById.get(String(nextId));
      if (!node || (options.entityTypes?.length && !options.entityTypes.includes(String(node.entity_type)))) continue;
      const hop = {
        from: current.entityId,
        to: String(nextId),
        direction: edge.subject_entity_id === current.entityId ? 'out' : 'in',
        relationship: edge,
        source: sourceById.get(String(edge.source_document_id)),
      };
      const entities = [...current.entities, String(nextId)];
      const hops = [...current.hops, hop];
      if (String(nextId) === to) return { found: true, entities: entities.map((id) => nodeById.get(id)), hops, depth: hops.length };
      visited.add(String(nextId));
      queue.push({ entityId: String(nextId), entities, hops });
    }
  }
  return { found: false, entities: [], hops: [], depth: null };
}

export function getTimeline(graph: GraphLike, entityId: string, options: { dateFrom?: string; dateTo?: string } = {}) {
  const eventEntries = (graph.events ?? []).filter((event) => parseParticipants(event.participants).some((participant) => participant.entityId === entityId))
    .filter((event) => (!options.dateFrom || event.event_date >= options.dateFrom) && (!options.dateTo || event.event_date <= options.dateTo))
    .map((event) => ({ kind: 'EVENT', date: event.event_date, record: event }));
  const relationshipEntries = graph.edges.filter((edge) => edge.subject_entity_id === entityId || edge.object_entity_id === entityId)
    .filter((edge) => edgeInDateRange(edge, options.dateFrom, options.dateTo))
    .map((edge) => ({ kind: 'RELATIONSHIP', date: edge.valid_from ?? edge.observed_at?.slice(0, 10), record: edge }));
  return [...eventEntries, ...relationshipEntries].sort((left, right) => String(right.date ?? '').localeCompare(String(left.date ?? '')));
}

export function getCareerTransitions(graph: GraphLike, organizationId: string) {
  const nodeById = new Map(graph.nodes.map((node) => [String(node.id), node]));
  const people = new Set(graph.edges.filter((edge) => edge.object_entity_id === organizationId && CAREER_PREDICATES.has(String(edge.predicate)))
    .map((edge) => String(edge.subject_entity_id)).filter((id) => nodeById.get(id)?.entity_type === 'PERSON'));
  const transitions: Array<Record<string, any>> = [];
  for (const personId of people) {
    const career = graph.edges.filter((edge) => edge.subject_entity_id === personId && CAREER_PREDICATES.has(String(edge.predicate)))
      .sort((left, right) => String(left.valid_from ?? left.observed_at ?? '').localeCompare(String(right.valid_from ?? right.observed_at ?? '')));
    const atOrganization = career.filter((edge) => edge.object_entity_id === organizationId);
    const relationship = atOrganization.at(-1);
    if (!relationship) continue;
    const index = career.lastIndexOf(relationship);
    const previous = career.slice(0, index).reverse().find((edge) => edge.object_entity_id !== organizationId);
    const next = career.slice(index + 1).find((edge) => edge.object_entity_id !== organizationId);
    transitions.push({
      person: nodeById.get(personId),
      atOrganization: relationship,
      atOrganizationAssertions: atOrganization,
      previous: previous ? { relationship: previous, organization: nodeById.get(String(previous.object_entity_id)) } : null,
      next: next ? { relationship: next, organization: nodeById.get(String(next.object_entity_id)) } : null,
    });
  }
  return transitions;
}

export function searchEntities(graph: GraphLike, query: string, limit = 20) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return graph.nodes.map((entity) => {
    const attributes = entity.attributes ?? {};
    const haystack = [entity.canonical_name, entity.aliases, entity.identifiers, attributes.ticker, ...(attributes.tickers ?? [])].join(' ').toLowerCase();
    const name = String(entity.canonical_name ?? '').toLowerCase();
    const score = name === normalized ? 100 : name.startsWith(normalized) ? 80 : haystack.includes(normalized) ? 50 : 0;
    return { entity, score };
  }).filter((result) => result.score > 0).sort((left, right) => right.score - left.score || String(left.entity.canonical_name).localeCompare(String(right.entity.canonical_name))).slice(0, Math.min(Math.max(limit, 1), 50));
}

export function appendTraversalTrail(trail: string[], entityId: string, maxLength = 12): string[] {
  if (trail.at(-1) === entityId) return trail;
  return [...trail, entityId].slice(-maxLength);
}

export function parseParticipants(value: unknown): Array<{ entityId: string; role: string }> {
  if (Array.isArray(value)) return value.map((participant) => ({ entityId: String(participant.entityId ?? participant.entity_id), role: String(participant.role) }));
  if (typeof value !== 'string') return [];
  return value.split('|').filter(Boolean).map((token) => {
    const separator = token.lastIndexOf(':');
    return { entityId: token.slice(0, separator), role: token.slice(separator + 1) };
  });
}
