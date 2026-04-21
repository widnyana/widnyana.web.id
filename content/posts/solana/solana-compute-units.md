---
title: 'Solana Compute Units: What You Pay to Run Code'
date: 2026-04-21T10:00:00+07:00
description: "A practical guide to Solana compute units (CU): understanding the 200K per-instruction and 1.4M per-transaction budgets, why operations cost different amounts, measuring CU usage with anchor test and simulateTransaction, and applying optimization patterns to write efficient Anchor programs."
params:
  author: 'widnyana'
tags: ["solana", "blockchain", "web3", "compute-units", "optimization", "anchor"]
categories: ["solana", "blockchain"]
keywords: ["solana compute units", "compute unit budget", "solana optimization", "anchor optimization", "solana priority fees", "compute unit profiling", "transaction efficiency"]
series: ["Solana Program Lifecycle"]
cover:
  image: "/images/solana-compute-units.png"
---

This is Part 2 of the [Solana Program Lifecycle](/series/solana-program-lifecycle/) series. In Part 1 we covered how accounts work. Now comes the thing that will break our code if we ignore it: compute units.

We ship a program to devnet, everything works. Then mainnet hits us with a transaction that costs 300K compute units when we only allocated 200K. It fails silently. Our users lose SOL on fees. We have no idea why.

This post is about not having that happen.

---

### The problem: Our transaction costs more than we think

Solana transactions don't fail gracefully when they run out of compute. They just die. We lose the fees. No refund. No warning.

The problem: most developers guess at their compute costs instead of measuring them. "Oh, a CPI is probably fine, I can fit 10 of them." Then we profile and realize 10 CPIs alone burn 250,000 compute units out of our 1.4M budget. Add some signature verification, a few account loads, a bit of deserialization, and suddenly we're over budget.

The second problem: we don't know which parts of our code are expensive until we measure. A signature verification is 25,000 CU. A simple arithmetic operation is 1 CU. The difference is 25,000x. If we're not profiling, we're flying blind.

This post teaches us to see our actual costs. And once we see them, optimization becomes obvious.

---

### What is a compute unit (CU)?

A compute unit is a meter on a transaction. Every operation costs some amount. When we run out, the transaction fails.

**The budgets:**

| What | Budget | Notes |
|---|---|---|
| Per instruction | 200,000 CU | Default allocation. Some system instructions get less. |
| Per transaction | 1,400,000 CU | Total across all instructions. If our code is cheap, we can request less. |
| Account limit | 64 accounts per transaction | Originally 32; raised to 64 in 2023. Each account we touch costs ~100-200 CU just to load. |

Think of it like gas on Ethereum — a meter on every operation. Ethereum provides a cost estimate before submission; Solana does not show that estimate by default, so we measure our CU cost ourselves or risk a silent failure.

---

### Why different operations cost wildly different amounts

Not all code is equal. Some operations are 1 CU. Others are 25,000 CU. The runtime charges based on how hard each operation actually is.

**Cheap (1-10 CU):**
- Arithmetic (addition, multiplication)
- Memory reads/writes
- Comparisons

**Medium (100-2,500 CU):**
- Hashing (SHA-256, Keccak-256): ~2,500 CU per hash
- Account loads and data access

**Expensive (10,000+ CU):**
- secp256k1 signature verification: ~20,000 CU per signature
- Ed25519 signature verification: ~25,000 CU per signature
- Borsh deserialization of large structs
- Cross-program invocations (CPI): ~25,000 CU per call, plus whatever the other program costs

Here's the shocker: a single CPI to another program can cost 25,000 CU. If we have 10 of them in one transaction, that's 250,000 CU before we do any meaningful work. Stack a signature verification on top and we're at 270,000+ CU before touching any business logic.

**Example: What a transfer costs**

A simple transfer to the System Program:
```
Instruction overhead:        200-500 CU
Load 3 accounts:             ~500 CU
Build the instruction:       ~100 CU
CPI invoke itself:           ~25,000 CU
System Program processes it: ~200 CU
─────────────────────────────────────
Total:                       ~26,000 CU
```

