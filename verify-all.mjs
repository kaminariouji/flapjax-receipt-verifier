#!/usr/bin/env node
// verify-all.mjs — verify every receipt in receipts/ against BNB Chain and
// print one line per receipt. Exit 0 only if every receipt PASSES.
//
//   node verify-all.mjs
//   BSC_ARCHIVE_RPC=... node verify-all.mjs   # also checks slot0 impact
//
// This is the unattended mode: no arguments, no interaction, deterministic
// exit code. It is what the GitHub Actions workflow runs on a schedule.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collect, compareReceipt } from './lib.mjs';

const DIR = 'receipts';
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

if (files.length === 0) {
  console.error('no receipts found in ./receipts');
  process.exit(2);
}

const rows = [];
let failed = 0;

for (const file of files) {
  const receipt = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  let row;
  try {
    const chain = await collect(receipt.tx);
    const cmp = compareReceipt(receipt, chain);
    const ok = cmp.verdict === 'PASS' && chain.status === 'success';
    if (!ok) failed++;
    row = {
      date: receipt.date ?? file.replace('.json', ''),
      block: chain.block,
      fjOut: chain.fjOut,
      impact: chain.impactPct === null ? 'n/a' : `${chain.impactPct.toFixed(4)}%`,
      verdict: ok ? 'PASS' : 'FAIL',
      note: ok ? '' : `${cmp.failed} field(s) differ`,
    };
  } catch (err) {
    failed++;
    row = {
      date: receipt.date ?? file.replace('.json', ''),
      block: '-',
      fjOut: '-',
      impact: '-',
      verdict: 'ERROR',
      note: String(err.message ?? err).slice(0, 60),
    };
  }
  rows.push(row);
}

const cols = ['date', 'block', 'fjOut', 'impact', 'verdict', 'note'];
const width = Object.fromEntries(
  cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c]).length))]),
);
const line = (vals) =>
  vals
    .map((v, i) => String(v).padEnd(width[cols[i]]))
    .join('  ')
    .trimEnd();

console.log(line(cols));
console.log(line(cols.map((c) => '-'.repeat(width[c]))));
for (const r of rows) console.log(line(cols.map((c) => r[c])));

console.log(
  `\n${rows.length} receipt(s), ${rows.length - failed} passed, ${failed} failed`,
);
if (process.env.BSC_ARCHIVE_RPC) {
  console.log('slot0 impact: checked (archive RPC set)');
} else {
  console.log('slot0 impact: skipped — set BSC_ARCHIVE_RPC to include price impact');
}

process.exit(failed === 0 ? 0 : 1);
