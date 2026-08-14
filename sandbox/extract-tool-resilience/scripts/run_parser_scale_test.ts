// Runs the real, production parseDocumentBody() against every VLM plain-text
// transcript produced by run_vlm_scale_test.py, saving each document's
// parsed Điều/Khoản/Điểm(/Phụ lục) tree as JSON next to the source .txt,
// plus a summary of node counts per document for a quick scale-test report.
import * as fs from 'fs';
import * as path from 'path';
import {
  parseDocumentBody,
  ParsedDocumentNode,
} from '../../../server/src/law-index/crawl/document-node.parser';

const OUT_DIR = path.resolve(__dirname, '../outputs/VLM');

function countNodes(nodes: ParsedDocumentNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const visit = (list: ParsedDocumentNode[]) => {
    for (const n of list) {
      counts[n.nodeType] = (counts[n.nodeType] ?? 0) + 1;
      visit(n.children);
    }
  };
  visit(nodes);
  return counts;
}

const txtFiles = fs
  .readdirSync(OUT_DIR)
  .filter((f) => f.endsWith('.txt'))
  .sort();

console.log(`Found ${txtFiles.length} transcripts in ${OUT_DIR}`);

const summary: Array<{ file: string; counts: Record<string, number>; rootCount: number; charCount: number }> = [];

for (const file of txtFiles) {
  const txtPath = path.join(OUT_DIR, file);
  const fullText = fs.readFileSync(txtPath, 'utf-8');
  const stem = file.replace(/\.txt$/, '');

  let roots: ParsedDocumentNode[] = [];
  let error: string | null = null;
  try {
    roots = parseDocumentBody(fullText);
  } catch (e) {
    error = `${(e as Error).name}: ${(e as Error).message}`;
  }

  const jsonPath = path.join(OUT_DIR, `${stem}_parsed.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(roots, null, 2), 'utf-8');

  const counts = countNodes(roots);
  summary.push({ file, counts, rootCount: roots.length, charCount: fullText.length });
  console.log(
    `${stem}: ${fullText.length} chars -> ${roots.length} roots, ${JSON.stringify(counts)}${error ? `  ERROR: ${error}` : ''}`,
  );
}

fs.writeFileSync(
  path.join(OUT_DIR, '_parser_summary.json'),
  JSON.stringify(summary, null, 2),
  'utf-8',
);
console.log(`\nSummary written to ${path.join(OUT_DIR, '_parser_summary.json')}`);
