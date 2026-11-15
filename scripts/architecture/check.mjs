import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const slash = value => value.split(path.sep).join('/');
const sourceFile = file => /\.[cm]?[jt]sx?$/.test(file) && !/\.(test|spec|exercise)\./.test(file) && !file.endsWith('.d.ts');

function filesIn(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : sourceFile(file) ? [file] : [];
  });
}

/** Keep type references in the report, but never mistake them for runtime edges. */
export function dependencies(source) {
  const result = [];
  const add = (node, specifier, typeOnly = false) => {
    if (specifier && ts.isStringLiteralLike(specifier)) result.push({
      specifier: specifier.text, typeOnly, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    });
  };
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyTypes = clause?.isTypeOnly || (!!bindings && ts.isNamedImports(bindings) && !clause.name && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly));
      add(node, node.moduleSpecifier, !!onlyTypes);
    } else if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause;
      const onlyTypes = node.isTypeOnly || (!!clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every(item => item.isTypeOnly));
      add(node, node.moduleSpecifier, !!onlyTypes);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      add(node, node.arguments[0]);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression, node.isTypeOnly);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node, node.argument.literal, true);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

export function stronglyConnected(nodes, edges) {
  const graph = new Map(nodes.map(node => [node, []]));
  for (const edge of edges) graph.get(edge.from)?.push(edge.to);
  let next = 0;
  const indices = new Map(), low = new Map(), stack = [], active = new Set(), result = [];
  function visit(node) {
    indices.set(node, next); low.set(node, next++); stack.push(node); active.add(node);
    for (const target of graph.get(node) ?? []) {
      if (!indices.has(target)) { visit(target); low.set(node, Math.min(low.get(node), low.get(target))); }
      else if (active.has(target)) low.set(node, Math.min(low.get(node), indices.get(target)));
    }
    if (low.get(node) === indices.get(node)) {
      const group = []; let member;
      do { member = stack.pop(); active.delete(member); group.push(member); } while (member !== node);
      if (group.length > 1 || graph.get(node)?.includes(node)) result.push(group.sort());
    }
  }
  nodes.forEach(node => { if (!indices.has(node)) visit(node); });
  return result;
}

