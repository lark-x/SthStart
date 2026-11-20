import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Nodes } from 'mdast';

const parser = unified().use(remarkParse).use(remarkGfm);

function textOf(node: Nodes): string {
  switch (node.type) {
    case 'text':
    case 'code':
    case 'inlineCode': return node.value;
    case 'break': return '\n';
    case 'html': return node.value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<!--[\s\S]*?-->|<\/?[a-z][^>]*>/gi, '');
    case 'image':
    case 'imageReference': return node.alt || '';
    case 'definition':
    case 'thematicBreak': return '';
    case 'tableRow': return node.children.map(textOf).join('　');
    case 'list':
    case 'table': return node.children.map(textOf).join('\n');
    case 'root':
    case 'blockquote':
    case 'listItem': return node.children.map(textOf).filter(Boolean).join('\n\n');
    default: return 'children' in node ? node.children.map(textOf).join('') : '';
  }
}

/** Keep source snapshots and citation positions intact. Convert only the reader's copy. */
export function referenceText(markdown: string) {
  return textOf(parser.parse(markdown)).trim();
}
