#!/usr/bin/env node
// Folds index.html and every local module it reaches into dist/index.html: one
// file, the same page, nothing else needed to open it. Three.js stays on its
// CDN through the import map. No dependencies; Node 18 or later.
//
//   node tools/bundle.mjs            writes dist/index.html
//   node tools/bundle.mjs --check    exits non-zero when dist/index.html is stale
//
// The modules are plain ES modules with static imports, which is all this
// folds: default, namespace and named imports; `export const|let|function|class`
// and `export default`. Each module becomes a function scope with its exports
// returned, in dependency order; the entry may use top-level await.

import { readFile, writeFile, mkdir, cp, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'index.html',
  ENTRY = 'src/main.js',
  OUT = 'dist/index.html';

const modules = new Map(); // id -> { id, code, imports, exports, deps }
const externals = new Map(); // specifier -> alias

function parseClause(clause) {
  // "a", "* as ns", "{ a, b as c }", "a, { b }", "a, * as ns"
  const out = { default: null, namespace: null, named: [] };
  let text = clause.trim();
  const star = text.match(/\*\s+as\s+([\w$]+)/);
  if (star) {
    out.namespace = star[1];
    text = text.replace(star[0], '');
  }
  const braces = text.match(/\{([^}]*)\}/);
  if (braces) {
    for (const part of braces[1].split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const [imported, local] = piece.split(/\s+as\s+/).map((s) => s.trim());
      out.named.push({ imported, local: local ?? imported });
    }
    text = text.replace(braces[0], '');
  }
  const def = text.replace(/,/g, '').trim();
  if (def) out.default = def;
  return out;
}

async function load(id) {
  if (modules.has(id)) return modules.get(id);
  const code = await readFile(path.join(root, id), 'utf8');
  const record = { id, code, imports: [], exports: [], deps: [] };
  modules.set(id, record);
  const importRe = /^import\s+([^'"]+?)\s+from\s*['"]([^'"]+)['"]\s*;?[ \t]*$/gms;
  record.stripped = code.replace(importRe, (whole, clause, specifier) => {
    const clauseParsed = parseClause(clause);
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const depId = path.relative(root, path.resolve(path.join(root, path.dirname(id)), specifier)).split(path.sep).join('/');
      record.imports.push({ ...clauseParsed, dep: depId });
      record.deps.push(depId);
    } else {
      if (!externals.has(specifier)) externals.set(specifier, `__ext${externals.size}`);
      record.imports.push({ ...clauseParsed, external: externals.get(specifier) });
    }
    return '';
  });
  // exports
  record.stripped = record.stripped
    .replace(/^export\s+default\s+/gm, () => '__exports.default = ')
    .replace(/^export\s+(const|let|var|function|class|async\s+function)\s+([\w$]+)/gm, (whole, kind, name) => {
      record.exports.push(name);
      return `${kind} ${name}`;
    })
    .replace(/^export\s*\{([^}]*)\}\s*;?/gm, (whole, list) => {
      for (const part of list.split(',')) {
        const piece = part.trim();
        if (piece) record.exports.push(piece.split(/\s+as\s+/)[0].trim());
      }
      return '';
    });
  // the guards read code, not comments: JSDoc types may say import('three')
  const codeOnly = record.stripped.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  if (/^export\s/m.test(codeOnly)) throw new Error(`${id}: an export form this bundler does not fold`);
  if (/\bimport\s*\(/.test(codeOnly) || /import\.meta/.test(codeOnly))
    throw new Error(`${id}: dynamic import or import.meta cannot be folded`);
  for (const dep of record.deps) await load(dep);
  return record;
}

function order(entryId) {
  const seen = new Set(),
    out = [];
  const visit = (id, trail) => {
    if (seen.has(id)) return;
    if (trail.includes(id)) throw new Error(`circular import: ${[...trail, id].join(' -> ')}`);
    for (const dep of modules.get(id).deps) visit(dep, [...trail, id]);
    seen.add(id);
    out.push(id);
  };
  visit(entryId, []);
  return out;
}

function wrap(record, isEntry) {
  const head = record.imports
    .map((imp) => {
      const source = imp.external ? imp.external : `__modules[${JSON.stringify(imp.dep)}]`;
      const lines = [];
      if (imp.namespace) lines.push(`const ${imp.namespace} = ${source};`);
      if (imp.default) lines.push(`const ${imp.default} = ${source}.default;`);
      if (imp.named.length)
        lines.push(`const { ${imp.named.map((n) => (n.imported === n.local ? n.imported : `${n.imported}: ${n.local}`)).join(', ')} } = ${source};`);
      return lines.join('\n');
    })
    .join('\n');
  const tail = record.exports.map((name) => `__exports.${name} = ${name};`).join('\n');
  const body = `const __exports = {};\n${head}\n${record.stripped}\n${tail}\nreturn __exports;`;
  return isEntry
    ? `await (async () => {\n${body}\n})();`
    : `__modules[${JSON.stringify(record.id)}] = (() => {\n${body}\n})();`;
}

const page = await readFile(path.join(root, PAGE), 'utf8');
await load(ENTRY);
const ids = order(ENTRY);
const externalImports = [...externals].map(([spec, alias]) => `import * as ${alias} from ${JSON.stringify(spec)};`).join('\n');
const bundle = [
  '// Built by tools/bundle.mjs from index.html, src/ and library/. Edit those, not this.',
  externalImports,
  'const __modules = {};',
  ...ids.map((id) => wrap(modules.get(id), id === ENTRY)),
].join('\n');
if (bundle.includes('</script')) throw new Error('the bundle would close the script tag');
const tag = /[ \t]*<!--[^>]*-->\n[ \t]*<script type="module" src="\.\/src\/main\.js"><\/script>/;
if (!tag.test(page)) throw new Error('index.html does not load ./src/main.js the way this bundler expects');
const out = page.replace(tag, () => `    <script type="module">\n${bundle}\n    </script>`);

const outPath = path.join(root, OUT);
if (process.argv.includes('--check')) {
  const current = await readFile(outPath, 'utf8').catch(() => null);
  if (current !== out) {
    console.error(`${OUT} is stale; run node tools/bundle.mjs`);
    process.exit(1);
  }
  console.log(`${OUT} is current`);
} else {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, out);
  // .nojekyll rides along so Pages serves the file as it is
  for (const extra of ['.nojekyll']) {
    const from = path.join(root, extra);
    if (await access(from).then(() => true, () => false)) await cp(from, path.join(root, 'dist', extra), { recursive: true });
  }
  console.log(`${OUT}: ${ids.length} modules folded, ${(out.length / 1024).toFixed(0)} KB`);
}
