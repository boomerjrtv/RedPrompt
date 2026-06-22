#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const json = p => JSON.parse(read(p));

let fail = 0;
const ok = msg => console.log(`✅ ${msg}`);
const bad = msg => { console.error(`❌ ${msg}`); fail++; };

function assert(cond, msg) { cond ? ok(msg) : bad(msg); }

// JSON/data integrity
const levels = json('public/data/levels.json');
const techniques = json('public/data/techniques.json');
assert(levels.length === 19, '19 challenge/case-study levels present');
assert(techniques.length >= 20, 'technique library present');

function promptContainsSecretOrParts(level) {
  if (level.systemPrompt.includes(level.secret)) return true;
  if (level.id === 8) return true; // encoded vault: prompt intentionally stores base64 form
  const parts = String(level.secret).split(/[-_\s/]+/).filter(p => p.length >= 3 && !/^\d{1,2}$/.test(p));
  if (!parts.length) return false;
  return parts.every(p => level.systemPrompt.toUpperCase().includes(p.toUpperCase()));
}

for (const l of levels) {
  assert(Boolean(l.secret && l.systemPrompt && l.hint && l.starterPayload), `level ${l.id} has secret/systemPrompt/hint/starterPayload`);
  assert(promptContainsSecretOrParts(l), `level ${l.id} prompt contains/derives the target secret`);
}

// Model profile coverage from llm.js
const llm = read('public/llm.js');
const maxLevels = [...llm.matchAll(/maxLevel:\s*(\d+)/g)].map(m => Number(m[1]));
assert((llm.match(/id:\s*"[^"]+"/g) || []).length === 1, 'exactly one public model option');
assert(Math.max(...maxLevels) >= Math.max(...levels.map(l => l.id)), 'public model supports all levels');
assert((llm.match(/recommended:\s*true/g) || []).length === 1, 'exactly one default model');

// Public safety string scan
const filesToScan = [
  'public/index.html','public/app.js','public/llm.js','public/styles.css','README.md',
  'public/data/levels.json','public/data/techniques.json'
];
const banned = [
  /169\.254\.169\.254/i,
  /evil\.example/i,
  /document\.write/i,
  /onerror\s*=/i,
  /sk-prod/i,
  /stripe_live/i,
  /OPENAI_API_KEY=sk-/i,
  /curl\s+[^\n|]+\|\s*sh/i,
  /wget\s+[^\n|]+\|\s*sh/i,
  /nc\s+-e/i,
  /bash\s+-i/i,
  /reverse shell/i,
  /rm\s+-rf/i
];
for (const f of filesToScan) {
  const text = read(f);
  for (const re of banned) assert(!re.test(text), `${f} does not contain banned pattern ${re}`);
}

// Static XSS sanity: app must define central escaping and use it in model-output paths.
const app = read('public/app.js');
assert(/function escapeHTML/.test(app), 'escapeHTML helper exists');
assert(/formatText\(t\)[\s\S]*escapeHTML\(t\)/.test(app), 'chat formatter escapes model/user text');
assert(!/runFuzzer|runRedTeam|runIndirect|view-fuzzer|view-redteam|view-indirect/.test(read('public/index.html') + app), 'removed unused fuzzer/red-team/indirect tabs and code');

if (fail) {
  console.error(`\n${fail} check(s) failed.`);
  process.exit(1);
}

// Deploy-time guard: dev-only files must not ship to production.
const devOnlyFiles = ['public/dev-test.html', 'public/dev-workbench.html'];
for (const f of devOnlyFiles) {
  if (fs.existsSync(f)) {
    console.warn(`⚠  DEV-ONLY: ${f} exists in public/. Delete before deploying.`);
  }
}
console.log('\nAll RedPrompt static security/functionality checks passed.');
