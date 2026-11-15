import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

// Compare semantic nodes in sequence, including mixed declarations/nested rules.
// Comments/formatting are ignored; selectors, values and import order are retained.
function expand(file, ancestors = []) {
  const absolute = path.resolve(file);
  if (ancestors.includes(absolute)) throw new Error(`CSS import cycle: ${absolute}`);
  const root = postcss.parse(fs.readFileSync(absolute, 'utf8'));
  return root.nodes.flatMap(node => {
    if (node.type === 'comment') return [];
    if (node.type === 'atrule' && node.name === 'import') {
      const match = /^['"]([^'"]+)['"]$/.exec(node.params);
      if (match && match[1].startsWith('.')) return expand(path.resolve(path.dirname(absolute), match[1]), [...ancestors, absolute]);
    }
    return [signature(node)];
  });
}

function signature(node) {
  if (node.type === 'decl') return { type: node.type, prop: node.prop, value: node.value, important: Boolean(node.important) };
  return {
    type: node.type,
    ...(node.type === 'rule' ? { selector: node.selector } : {}),
    ...(node.type === 'atrule' ? { name: node.name, params: node.params } : {}),
    ...(node.nodes ? { children: node.nodes.filter(child => child.type !== 'comment').map(signature) } : {}),
  };
}

const [baseline, current = process.cwd()] = process.argv.slice(2);
if (!baseline) throw new Error('Usage: node scripts/architecture/compare-styles.mjs <baseline-root> [current-root]');
for (const file of ['app/globals.css', 'app/styles/shell.css', 'app/styles/workspace-b.css', 'app/styles/workspace-unified.css']) {
  const before = expand(path.resolve(baseline, file));
  const after = expand(path.resolve(current, file));
  const equal = JSON.stringify(before) === JSON.stringify(after);
  console.log(`${equal ? 'PASS' : 'FAIL'} ${file}: ${before.length} / ${after.length} ordered nodes`);
  if (!equal) process.exitCode = 1;
}
