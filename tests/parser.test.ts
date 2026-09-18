import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExhibit21 } from '../agent/parsers/exhibit21.ts';

test('Exhibit 21 parser preserves subsidiary names, jurisdiction, and evidence', () => {
  const rows = parseExhibit21(`<table>
    <tr><th>Name</th><th>Jurisdiction</th></tr>
    <tr><td>Example Research &amp; Development LLC</td><td>Delaware</td></tr>
    <tr><td>Example International Ltd</td><td>Ireland</td></tr>
  </table>`);
  assert.deepEqual(rows, [
    { name: 'Example Research & Development LLC', jurisdiction: 'Delaware', evidence: 'Example Research & Development LLC — Delaware' },
    { name: 'Example International Ltd', jurisdiction: 'Ireland', evidence: 'Example International Ltd — Ireland' },
  ]);
});

test('Exhibit 21 parser skips headers and collapses duplicate rows', () => {
  const html = '<table><tr><td>Name</td><td>Jurisdiction</td></tr><tr><td>Example LLC</td><td>Delaware</td></tr><tr><td>Example LLC</td><td>Delaware</td></tr></table>';
  assert.equal(parseExhibit21(html).length, 1);
  assert.deepEqual(parseExhibit21(html), parseExhibit21(html));
});

test('Exhibit 21 parser returns no invented records for empty input', () => {
  assert.deepEqual(parseExhibit21(''), []);
});
