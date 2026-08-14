// Ephemeral test: feed the VLM's plain-text export through the real,
// production parseDocumentBody() (server/src/law-index/crawl/document-node.parser.ts)
// to see whether it reconstructs the Điều/Khoản/Điểm tree correctly.
import * as fs from 'fs';
import * as path from 'path';
import { parseDocumentBody, ParsedDocumentNode } from '../../../server/src/law-index/crawl/document-node.parser';

const txtPath = path.resolve(
  __dirname,
  '../outputs/docling/VLM/128-2020-QH14_ve-du-toan-ngan-sach-nha-nuoc-nam-2021_wholedoc_plaintext.txt',
);
const fullText = fs.readFileSync(txtPath, 'utf-8');

const roots = parseDocumentBody(fullText);

function summarize(nodes: ParsedDocumentNode[], depth = 0): void {
  for (const node of nodes) {
    const indent = '  '.repeat(depth);
    const headingPreview = node.heading ? ` — ${node.heading.slice(0, 60)}` : '';
    const textPreview = node.textContent ? ` [text: ${node.textContent.slice(0, 50).replace(/\n/g, ' ')}...]` : '';
    console.log(`${indent}${node.nodeType} ${node.label}${headingPreview}${textPreview}`);
    summarize(node.children, depth + 1);
  }
}

console.log(`=== Parsed tree (${roots.length} root nodes) ===`);
summarize(roots);

console.log();
console.log('=== Full JSON ===');
console.log(JSON.stringify(roots, null, 2));
