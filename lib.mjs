// lib.mjs — core helpers for the FlapJax receipt verifier.
// No dependencies. Node 18+ (global fetch).

export const CHAIN_ID = 56;

export const FJ = '0x90c8889f428f9ebb77bb8f15cad3a50a9ac680df';
export const TREASURY = '0x7c34e9e21ee28a49ff0b84b61774119e6633359f';
export const POOL = '0xca93ec685b8623688e6b236f9068034b298c2150';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const SLOT0_SELECTOR = '0x3850c7bd';
const BALANCEOF_SELECTOR = '0x70a08231';

export const RPC_ENDPOINTS = [
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed.binance.org',
  'https://bsc-rpc.publicnode.com',
  'https://bsc.drpc.org',
  'https://1rpc.io/bnb',
];

// Reading slot0 at a past block needs an archive node. Public BSC endpoints
// answer "missing trie node". Set BSC_ARCHIVE_RPC to any archive endpoint
// (your own node, NodeReal, QuickNode, ...) to enable the impact check.
export const ARCHIVE_RPC = process.env.BSC_ARCHIVE_RPC || null;

const hex = (n) => '0x' + BigInt(n).toString(16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let rpcId = 1;

async function rpcCall(url, method, params, timeoutMs = 20000) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} from ${url}`);
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error).slice(0, 160)}`);
  if (json.result === undefined) throw new Error(`${method}: empty result from ${url}`);
  return json.result;
}

/** Try each endpoint in order until one answers. */
export async function rpc(method, params, endpoints = RPC_ENDPOINTS) {
  let lastErr;
  for (const url of endpoints) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await rpcCall(url, method, params);
      } catch (e) {
        lastErr = e;
        await sleep(300 * (attempt + 1));
      }
    }
  }
  throw new Error(`all RPC endpoints failed for ${method}: ${lastErr && lastErr.message}`);
}

export function decodeTransferLogs(receipt, token = FJ) {
  const out = [];
  for (const log of receipt.logs || []) {
    if ((log.address || '').toLowerCase() !== token.toLowerCase()) continue;
    if ((log.topics?.[0] || '').toLowerCase() !== TRANSFER_TOPIC) continue;
    if (!log.topics[1] || !log.topics[2]) continue;
    out.push({
      from: '0x' + log.topics[1].slice(26),
      to: '0x' + log.topics[2].slice(26),
      value: BigInt(log.data).toString(),
      logIndex: parseInt(log.logIndex, 16),
    });
  }
  return out;
}

/** sqrtPriceX96 -> WBNB per FJ (token1 per token0). */
export function priceFromSqrtX96(sqrtPriceX96) {
  const Q96 = 1n << 96n;
  const num = sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n;
  const den = Q96 * Q96;
  return Number((num * 10n ** 12n) / den) / 1e30;
}

export async function slot0At(pool, blockNumber) {
  const endpoints = ARCHIVE_RPC ? [ARCHIVE_RPC, ...RPC_ENDPOINTS] : RPC_ENDPOINTS;
  const data = await rpc(
    'eth_call',
    [{ to: pool, data: SLOT0_SELECTOR }, hex(blockNumber)],
    endpoints,
  );
  const sqrtPriceX96 = BigInt('0x' + data.slice(2, 66));
  return { sqrtPriceX96, price: priceFromSqrtX96(sqrtPriceX96) };
}

export async function erc20BalanceAt(token, holder, blockNumber) {
  const data = BALANCEOF_SELECTOR + '0'.repeat(24) + holder.slice(2).toLowerCase();
  const raw = await rpc('eth_call', [{ to: token, data }, hex(blockNumber)]);
  return BigInt(raw);
}

export async function bnbBalanceAt(address, blockNumber) {
  return BigInt(await rpc('eth_getBalance', [address, hex(blockNumber)]));
}

