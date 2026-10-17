#!/usr/bin/env node
// selftest.mjs — run the verifier against two known-good buybacks and assert
// the fields we already audited independently. No dependencies.
//
//   node selftest.mjs
//   BSC_ARCHIVE_RPC=... node selftest.mjs   # also checks slot0 impact

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { collect, compareReceipt } from './lib.mjs';

// Resolve fixtures against this file, not the caller's working directory, so
// `node path/to/selftest.mjs` behaves the same as `cd repo && node selftest.mjs`.
const HERE = dirname(fileURLToPath(import.meta.url));

const CASES = [
  {
    file: 'receipts/2026-10-13.json',
    tx: '0xc94de373d1fb00093431224a97475b3b2b48b9a4962d15acbe9d9c5c016d720c',
    block: 127452454,
    fjOut: '23762833230024087278551319',
    impactPct: 0.303,
  },
  {
    file: 'receipts/2026-10-14.json',
    tx: '0x172349c64ed3c45663650049f9e2ad3d763b1243c5c849b7d66f144f221d3186',
    block: 127643212,
    fjOut: '23691113109537150143912753',
    impactPct: 0.3025,
  },
  {
    file: 'receipts/2026-10-16.json',
    tx: '0xc999000f16f326e8868fe37f83871219be1a63f98043b0aef9ee57f469232156',
    block: 128086717,
    fjOut: '23669235465921230581203552',
    impactPct: 0.3024,
  },
];

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

for (const c of CASES) {
  console.log(`\n=== ${c.file}`);
  const chain = await collect(c.tx);

  check('status is success', chain.status === 'success', chain.status);
  check('block matches', chain.block === c.block, String(chain.block));
  check('BNB in is 0.01', Math.abs(chain.bnbIn - 0.01) < 1e-12, String(chain.bnbIn));
  check('FJ out matches', chain.fjOut === c.fjOut, chain.fjOut);

  if (chain.impactPct !== null) {
    check(
      'slot0 impact matches',
      Math.abs(chain.impactPct - c.impactPct) < 0.01,
      `${chain.impactPct.toFixed(4)}% vs ${c.impactPct}%`,
    );
  } else {
    console.log('SKIP  slot0 impact — set BSC_ARCHIVE_RPC to check it');
  }

  const receipt = JSON.parse(readFileSync(join(HERE, c.file), 'utf8'));
  const cmp = compareReceipt(receipt, chain);
  check('receipt comparison PASS', cmp.verdict === 'PASS', `${cmp.failed} failed field(s)`);

  // Tamper test: a receipt that is off by one wei must FAIL. A verifier that
  // only ever says PASS is not a verifier.
  const tampered = { ...receipt, fjOut: shiftLastDigit(receipt.fjOut, 1) };
  const bad = compareReceipt(tampered, chain);
  check('tampered receipt (last digit +1) FAILS', bad.verdict === 'FAIL', bad.verdict);
}

function shiftLastDigit(decimal, delta) {
  const [whole, frac = ''] = String(decimal).split('.');
  const digits = (whole + frac).split('');
  let i = digits.length - 1;
  while (i >= 0) {
    const d = Number(digits[i]) + delta;
    if (d >= 0 && d <= 9) {
      digits[i] = String(d);
      break;
    }
    digits[i] = d < 0 ? '9' : '0';
    delta = d < 0 ? -1 : 1;
    i--;
  }
  const s = digits.join('');
  return frac ? `${s.slice(0, s.length - frac.length)}.${s.slice(s.length - frac.length)}` : s;
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
