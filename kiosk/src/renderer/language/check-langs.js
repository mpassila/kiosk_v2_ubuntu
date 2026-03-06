#!/usr/bin/env node
/**
 * Language file checker — compares all *.json language files against en.json (reference).
 * Run: node check-langs.js
 *
 * Reports missing and extra keys per language file.
 * Use with Claude Code: paste the output and ask to update the files.
 */

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const REF = 'en.json';

function flattenKeys(obj, prefix = '') {
  let keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys = keys.concat(flattenKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

// Load reference
const refPath = path.join(DIR, REF);
if (!fs.existsSync(refPath)) {
  console.error(`Reference file ${REF} not found in ${DIR}`);
  process.exit(1);
}
const refData = JSON.parse(fs.readFileSync(refPath, 'utf8'));
const refKeys = new Set(flattenKeys(refData));

// Find all other JSON lang files (skip system.json and this script)
const files = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.json') && f !== REF && f !== 'system.json' && f !== 'package.json');

let totalMissing = 0;
let totalExtra = 0;

for (const file of files.sort()) {
  const filePath = path.join(DIR, file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`  ERROR parsing ${file}: ${e.message}`);
    continue;
  }

  const langKeys = new Set(flattenKeys(data));
  const missing = [...refKeys].filter(k => !langKeys.has(k));
  const extra = [...langKeys].filter(k => !refKeys.has(k));

  console.log(`\n=== ${file} ===`);
  console.log(`  Total keys: ${langKeys.size} / ${refKeys.size} (ref)`);

  if (missing.length === 0 && extra.length === 0) {
    console.log('  OK — all keys match reference');
  }

  if (missing.length > 0) {
    totalMissing += missing.length;
    console.log(`  MISSING (${missing.length}):`);
    missing.forEach(k => console.log(`    - ${k}`));
  }

  if (extra.length > 0) {
    totalExtra += extra.length;
    console.log(`  EXTRA (${extra.length}):`);
    extra.forEach(k => console.log(`    + ${k}`));
  }
}

console.log(`\n--- Summary ---`);
console.log(`Reference: ${REF} (${refKeys.size} keys)`);
console.log(`Checked: ${files.length} files`);
console.log(`Total missing: ${totalMissing}`);
console.log(`Total extra: ${totalExtra}`);

if (totalMissing > 0 || totalExtra > 0) {
  console.log(`\nTo update, run Claude Code in this directory and paste:`);
  console.log(`  "check the en.json as that is reference lang... update/check all lang files"`);
}
