import { decodeHtml, normalizeName, stripHtml } from '../utils.ts';

export interface ParsedSubsidiary {
  name: string;
  jurisdiction?: string;
  evidence: string;
}

const HEADER_WORDS = /^(name|subsidiar|jurisdiction|state or country|place of incorporation)/i;

export function parseExhibit21(html: string): ParsedSubsidiary[] {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const subsidiaries: ParsedSubsidiary[] = [];
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cell) => normalizeName(stripHtml(cell[1])))
      .filter(Boolean);
    if (!cells.length || HEADER_WORDS.test(cells.join(' '))) continue;
    const [name, jurisdiction] = cells;
    if (!name || name.length < 2 || /^\d+$/.test(name)) continue;
    subsidiaries.push({
      name: decodeHtml(name),
      jurisdiction: jurisdiction ? decodeHtml(jurisdiction) : undefined,
      evidence: cells.join(' — '),
    });
  }

  if (subsidiaries.length) return uniqueSubsidiaries(subsidiaries);

  const text = stripHtml(html);
  for (const line of text.split(/\n+/)) {
    const parts = line.split(/\s{2,}|\t+/).map(normalizeName).filter(Boolean);
    if (parts.length >= 2 && !HEADER_WORDS.test(parts.join(' '))) {
      subsidiaries.push({ name: parts[0], jurisdiction: parts.at(-1), evidence: line.trim() });
    }
  }
  return uniqueSubsidiaries(subsidiaries);
}

function uniqueSubsidiaries(items: ParsedSubsidiary[]): ParsedSubsidiary[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