export function analyze(root) {
  root = path.resolve(root);
  const configPath = ts.findConfigFile(root, ts.sys.fileExists);
  const config = configPath ? ts.readConfigFile(configPath, ts.sys.readFile).config : {};
  const options = ts.parseJsonConfigFileContent(config, ts.sys, root).options;
  const cache = ts.createModuleResolutionCache(root, file => file, options);
  const files = filesIn(path.join(root, 'app'));
  const names = new Set(files.map(file => slash(path.relative(root, file))));
  const edges = [], external = [], violations = [], clients = [], sources = new Map();
  const issue = (rule, from, to, detail) => violations.push({ rule, from, to, detail });
  for (const file of files) {
    const from = slash(path.relative(root, file));
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    sources.set(from, source);
    if (source.statements.some(node => ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression) && node.expression.text === 'use client')) clients.push(from);
    for (const dependency of dependencies(source)) {
      const resolved = ts.resolveModuleName(dependency.specifier, file, options, ts.sys, cache).resolvedModule;
      const to = resolved ? slash(path.relative(root, resolved.resolvedFileName)) : dependency.specifier;
      const edge = { from, to, ...dependency };
      if (names.has(to)) edges.push(edge);
      else {
        external.push(edge);
        if (!resolved && (dependency.specifier.startsWith('.') || dependency.specifier.startsWith('@/')) && !/\.(css|svg|png|jpg|woff2?)$/.test(dependency.specifier)) issue('unresolved', from, to, 'Local source import could not be resolved');
      }
    }
  }
  const runtime = edges.filter(edge => !edge.typeOnly);
  const program = ts.createProgram(files, { ...options, noEmit: true });
  const checker = program.getTypeChecker();
  const business = file => /^app\/(features|workspaces|shell)\//.test(file);
  const model = file => /\/model\/|\/(?:model|[^/]+-model)\.[jt]sx?$/.test(file);
  const server = file => file.startsWith('app/server/') || file.startsWith('app/api/');
  for (const edge of runtime) {
    const { from, to } = edge;
    if (/^app\/components\/(ui|shared)\//.test(from) && business(to)) issue('ui-business', from, to, 'Generic presentation imports application or business code');
    if (from.startsWith('app/features/') && /^app\/(workspaces|shell|apps)\//.test(to)) issue('feature-composition', from, to, 'Feature imports its composing layer');
    if (model(from) && /\/(components|hooks|providers)\/|\.tsx$/.test(to)) issue('model-effect', from, to, 'Pure model imports UI or hooks');
  }
  for (const edge of external.filter(edge => !edge.typeOnly)) {
    if (model(edge.from) && /^(react|react-dom|next|@tanstack\/react-query|idb)(\/|$)/.test(edge.specifier)) issue('model-effect', edge.from, edge.specifier, 'Pure model imports a runtime adapter');
  }
  for (const [from] of sources) {
    if (!model(from)) continue;
    const source = program.getSourceFile(path.join(root, from));
    if (!source) continue;
    function visit(node) {
      if (ts.isIdentifier(node) && ['window', 'document', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch'].includes(node.text)) {
        const declarations = checker.getSymbolAtLocation(node)?.declarations ?? [];
        if (declarations.some(declaration => /lib\.dom\.d\.ts$/.test(declaration.getSourceFile().fileName))) issue('model-effect', from, node.text, 'Pure model references a browser or network global');
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const graph = new Map();
  for (const edge of runtime) graph.set(edge.from, [...(graph.get(edge.from) ?? []), edge.to]);
  const reached = new Set(), queue = [...clients];
  while (queue.length) {
    const from = queue.shift();
    if (reached.has(from)) continue;
    reached.add(from);
    for (const to of graph.get(from) ?? []) {
      if (server(to)) issue('client-server', from, to, 'Server implementation is reachable from a client entry');
      queue.push(to);
    }
  }
  for (const edge of external) if (!edge.typeOnly && reached.has(edge.from) && /^(node:|server-only$)/.test(edge.specifier)) issue('client-server', edge.from, edge.specifier, 'Server dependency is reachable from a client entry');
  const cycles = stronglyConnected([...names], runtime);
  for (const cycle of cycles) issue('runtime-cycle', cycle[0], cycle.join(' -> '), 'Runtime strongly connected component');
  const feature = file => /^app\/features\/([^/]+)\//.exec(file)?.[1];
  const featureEdges = runtime.filter(edge => feature(edge.from) && feature(edge.to) && feature(edge.from) !== feature(edge.to));
  const featureCycles = stronglyConnected([...new Set(featureEdges.flatMap(edge => [feature(edge.from), feature(edge.to)]))], featureEdges.map(edge => ({ from: feature(edge.from), to: feature(edge.to) })));
  for (const cycle of featureCycles) issue('feature-cycle', cycle[0], cycle.join(' -> '), 'Business modules have a circular dependency');
  return { files: files.length, edges, external, clients, cycles, featureCycles, violations };
}

export function applyExceptions(report, exceptions) {
  const matches = (issue, exception) => issue.rule === exception.rule && issue.from === exception.from && issue.to === exception.to;
  const violations = report.violations.filter(issue => !exceptions.some(exception => matches(issue, exception)));
  const stale = exceptions.filter(exception => !report.violations.some(issue => matches(issue, exception)));
  for (const exception of exceptions) if (!exception.reason || !exception.task) violations.push({ rule: 'invalid-exception', from: exception.from, to: exception.to, detail: 'Every exception needs a reason and a removal task' });
  return { violations, stale };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootIndex = process.argv.indexOf('--root');
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : process.cwd();
  const report = analyze(root);
  const exceptionsPath = path.join(root, 'scripts/architecture/exceptions.json');
  const exceptions = fs.existsSync(exceptionsPath) ? JSON.parse(fs.readFileSync(exceptionsPath, 'utf8')) : [];
  const result = applyExceptions(report, exceptions);
  const outputIndex = process.argv.indexOf('--json');
  if (outputIndex >= 0) fs.writeFileSync(process.argv[outputIndex + 1], JSON.stringify({ ...report, ...result }, null, 2) + '\n');
  console.log(`Architecture: ${report.files} files, ${report.edges.length} local edges, ${result.violations.length} violations, ${result.stale.length} stale exceptions.`);
  for (const issue of result.violations) console.log(`${issue.rule}: ${issue.from} -> ${issue.to}`);
  for (const issue of result.stale) console.log(`stale-exception: ${issue.from} -> ${issue.to}`);
  if (result.violations.length || result.stale.length) process.exitCode = 1;
}