/** Fetch everything needed to verify one buyback tx. */
export async function collect(txHash, opts = {}) {
  const pool = opts.pool || POOL;
  const treasury = opts.treasury || TREASURY;
  const token = opts.token || FJ;

  const [tx, receipt] = await Promise.all([
    rpc('eth_getTransactionByHash', [txHash]),
    rpc('eth_getTransactionReceipt', [txHash]),
  ]);
  if (!tx) throw new Error(`transaction not found: ${txHash}`);
  if (!receipt) throw new Error(`receipt not found: ${txHash}`);

  const blockNumber = Number(receipt.blockNumber);
  const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
  const transfers = decodeTransferLogs(receipt, token);

  const from = (tx.from || '').toLowerCase();
  const to = (tx.to || '').toLowerCase();
  const valueWei = BigInt(tx.value || '0');

  const fjOut = transfers
    .filter((t) => t.from.toLowerCase() === pool.toLowerCase() && t.to.toLowerCase() === treasury.toLowerCase())
    .reduce((acc, t) => acc + BigInt(t.value), 0n);

  const fjIntoTreasury = transfers
    .filter((t) => t.to.toLowerCase() === treasury.toLowerCase() && t.from.toLowerCase() !== pool.toLowerCase())
    .reduce((acc, t) => acc + BigInt(t.value), 0n);

  let slot0 = null;
  let impactPct = null;
  let slot0Error = null;
  try {
    const before = await slot0At(pool, blockNumber - 1);
    const at = await slot0At(pool, blockNumber);
    impactPct = ((at.price - before.price) / before.price) * 100;
    slot0 = { before: before.sqrtPriceX96.toString(), at: at.sqrtPriceX96.toString(), pBefore: before.price, pAt: at.price };
  } catch (e) {
    slot0Error = e.message;
    slot0 = { error: e.message };
  }

  return {
    tx: txHash,
    chainId: CHAIN_ID,
    block: blockNumber,
    timestamp: block ? new Date(Number(BigInt(block.timestamp)) * 1000).toISOString() : null,
    status: receipt.status === '0x1' ? 'success' : 'reverted',
    from,
    to,
    valueWei: valueWei.toString(),
    bnbIn: Number(valueWei) / 1e18,
    fjOut: fjOut.toString(),
    fjOutFormatted: Number(fjOut) / 1e18,
    fjIntoTreasury: fjIntoTreasury.toString(),
    transfers,
    slot0,
    slot0Error,
    impactPct,
    gasUsed: BigInt(receipt.gasUsed).toString(),
    gasPriceWei: BigInt(receipt.effectiveGasPrice || '0x0').toString(),
    feeWei: (BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice || '0x0')).toString(),
  };
}

const REL_TOL = 0.02; // 2% relative tolerance on the impact percentage

function cmp(label, expected, actual, tol = null) {
  if (expected === undefined || expected === null || expected === '') {
    return { label, expected: expected ?? null, actual, verdict: 'SKIP', note: 'not present in receipt' };
  }
  if (actual === undefined || actual === null) {
    return { label, expected, actual: null, verdict: 'FAIL', note: 'missing on chain' };
  }
  let pass;
  if (tol !== null && typeof expected === 'number' && typeof actual === 'number') {
    const scale = Math.max(Math.abs(expected), 1e-12);
    pass = Math.abs(actual - expected) / scale <= tol;
  } else {
    pass = String(expected).toLowerCase() === String(actual).toLowerCase();
  }
  return { label, expected, actual, verdict: pass ? 'PASS' : 'FAIL', note: pass ? '' : 'mismatch' };
}

/** Parse a decimal token amount ("23669235.465921230581203552") to wei without float math. */
export function decimalToWei(value, decimals = 18) {
  const s = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid decimal amount: ${value}`);
  const [whole, frac = ''] = s.split('.');
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

/**
 * Compare a receipt JSON against collected chain data.
 * Receipt schema: { date, tx, bnbIn, fjOut, impactPct, pool, treasury, token }
 */
export function compareReceipt(receipt, chain) {
  const checks = [];
  checks.push(cmp('tx status', 'success', chain.status));
  if (receipt.block !== undefined) checks.push(cmp('block', receipt.block, chain.block));
  if (receipt.bnbIn !== undefined) checks.push(cmp('BNB in', Number(receipt.bnbIn), chain.bnbIn));
  if (receipt.fjOut !== undefined) {
    // accept either the exact wei string or a decimal FLAPJAX amount
    const expected = String(receipt.fjOut).includes('.')
      ? decimalToWei(receipt.fjOut).toString()
      : String(receipt.fjOut);
    checks.push(cmp('FJ out', expected, chain.fjOut));
  }
  if (receipt.impactPct !== undefined) {
    if (chain.impactPct === null || chain.impactPct === undefined) {
      checks.push({
        label: 'slot0 impact %',
        expected: Number(receipt.impactPct),
        actual: null,
        verdict: 'SKIP',
        note: 'archive RPC required — set BSC_ARCHIVE_RPC',
      });
    } else {
      checks.push(cmp('slot0 impact %', Number(receipt.impactPct), chain.impactPct, REL_TOL));
    }
  }
  if (receipt.pool !== undefined) checks.push(cmp('pool', receipt.pool, POOL));
  if (receipt.treasury !== undefined) checks.push(cmp('treasury', receipt.treasury, TREASURY));

  const failed = checks.filter((c) => c.verdict === 'FAIL').length;
  return {
    checks,
    failed,
    verdict: failed === 0 ? 'PASS' : 'FAIL',
  };
}

export function formatTable(rows) {
  const cols = Math.max(...rows.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.max(...rows.map((r) => String(r[i] ?? '').length)),
  );
  return rows
    .map((r) => r.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ').trimEnd())
    .join('\n');
}
