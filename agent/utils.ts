import { normalizeName } from '../shared/identity.ts';
export { normalizeName, sha256, stableId } from '../shared/identity.ts';

export function normalizeCik(value: string | number): string {
  const digits = String(value).replace(/\D/g, '');
  if (!digits || digits.length > 10) throw new Error(`Invalid CIK: ${value}`);
  return digits.padStart(10, '0');
}

export function normalizeAccession(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 18) throw new Error(`Invalid accession number: ${value}`);
  return `${digits.slice(0, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
}

export function accessionNoDashes(value: string): string {
  return normalizeAccession(value).replaceAll('-', '');
}

export function accessionFilerCik(value: string): string {
  return String(Number(normalizeAccession(value).slice(0, 10)));
}

export function companySlug(name: string): string {
  return normalizeName(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function decodeHtml(value: string): string {
  const entities: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  };
  return value.replace(/&(#x?[\da-f]+|[a-z]+);/gi, (_match, token: string) => {
    if (token[0] === '#') {
      const hex = token[1]?.toLowerCase() === 'x';
      return String.fromCodePoint(Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10));
    }
    return entities[token.toLowerCase()] ?? `&${token};`;
  });
}

export function stripHtml(html: string): string {
  return normalizeName(
    decodeHtml(
      html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>|<\/div>|<\/tr>|<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, ' '),
    ),
  );
}

export function xmlValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i'));
  if (!match) return undefined;
  const valueMatch = match[1].match(/<(?:\w+:)?value(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?value>/i);
  return normalizeName(decodeHtml((valueMatch?.[1] ?? match[1]).replace(/<[^>]+>/g, ' ')));
}

export function xmlBlocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'gi'))].map((match) => match[1]);
}

export function asNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replaceAll(',', '').replace(/[^\d.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function asBoolean(value?: string): boolean {
  return value?.trim().toLowerCase() === 'true' || value?.trim() === '1';
}