A simple transfer fits comfortably. But add one signature verification (+20,000 CU) and we're at 46,000 CU. Add a 10KB Borsh deserialization (+2,000 CU) and another CPI (+25,000 CU), and we're at 93,000 CU. Still under 200K, but the compounding is clear.

---

### Measure it, don't guess

Before we optimize anything, we need to see the actual numbers. Guessing wastes time.

**Using cargo test-sbf**

`cargo test-sbf` (called internally by `anchor test`) compiles and runs our program against a local `BanksClient`. When the test runs, the program logs show exactly how many CU were consumed:

```bash
cargo test-sbf
```

The output includes a line per instruction:

```
Program <id> invoke [1]
Program log: ...
Program <id> consumed 45,231 of 200,000 compute units
Program <id> success
```

That's real data from our actual code. We can also use the `simulateTransaction` RPC method (exposed as `solana confirm -v` in the CLI) to get a CU estimate for a transaction against a live cluster before we commit to submitting it.

**A real Anchor test example:**

```rust
#[tokio::test]
async fn test_my_instruction_cu_usage() {
    let program_test = ProgramTest::new(
        "my_program",
        id(),
        processor!(process_instruction),
    );
    let mut ctx = program_test.start_with_context().await;

    // Set up accounts and instruction...
    let tx = Transaction::new_signed_with_payer(
        &[your_instruction],
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer],
        ctx.last_blockhash,
    );

    // Run it. The program logs print CU consumed.
    ctx.banks_client
        .process_transaction(tx)
        .await
        .expect("Transaction failed");
}
```

Run this and watch the output. We'll see something like:

```
Program <id> consumed 78,432 of 200,000 compute units
```

That 78,432 is our actual number. Not a guess, not a calculation. Real measurement.

---

### The optimization patterns (and where they actually help)

Once we can measure, we can optimize. Here are the patterns that actually matter.

#### Pattern 1: Minimize CPIs (the biggest win)

Each cross-program invoke costs ~25,000 CU plus whatever the target program burns. If we have 10 of them, we're already at 250,000 CU before touching our business logic.

**The trap:**
```rust
// 10 transfers = 10 * 25,000 CU = 250,000 CU+ for nothing
for user in users {
    invoke(&transfer_instruction, &[...])?;
}
```

**The fix:**
If the target program supports batching, use it. If it doesn't, move the loop outside the transaction and do multiple transactions instead.

This is the single biggest win. We've seen programs cut CU usage by 60% just by eliminating unnecessary CPIs.

#### Pattern 2: Don't deserialize what we don't need

Deserializing a 10KB Borsh struct takes CU. But if we only need bytes 64-72, deserializing the whole thing is wasteful.

```rust
// Bad: deserialize entire struct
let full_state: MyState = MyState::try_from_slice(&account.data)?;
let field_i_need = full_state.specific_field;

// Better: read just what we need
let bytes = &account.data[64..72];  // 8 bytes for a u64
let field_i_need = u64::from_le_bytes(bytes.try_into()?);
```

This only makes sense if profiling shows deserialization is our bottleneck. Most of the time it isn't. Use it as a last resort when we're 200 CU over budget.

#### Pattern 3: Stop including accounts we don't use

We get 64 accounts per transaction. Each one costs ~100-200 CU just to load. If an account isn't touched, don't include it.

**The waste:**
```rust
#[derive(Accounts)]
pub struct MyInstruction<'info> {
    pub signer: Signer<'info>,
    pub state: Account<'info, State>,
    pub unused1: UncheckedAccount<'info>,
    pub unused2: UncheckedAccount<'info>,
    // ... 20 more accounts we don't touch
}
```

Those 22 unused accounts? ~2,200-4,400 CU wasted before we write a single line of logic.

**The fix:**
```rust
#[derive(Accounts)]
pub struct MyInstruction<'info> {
    pub signer: Signer<'info>,
    pub state: Account<'info, State>,
}
```

Include only what we actually read or write.

#### Pattern 4: Don't verify 10 signatures in one instruction

secp256k1 verification is ~20,000 CU per signature. If we need to verify 10 signatures, that's 200,000 CU just for verification. We're approaching our budget before doing any work.

