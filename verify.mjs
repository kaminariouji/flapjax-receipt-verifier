#!/usr/bin/env node
// verify.mjs — check a FlapJax buyback receipt against BNB Smart Chain.
//
//   node verify.mjs <txHash>                          # print chain facts
//   node verify.mjs <txHash> --receipt receipts/x.json # compare a receipt
//   node verify.mjs --demo                            # run both sample receipts
//   node verify.mjs <txHash> --json                   # machine-readable output
//
// Exit codes: 0 = PASS, 1 = FAIL, 2 = error.

import { readFileSync } from 'node:fs';
import { collect, compareReceipt, formatTable } from './lib.mjs';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const demo = args.includes('--demo');
const receiptFlag = args.indexOf('--receipt');
const receiptPath = receiptFlag >= 0 ? args[receiptFlag + 1] : null;
const txArg = args.find((a, i) => !a.startsWith('--') && (receiptFlag < 0 || i !== receiptFlag + 1));

function printFacts(chain) {
  const rows = [
    ['tx', chain.tx],
    ['block', String(chain.block)],
    ['time (UTC)', chain.timestamp],
    ['status', chain.status],
    ['from', chain.from],
    ['to', chain.to],
    ['BNB in', String(chain.bnbIn)],
    ['FJ out (wei)', chain.fjOut],
    ['FJ out', String(chain.fjOutFormatted)],
    ['slot0 before', chain.slot0?.pBefore !== undefined ? String(chain.slot0.pBefore) : 'n/a'],
    ['slot0 at', chain.slot0?.pAt !== undefined ? String(chain.slot0.pAt) : 'n/a'],
    ['impact %', chain.impactPct === null ? `n/a (${chain.slot0Error ? 'archive RPC required' : 'unavailable'})` : chain.impactPct.toFixed(4)],
    ['gas fee (wei)', chain.feeWei],
  ];
  console.log(formatTable(rows) + '\n');
}

function printChecks(result) {
  console.log(
    formatTable([
      ['field', 'verdict', 'expected -> actual'],
      ...result.checks.map((c) => [
        c.label,
        c.verdict,
        `${c.expected ?? '-'} -> ${c.actual ?? '-'}${c.note ? ` (${c.note})` : ''}`,
      ]),
    ]) + '\n',
  );
  console.log(result.verdict === 'PASS' ? 'VERDICT: PASS' : `VERDICT: FAIL (${result.failed} field(s))`);
}

async function runOne(tx, receiptFile) {
  const chain = await collect(tx);
  if (jsonOut) {
    const out = { chain };
    if (receiptFile) {
      const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
      out.comparison = compareReceipt(receipt, chain);
    }
    console.log(JSON.stringify(out, null, 2));
    return out.comparison ? (out.comparison.verdict === 'PASS' ? 0 : 1) : 0;
  }
  console.log(`FlapJax receipt check — ${tx}`);
  printFacts(chain);
  if (receiptFile) {
    const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
    const result = compareReceipt(receipt, chain);
    printChecks(result);
    return result.verdict === 'PASS' ? 0 : 1;
  }
  return 0;
}

async function main() {
  if (demo) {
    const samples = [
      ['receipts/2026-10-13.json', '0xc94de373d1fb00093431224a97475b3b2b48b9a4962d15acbe9d9c5c016d720c'],
      ['receipts/2026-10-14.json', '0x172349c64ed3c45663650049f9e2ad3d763b1243c5c849b7d66f144f221d3186'],
      ['receipts/2026-10-16.json', '0xc999000f16f326e8868fe37f83871219be1a63f98043b0aef9ee57f469232156'],
    ];
    let code = 0;
    for (const [file, tx] of samples) {
      const rc = await runOne(tx, file);
      code = Math.max(code, rc);
      console.log('\n' + '-'.repeat(72) + '\n');
    }
    process.exit(code);
  }

  if (!txArg) {
    console.error('usage: node verify.mjs <txHash> [--receipt file.json] [--json] | --demo');
    process.exit(2);
  }

  const rc = await runOne(txArg, receiptPath);
  process.exit(rc);
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(2);
});
