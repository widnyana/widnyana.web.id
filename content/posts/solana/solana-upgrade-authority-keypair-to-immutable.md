---
title: 'Upgrade Authority: From Keypair to Immutable'
date: 2026-05-05T10:00:00+07:00
description: "Every upgradeable Solana program has one field that controls who can replace its bytecode: the upgrade_authority_address in the ProgramData account. This post traces the full lifecycle of that field, from a single keypair through Squads multisig and SPL Governance, to the irreversible --final flag that freezes a program forever."
params:
  author: 'widnyana'
tags: ["solana", "blockchain", "web3", "upgrade-authority", "bpf-loader", "program-deployment"]
categories: ["solana", "blockchain"]
keywords: ["solana upgrade authority", "solana program immutable", "solana set-upgrade-authority", "solana program final", "solana squads multisig", "solana governance upgrade", "bpf loader set authority"]
series: ["Solana Program Lifecycle"]
cover:
  image: "/images/solana/solana-upgrade-authority-keypair-to-immutable.png"
---

This is Part 5 of the [Solana Program Lifecycle](/series/solana-program-lifecycle/) series. In [Part 4](/posts/solana/solana-program-deploy-upgrade-buffer/) we walked through the deploy and upgrade flows: the Buffer account, the chunked writes, and the activation step that copies bytecode into the ProgramData account. Every upgrade instruction checks one thing before it proceeds: who is allowed to do this.

That one thing is the `upgrade_authority_address` field: 33 bytes in the ProgramData account that control who can replace the program's bytecode. This post traces the full lifecycle of that field, from the keypair that deployed the program to the irreversible `--final` flag that writes `None` and freezes the program forever.

---

### The upgrade authority field

Recall from Part 3 that the ProgramData account holds the bytecode and some metadata. The layout, serialized with bincode:

```
[0..4]    u32 discriminator = 3 (ProgramData variant)
[4..12]   u64 slot (last deployment/upgrade slot)
[12..13]  u8 option discriminant (0 = None, 1 = Some)
[13..45]  Pubkey upgrade_authority_address (present only if option = 1)
[45..]    raw program bytes (ELF bytecode)
```

Thirty-three bytes control everything. Byte 12 is the option flag. If it is `1`, bytes 13 through 44 hold the authority's public key. If it is `0`, there is no authority. The program is immutable.

The BPF Loader Upgradeable program (`BPFLoaderUpgradeab1e11111111111111111111111`) checks this field before executing these instructions:

- `Upgrade` (discriminator 1): replaces the bytecode. Requires the authority to sign. Rejected if the field is `None`.
- `SetAuthority` (discriminator 4): changes the authority. Requires the current authority to sign. The new authority does not need to sign.
- `SetAuthorityChecked` (discriminator 7): same as `SetAuthority`, but the new authority must also sign.
- `Close` (discriminator 5): closes the ProgramData account and reclaims lamports. Requires the authority to sign. Rejected if the field is `None`.

When byte 12 is `0`, none of these instructions work. There is no valid signer. The program is frozen permanently.

---

### Checking the current authority

The CLI gives you a quick answer:

```bash
solana program show <PROGRAM_ID>
```

Output looks like:

```
Program Id: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

Program Data Address: 5UUJQbPM6X7m2cawNGm8F95Z3LeLRBCE4F8xBrfTDdaF

Authority: Ds3Z9QxexjxtkWvhLnbmGzAuyxZrhk8VmN8cc8P2R5eS

Last Deployed In Slot: 284531193
```

The `Authority` line shows the current upgrade authority. If the program is immutable, it reads:

```
Authority: none
```

For mainnet, add the cluster flag:

```bash
solana program show <PROGRAM_ID> --url mainnet-beta
```

To list all your programs and their authorities:

```bash
solana program show --programs
```

Programmatic check. Derive the ProgramData address from the program ID, then read the account data:

