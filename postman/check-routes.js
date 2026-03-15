const fs = require('fs');
const path = require('path');

const root = process.cwd();
const srcDir = path.join(root, 'src');
const collectionPath = path.join(
  root,
  'postman',
  'ecommerce-api.postman_collection.json',
);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.controller.ts'))
      out.push(full);
  }
  return out;
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`'))
  ) {
    return trimmed.slice(1, -1);
  }
  return '';
}

function normalizePath(controllerPrefix, methodPath) {
  const parts = [controllerPrefix, methodPath]
    .filter(Boolean)
    .map((p) => String(p).trim())
    .filter(Boolean)
    .map((p) => p.replace(/^\/+|\/+$/g, ''));
  return '/' + parts.join('/');
}

const sourceSet = new Set();
for (const file of walk(srcDir)) {
  const content = fs.readFileSync(file, 'utf8');
  const classHeader = content.match(/([\s\S]*?)export\s+class\s+/);
  const classBlock = classHeader ? classHeader[1] : '';
  const controllerMatch = classBlock.match(/@Controller\(([^)]*)\)/);
  const prefix = controllerMatch ? stripQuotes(controllerMatch[1]) : '';

  const routeRegex = /@(Get|Post|Patch|Delete)\(([^)]*)\)/g;
  let m;
  while ((m = routeRegex.exec(content)) !== null) {
    const method = m[1].toUpperCase();
    const methodPath = stripQuotes(m[2] || '');
    const fullPath = normalizePath(prefix, methodPath);
    sourceSet.add(`${method} ${fullPath}`);
  }
}

const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));
const collectionSet = new Set();
for (const folder of collection.item || []) {
  for (const req of folder.item || []) {
    collectionSet.add(req.name);
  }
}

const missingInCollection = [...sourceSet]
  .filter((x) => !collectionSet.has(x))
  .sort();
const extraInCollection = [...collectionSet]
  .filter((x) => !sourceSet.has(x))
  .sort();

console.log('Source routes:', sourceSet.size);
console.log('Collection routes:', collectionSet.size);
console.log('Missing in collection:', missingInCollection.length);
for (const r of missingInCollection) console.log('  -', r);
console.log('Extra in collection:', extraInCollection.length);
for (const r of extraInCollection) console.log('  -', r);