**If we need multiple signatures:**
- Verify them offline and only validate the result on-chain
- Use a multisig program that batches verification
- Split into multiple transactions

This is a hard limit, not a pattern. If our use case needs 10 signature verifications in one instruction, we're fighting the architecture.

---

### Priority fees: paying to jump the queue

When mainnet is busy, transactions wait. We can pay a priority fee to cut in line. The more we pay per CU, the higher our priority.

> `set_compute_unit_price` takes **micro-lamports** per compute unit. 1 lamport = 1,000,000 micro-lamports.

```rust
use solana_sdk::compute_budget::ComputeBudgetInstruction;

// Request 50,000 CU (instead of default 200K)
// Pay 1,000 micro-lamports per CU as priority fee
let mut instructions = vec![
    ComputeBudgetInstruction::set_compute_unit_limit(50_000),
    ComputeBudgetInstruction::set_compute_unit_price(1_000),
];
instructions.push(your_instruction);

// Total priority fee: 50,000 * 1,000 micro-lamports = 50,000,000 micro-lamports = 50,000 lamports = 0.00005 SOL
```

**When to use it:**
- During congestion, if our transaction keeps timing out
- Time-sensitive operations: MEV (reordering trades for profit), liquidations (close risky loans fast), arbitrage (exploit price differences before markets close)
- Load testing mainnet pressure

**On devnet/testnet:**
```rust
ComputeBudgetInstruction::set_compute_unit_price(0)  // Free
```

---

### The transaction budget: when we need to split

We get 1.4M CU total per transaction. If we're chaining multiple instructions, we need to know each one's cost.

**Example: Safe transaction**
```
Instruction 1: 45,000 CU
Instruction 2: 60,000 CU
Instruction 3: 35,000 CU
Total: 140,000 CU < 1,400,000 CU ✓
```

**Example: Over budget**
```
Instruction 1: 600,000 CU
Instruction 2: 600,000 CU
Instruction 3: 600,000 CU
Total: 1,800,000 CU > 1,400,000 CU ✗ FAILS
```

If we're approaching 1.4M, split into two transactions. Do it during development, not during a crisis.

---

### The checklist before mainnet

This is what separates code that ships from code that fails in production.

1. **Profile with cargo test-sbf** — measure our actual CU usage. No guessing.
2. **Test the hard case** — max accounts, max data, everything constrained. What does it cost?
3. **Estimate priority fees** — during peak times, what does 1,000 micro-lamports per CU cost in SOL? Can we afford it?
4. **Plan for splits** — if we're close to 1.4M, split into multiple transactions now.
5. **Review hot paths** — functions called frequently should use the optimization patterns above.

**Example checklist output:**
```
test_initialize_state     ... ok (12,500 CU)
test_transfer             ... ok (26,100 CU)
test_complex_update       ... ok (145,000 CU)
test_batch_operation      ... ok (850,000 CU) ← close to 1.4M, will need splits
```

If any test exceeds 1.4M, refactor before shipping.

---

### What surprised us

The biggest shock: most Solana programs have no idea how much CU they actually use. Developers ship to devnet, everything works, then mainnet starts rejecting transactions for "insufficient compute budget" and there's no explanation.

The second shock: CPIs dominate the budget in most programs. We can optimize deserialization and account loading all day and save 10,000 CU. Or we can eliminate one unnecessary CPI and save 25,000. One change, three months of work.

The third thing we learned: the CU numbers in `cargo test-sbf` logs are real. Don't estimate. Profile.

---

### Summary

Compute units are what it costs to run our code on Solana. Here's what matters:

- **Know the budgets**: 200K per instruction, 1.4M per transaction, 64 accounts max.
- **Measure with cargo test-sbf** — get real numbers, not guesses.
- **CPIs are expensive** — ~25K each. Stack them and we blow the budget.
- **Optimize the bottleneck** — use profiling to find where our CU actually goes.
- **Plan for mainnet** — priority fees add up. Budget for them early.
- **Test the hard case** — before shipping, run a test with max constraints and see the real cost.

Next up: [Part 3](/posts/solana-program-lifecycle-part-3/) covers how Solana programs actually live on-chain and the two-account model that makes upgrades possible.