```rust
use solana_sdk::pubkey::Pubkey;
use solana_sdk::bpf_loader_upgradeable;

let (program_data_address, _) = Pubkey::find_program_address(
    &[program_id.as_ref()],
    &bpf_loader_upgradeable::id(),
);

// Fetch the account, then read bytes [12..45]
// Byte 12:  0 = None (immutable), 1 = Some
// Bytes 13-44: the authority pubkey (when byte 12 == 1)
```

The derivation is deterministic: same program ID always maps to the same ProgramData address. You can verify locally without hitting the network.

---

### Transferring upgrade authority

The basic transfer uses `SetAuthority`:

```bash
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <NEW_PUBKEY>
```

Under the hood, this builds an instruction with discriminator byte `4`. The current authority signs. The new authority is an account reference in the instruction, but does NOT need to sign.

That last sentence is the risk. A typo in the address sends the authority to a random public key that nobody controls. The program is not immutable, but nobody can upgrade it either. Functionally equivalent to burning the authority, except the ProgramData still shows `Some(wrong_address)` instead of `None`.

The safer variant is `SetAuthorityChecked` (discriminator byte `7`):

```bash
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <NEW_PUBKEY> \
  --new-upgrade-authority-signer <PATH_TO_KEYPAIR>
```

Here the new authority also signs. This proves the new authority key actually has a corresponding private key. If you fat-finger the address, the instruction fails because the wrong keypair cannot produce a valid signature.

Always prefer `SetAuthorityChecked` when transferring to a keypair. When transferring to a PDA (multisig, governance), `SetAuthority` is the only option because PDAs have no private key to sign with.

You can transfer to any valid pubkey: another keypair, a Squads multisig PDA, a governance PDA, or even `11111111111111111111111111111111` (the System Program, which has no private key, effectively burning the authority without going fully immutable).

---

### The progression pattern

Most serious projects follow a maturity path for their upgrade authority. Each transition narrows who can act: from one person, to M-of-N members, to token-weighted voters, to nobody. Each transition is one-way in practice.

---

#### Stage 1: Keypair (development)

The deployer's keypair holds the authority. This is the default after `solana program deploy`. Fast iteration. One command to push a new build:

```bash
solana program deploy ./target/deploy/program.so --program-id <KEYPAIR>
```

Single point of failure. If the keypair is compromised, an attacker can replace the program bytecode with anything. There is no delay, no approval process, no rollback.

Appropriate for devnet and early testnet. Not appropriate for anything handling real value on mainnet.

---

#### Stage 2: Multisig (production launch)

Transfer the authority to a Squads multisig PDA. The multisig enforces an M-of-N approval threshold before any instruction can be executed as the authority.

The setup flow:

1. Create a Squad through the [Squads UI](https://app.squads.so) or SDK
2. Configure members and threshold (for example, 3-of-5)
3. Get the Squad's PDA address
4. Transfer the upgrade authority:

```bash
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <SQUAD_PDA_ADDRESS>
```

The full upgrade workflow under multisig control is covered in [the end-to-end section below](#the-upgrade-workflow-with-squads-end-to-end).

What you lose: speed. Upgrades require quorum. One person cannot push a fix at 3 AM without getting enough members online to meet the threshold. Emergency response is slower.

What you gain: no single key compromise can replace the program. An attacker needs to compromise M out of N members simultaneously.

---

#### Stage 3: Governance (decentralization)

Transfer the authority to an SPL Governance PDA tied to a Realm. Token-weighted voting determines whether upgrades happen.

The setup flow:

1. Create a Realm with a community token mint using [Realms](https://app.realms.today/)
2. Create a ProgramGovernance account for the program (current upgrade authority must sign)
3. The Governance PDA becomes the upgrade authority
4. To upgrade: create a proposal, token holders vote, if the vote passes there is a timelock period, then execute

What you lose: team control. The community decides. Execution is slower because voting periods and timelocks are built into the governance config. A typical setup might require a 3-day voting period plus a 1-day timelock before execution.

Token distribution matters. If one entity holds 51% of governance tokens, the system is effectively centralized with extra steps. The governance is only as decentralized as the token distribution.

What you gain: public deliberation. Every upgrade proposal is visible onchain. Token holders can vote against changes they disagree with. The team cannot ship a surprise upgrade.

---

#### Stage 4: Immutable (final)

```bash
solana program set-upgrade-authority <PROGRAM_ID> --final
```

This maps to `SetAuthority` with no new authority account. The loader writes `0` into byte 12 of the ProgramData account. The 32 bytes that held the authority pubkey are zeroed out.

Not reversible. No instruction can set the authority back. The `SetAuthority` instruction requires the current authority to sign. When the field is `None`, there is no valid signer. The loader rejects the instruction.

What you lose: all upgrade capability. Bug fixes are impossible. If a critical vulnerability is discovered after going immutable, there is no recovery path through the original program ID. The only option is to deploy a new program at a new address and migrate all users.

What you gain: absolute trust guarantees. Users can verify that the bytecode will never change. No key compromise, no governance vote, no multisig approval can alter the program. The code onchain is the code that runs, permanently.

---

### The progression summary

| Transition | What you lose |
|---|---|
| Keypair to Multisig | Speed. Upgrades require quorum. |
| Multisig to Governance | Team control. Community decides. Slower execution. |
| Governance to Immutable | All upgrade capability. No bug fixes. Forever. |

---

### When to make each transition

**Keypair to Multisig**: at mainnet launch, or earlier. The moment user funds are at risk, single-key authority is negligence. Set up the multisig before mainnet deployment, not after.

**Multisig to Governance**: when the protocol is stable, audited, and the community should have a say in upgrades. If the core functionality is still changing frequently, governance adds latency without adding value.

**Governance to Immutable**: after audits, battle-testing, and a period of governance-controlled upgrades with no incidents. Foundational infrastructure (token programs, system programs) belongs here. Anything that users should trust unconditionally.

Do not skip stages. Going straight to immutable means you cannot fix bugs. Going straight to governance means token holders vote on emergency patches, which is too slow for incident response. The progression should match the protocol's maturity.

---

### Real mainnet examples

**Squads multisig**: most mainnet DeFi programs that are still upgradeable use Squads or a similar multisig. The authority is a PDA that requires quorum approval. Teams retain control but distribute it across multiple signers.

**SPL Governance**: [Marinade Finance](https://docs.marinade.finance/) uses SPL Governance for program upgrades. Token holders vote on upgrade proposals. The team cannot push changes unilaterally.

**Immutable programs**: the [Token Program](https://solana.com/docs/core/tokens) (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) and the [Associated Token Account Program](https://solana.com/docs/tokens#associated-token-account) (`ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`) are frozen. Their upgrade authority is `None`. These are foundational infrastructure. If they had a working authority key, every token on Solana would depend on the security of that one key.

---

### The upgrade workflow with Squads (end to end)

For a team using Squads, the full upgrade cycle looks like this:

```bash
# 1. Build the new version locally
anchor build

# 2. Write the compiled bytecode to a buffer account
solana program write-buffer ./target/deploy/program.so
# Output: Buffer: <BUFFER_ADDRESS>

# 3. Transfer buffer authority to the Squad PDA
# Without this, the multisig cannot use the buffer
solana program set-buffer-authority <BUFFER_ADDRESS> \
  --new-buffer-authority <SQUAD_PDA>

# 4. Get the buffer hash for verification
solana-verify get-buffer-hash <BUFFER_ADDRESS>
# Share this hash with all multisig members

# 5. Propose the upgrade in Squads
# The proposal contains a loader-v3 Upgrade instruction:
#   - ProgramData account (writable)
#   - Program account
#   - Buffer account (writable)
#   - Spill account (receives leftover lamports)
#   - Rent sysvar
#   - Clock sysvar
#   - Authority = Squad PDA (signs via CPI)

# 6. Members verify the buffer hash matches their local build
# anchor build && solana-verify get-executable-hash ./target/deploy/program.so
# If the hashes match, approve.

# 7. Once threshold is met, execute the proposal
# Squads CPIs into BPF Loader's Upgrade instruction
# The buffer is drained and truncated. Program bytecode is replaced.
# New version is live in the next slot.
```

Step 3 is the one people forget. If you do not transfer the buffer authority to the Squad PDA before proposing, the upgrade instruction fails because the buffer's authority (your deployer wallet) does not match the program's authority (the Squad PDA). The loader checks both and rejects mismatches.

---

### What catches developers off guard

**Transferring to a wrong address is catastrophic with `SetAuthority`.** The new address does not sign. There is no validation that anyone holds the private key. A single character typo in the pubkey means the authority is gone. Always use `SetAuthorityChecked` when the new authority is a keypair.

**You cannot undo `--final`.** There is no recovery. There is no admin override. There is no "I made a mistake" instruction. The `SetAuthority` instruction requires the current authority to sign. When the current authority is `None`, there is no valid signer and the instruction is rejected. This is by design.

**A multisig or governance PDA has no private key.** The only way to act as the authority is through the program's approval process. For Squads, that means meeting the threshold. For SPL Governance, that means passing a vote and waiting through the timelock. You cannot extract a private key from a PDA because there is none.

**Governance token distribution is an attack surface.** A whale who accumulates 51% of governance tokens can push any upgrade proposal through. Token-weighted governance is only as decentralized as the token distribution. If one entity holds a majority, the governance theater adds latency without adding security.

**After `--final`, you also cannot `Close` the program.** The `Close` instruction requires the authority to sign, same as `Upgrade` and `SetAuthority`. When the authority is `None`, the program and its ProgramData account exist forever. The rent SOL locked in the ProgramData account is unrecoverable. For a large program, that can be 2 to 3 SOL.

---

### Tying it together

Put it all in motion. You deploy a program. The deployer's keypair holds the upgrade authority. Byte 12 in the ProgramData Account is `1`, and bytes 13 through 44 hold the keypair's public key. One person can replace the bytecode.

You transfer that authority to a Squads multisig. Now it takes M-of-N approvals to upgrade. You move it to SPL Governance. Now it takes a token-weighted vote. Each step narrows who can act, and each step is hard to reverse.

Then you run `--final`. The loader writes `0` into byte 12. The 32-byte authority field is zeroed out. No instruction can set it back. The program is frozen permanently. No key compromise, no governance vote, no multisig approval can ever change it again.

The progression tends to match how mature the protocol is. Keypair while developing. Multisig at mainnet launch. Governance for decentralization. Immutable for infrastructure that should never change. Do not skip stages.

One thing worth remembering: `SetAuthorityChecked` exists because someone, at some point, fat-fingered a transfer address. A typo in `SetAuthority` is just as permanent as `--final`.

Part 6 covers the full deployment pipeline from local testing through mainnet.

---

### References

- [Solana Program Deployment Docs](https://solana.com/docs/core/programs/program-deployment) - loader-v3 instruction reference and upgrade mechanism
- [solana-sdk/loader-v3-interface instruction.rs](https://github.com/anza-xyz/solana-sdk/blob/HEAD/loader-v3-interface/src/instruction.rs) - instruction discriminators and account layouts
- [Squads Protocol](https://docs.squads.so/) - multisig upgrade workflows and security best practices
- [SPL Governance](https://github.com/solana-labs/solana-program-library/tree/master/governance) - onchain governance for program upgrades
- [solana-verify](https://github.com/Ellipsis-Labs/solana-verifiable-build) - buffer hash verification for verifiable builds
- [SIMD-0432: Loader v3 Reclaim Closed Program](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0432-loader-v3-reclaim-closed-program.md) - close instruction behavior for immutable programs
