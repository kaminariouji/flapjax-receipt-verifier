# flapjax-receipt-verifier

A dependency-free CLI that checks a FlapJax buyback receipt against BNB Smart Chain, field by field, and prints `PASS` / `FAIL` for each one.

FlapJax's rule is *if it costs something, show the receipt*. This tool is the other half of that rule: **if you show a receipt, anyone can re-check it**.

```text
$ node verify.mjs 0x172349c6... --receipt receipts/2026-10-14.json

block          127643212
status         success
BNB in         0.01
FJ out (wei)   23691113109537150143912753
impact %       0.3025

field           verdict  expected -> actual
tx status       PASS     success -> success
block           PASS     127643212 -> 127643212
BNB in          PASS     0.01 -> 0.01
FJ out          PASS     23691113109537150143912753 -> 23691113109537150143912753
slot0 impact %  PASS     0.3025 -> 0.3025
pool            PASS     0xcA93EC... -> 0xca93ec...
treasury        PASS     0x7C34E9... -> 0x7c34e9...

VERDICT: PASS
```

## Why

Buyback receipts are posted in public channels. A reader can open the transaction, but decoding a PancakeSwap V3 buy by hand — BNB in, exact FLAPJAX out, pool, slot0 before and at the buy — is slow and easy to get wrong. This tool does that decode and tells you which fields match and which do not.

It never signs, never moves funds, and reads only public RPC endpoints.

## Usage

```bash
# print the chain facts for a buyback transaction
node verify.mjs <txHash>

# compare a receipt JSON against the chain
node verify.mjs <txHash> --receipt receipts/2026-10-14.json

# machine-readable
node verify.mjs <txHash> --receipt receipts/2026-10-14.json --json

# run both bundled samples
node verify.mjs --demo

# assert the bundled samples against known values
node selftest.mjs
```

Exit codes: `0` all checked fields pass, `1` at least one field fails, `2` error.

## Receipt format

```json
{
  "date": "2026-10-14",
  "tx": "0x172349c64ed3c45663650049f9e2ad3d763b1243c5c849b7d66f144f221d3186",
  "block": 127643212,
  "pool": "0xcA93EC685b8623688E6B236f9068034B298c2150",
  "treasury": "0x7C34E9e21eE28A49Ff0b84B61774119E6633359f",
  "bnbIn": 0.01,
  "fjOut": "23691113109537150143912753",
  "impactPct": 0.3025
}
```

Every field except `date` and `tx` is optional. Missing fields are reported as `SKIP`, not `PASS` — the tool never invents a check it did not run.

`fjOut` accepts either the exact wei string or a decimal FLAPJAX amount. Amounts are compared exactly; `impactPct` is compared with a 2% relative tolerance.

## What is checked

| Field | Source |
|---|---|
| tx status | `eth_getTransactionReceipt` |
| block, timestamp | receipt + block |
| BNB in | `tx.value` |
| FJ out | FLAPJAX `Transfer` logs from the pool to the treasury |
| pool, treasury | addresses in the receipt |
| slot0 impact | pool `slot0()` at `block - 1` and at `block` |

## Archive RPC

Reading `slot0` at a past block needs an **archive** node. Public BSC endpoints answer `missing trie node`, so the impact check is skipped unless you point the tool at an archive endpoint:

```bash
BSC_ARCHIVE_RPC="https://your-archive-endpoint" node verify.mjs <txHash> --receipt <file>
```

Amounts, status and block never need an archive node.

## Limits

- It verifies one buyback transaction. It does not scan a date range, and it does not prove that no other transfers happened in a window.
- It does not price FLAPJAX in dollars and gives no trading signal.
- Public RPC endpoints rate-limit. The tool retries across five endpoints and gives up cleanly rather than returning a wrong number.
- It is read-only. There is no key, no signature, and no transaction.

## Files

- `lib.mjs` — RPC, log decoding, slot0 math, comparison.
- `verify.mjs` — CLI.
- `selftest.mjs` — asserts two audited buybacks (2026-10-13, 2026-10-14).
- `receipts/` — sample receipts.

## License

MIT. The token contract and treasury addresses are public chain data; nothing here is official FlapJax software.
