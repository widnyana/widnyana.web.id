---
title: 'How Solana Programs Actually Live Onchain: The Two-Account Model'
date: 2026-04-25T10:00:00+07:00
description: "Solana programs aren't stored in a single account. They're split across two linked accounts managed by the BPF Loader: a tiny Program Account that acts as the identity, and a larger ProgramData Account that holds the bytecode. This post breaks down the two-account model, explains why program IDs never change across upgrades, and shows how this architecture makes hot-swappable code possible."
params:
  author: 'widnyana'
tags: ["solana", "blockchain", "web3", "bpf-loader", "program-deployment", "upgrades"]
categories: ["solana", "blockchain"]
keywords: ["solana bpf loader", "solana program account", "solana programdata account", "upgradeable loader state", "solana two account model", "solana program upgrade", "bpf loader upgradeable", "solana executable account"]
series: ["Solana Program Lifecycle"]
cover:
  image: "/images/solana-account-model.svg"
---

This is Part 3 of the [Solana Program Lifecycle](/series/solana-program-lifecycle/) series. In [Part 1](/posts/solana/solana-accounts-storage-rent/) we covered the account model. In [Part 2](/posts/solana/solana-compute-units/) we covered compute units. Now let's look at something most developers never think about until something breaks: how programs actually live onchain.

Because here's the thing: a Solana program isn't one account. It's two. And the relationship between them is what makes upgrades possible without breaking everything that depends on the program.

---

### The surprise: your program is two accounts

When you deploy a program with `solana program deploy`, you get back a program ID. That ID is a Solana address. Most developers assume the bytecode lives at that address. It doesn't.

The program ID points to a tiny **Program Account** that's only 36 bytes. That account contains exactly one useful thing: a pointer to a second account, the **ProgramData Account**, which holds the actual ELF bytecode, the slot number, and the upgrade authority.

```
Program Account (your program ID)
├── discriminator: 4 bytes (u32 = 2, identifies this as "Program" variant)
└── programdata_address: 32 bytes (points to the real bytecode)

ProgramData Account (holds the actual code)
├── discriminator: 4 bytes (u32 = 3, identifies this as "ProgramData" variant)
├── slot: 8 bytes (when the program was last deployed/upgraded)
├── authority option: 1 byte (0 = immutable, 1 = has upgrade authority)
├── upgrade_authority_address: 32 bytes (who can upgrade, if any)
└── ELF bytecode: rest of the account
```

Both accounts are owned by the BPF Loader Upgradeable program at `BPFLoaderUpgradeab1e11111111111111111111111`. Note the `1` replacing the `l` in "Upgradeable." Solana addresses are base58-encoded, and in base58 the character `1` represents a zero byte. The result reads like "Upgradeable" with a typo, but that's just how the encoding landed.

The ProgramData account is derived deterministically from the Program account:

```rust
pub fn get_program_data_address(program_address: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[program_address.as_ref()],
        &id(), // BPFLoaderUpgradeab1e11111111111111111111111
    ).0
}
```

Same program address, same ProgramData address. Every time. This is a PDA derived from the program's own address, owned by the BPF Loader.

---

### Why split it into two accounts?

The split exists for one reason: **upgrades**.

If the program ID and the bytecode lived in the same account, upgrading the bytecode would mean changing the account. But the program ID is referenced by PDAs, client code, configuration files, other programs' CPI calls, token accounts, and governance proposals. Changing it would break everything.

Instead, the Program Account never changes. It's a fixed 36-byte pointer. When you upgrade, only the ProgramData account gets new bytecode. The pointer stays the same. Everything that references the program ID keeps working.

```
Before upgrade:
  Program Account (ID: ABC...123) → ProgramData (slot 200, bytecode v1)

After upgrade:
  Program Account (ID: ABC...123) → ProgramData (slot 450, bytecode v2)
              ^^^ unchanged ^^^           ^^^ new slot, new bytecode ^^^
```

The program ID is the stable identity. The ProgramData account is the swappable implementation.

![The two-account model: Program Account points to ProgramData Account](/images/program-account-expanded.svg)

---

### What "executable" actually means

In Part 1, we saw that every account has an `executable` field. For most accounts, it's `false`. For program accounts, it's `true`. But what does the runtime actually do with this?

When a transaction invokes a program, the runtime checks:

1. Is the account marked `executable: true`?
2. Is the account owned by a loader program (BPF Loader Upgradeable, or the legacy BPF Loader)?

If both are true, the runtime follows the loader's account structure to find the bytecode. For upgradeable programs, that means reading the Program account, getting the `programdata_address`, loading that account, and extracting the ELF bytecode starting at byte offset 45 (the size of the ProgramData header).

The loader then verifies the bytecode (checksums, format validation) and JIT-compiles it for execution. This happens on the first invocation in a slot. The compiled result is cached by the runtime, so repeated calls within the same slot skip compilation.

The key insight: `executable: true` doesn't mean "this account contains runnable code." It means "this account is a program entry point. Follow the loader's structure to find the actual code." The Program Account is the entry point. The ProgramData Account is the code.

---

### The full account layout in bytes

The `UpgradeableLoaderState` enum uses bincode serialization. Here's the exact byte layout.

**Discriminator values:**

| Value | Variant | Meaning |
|-------|---------|---------|
| 0 | `Uninitialized` | Empty account, not yet used |
| 1 | `Buffer` | Temporary account for uploading bytecode |
| 2 | `Program` | The program entry point (36 bytes total) |
| 3 | `ProgramData` | The actual bytecode + metadata |

**Program Account (36 bytes total):**
```
[0..4]   u32 discriminator = 2
[4..36]  Pubkey programdata_address
```

**ProgramData Account (45 bytes header + ELF bytecode):**
```
[0..4]    u32 discriminator = 3
[4..12]   u64 slot
[12..13]  u8 option (0 = None = immutable, 1 = Some = has authority)
[13..45]  Pubkey upgrade_authority_address (present if option = 1)
[45..]    raw ELF bytecode
```

**Buffer Account (37 bytes header + partial bytecode):**
```
[0..4]   u32 discriminator = 1
[4..5]   u8 option (0 = None, 1 = Some)
[5..37]  Pubkey authority_address (present if option = 1)
[37..]   raw program bytes (uploaded in chunks)
```

The Buffer account is the temporary holding area used during deploy and upgrade. More on that in [Part 4](/posts/solana-program-lifecycle-part-4/).

---

### Why the BPF Loader owns your program

Both the Program Account and ProgramData Account have their `owner` field set to `BPFLoaderUpgradeab1e11111111111111111111111`. This isn't a suggestion. The runtime enforces it.

Recall the ownership rules from Part 1: only the owner program can modify an account's data. By owning the Program and ProgramData accounts, the BPF Loader is the only entity that can change the bytecode pointer or the bytecode itself. Your program can't modify its own code. No other program can either.

This is why upgrades go through the BPF Loader's instructions (`Upgrade`, `DeployWithMaxDataLen`, `SetAuthority`). The loader checks the upgrade authority signature before allowing any changes. Without a valid authority signature, nothing happens.

When you make a program immutable (with `solana program deploy --final` or `solana program set-upgrade-authority --final`), the loader sets the `upgrade_authority_address` field to `None` (the option byte at offset 12 becomes 0). Once that happens, the loader rejects all upgrade instructions permanently. No rollback. No undo. The bytecode is frozen.

---

### The runtime cost of the two-account model

In Part 2 we covered compute unit costs. The upgradeable loader has its own CU cost:

```
UPGRADEABLE_LOADER_COMPUTE_UNITS: 2,370 CU
```

This is the base cost the loader charges when processing any instruction (deploy, upgrade, close). The actual cost of loading and executing a program is separate and depends on the bytecode size.

The two-account model also means the runtime loads two accounts for every program invocation: the Program Account (36 bytes, fast) and the ProgramData Account (bytecode size, potentially large). For a typical Anchor program around 300-500KB of bytecode, that's two account loads per invocation. The data transfer cost during CPIs is 1 CU per 250 bytes (`cpi_bytes_per_unit`), so loading a 400KB ProgramData account costs about 1,600 CU just for the data transfer.

This is overhead you don't control. It's the cost of the upgradeable architecture. The trade-off is worth it: you get hot upgrades at the cost of a few thousand CU per invocation.

---

### The legacy loader: BPF Loader v1

Before the upgradeable loader, there were two non-upgradeable loaders:

- **Deprecated loader** (`BPFLoader1111111111111111111111111111111111`): the original. No longer used for new deploys.
- **BPF Loader v2** (`BPFLoader2111111111111111111111111111111111`): still works, but bytecode lives directly in the program account. No pointer, no ProgramData account, no upgrades.

Programs deployed with either of these loaders are immutable by design. You can't upgrade them. If you need to fix a bug, you deploy a new program at a new address and migrate everything. That's painful, which is why the upgradeable loader exists.

New programs should always use the upgradeable loader. `solana program deploy` uses it by default, so this is what you get unless you go out of your way to use the legacy loaders.

---

### Verifying the two-account model onchain

You can see all of this for yourself. Take any program ID and look at its accounts.

```bash
# Check the program account
solana program show <PROGRAM_ID>

# Output:
# Program ID: <PROGRAM_ID>
# Owner: BPFLoaderUpgradeab1e11111111111111111111111
# ProgramData Address: <PROGRAMDATA_ADDRESS>
# Authority: <UPGRADE_AUTHORITY or none>
# Last Deployed In Slot: <SLOT>
```

Or query the raw account data via RPC:

```bash
# Get the program account
solana account <PROGRAM_ID> --output json

# Get the programdata account (the actual bytecode)
solana account <PROGRAMDATA_ADDRESS> --output json
```

The program account will be tiny (36 bytes). The ProgramData account will be much larger, matching the bytecode size plus the 45-byte header.

To verify the ProgramData address derivation:
```typescript
import { getProgramDerivedAddress, address } from "@solana/kit";

const programId = address("<PROGRAM_ID>");
const [programDataAddress] = await getProgramDerivedAddress({
  programAddress: programId,
  programId: address("BPFLoaderUpgradeab1e11111111111111111111111"),
  seeds: [programId],
});
console.log("ProgramData:", programDataAddress);
```

This should match the `ProgramData Address` shown by `solana program show`.

---

### What catches developers off-guard

**The ProgramData account size is fixed at deploy time.** When you deploy with `solana program deploy --max-len 400000`, the ProgramData account is created with space for 400KB of bytecode. If your upgraded bytecode exceeds that, the upgrade fails. You can't grow the account without redeploying from scratch (or using the `ExtendProgram` instruction to add space, which costs SOL for the additional rent-exempt balance).

**Orphaned buffer accounts waste SOL.** If a deploy fails midway, the buffer account stays onchain with SOL locked in it. Use `solana program close --buffers` to reclaim.

**Making a program immutable is permanent.** There's no "unfinalize" command. Once the authority is removed, that program ID is frozen forever. If there's a bug, the only option is deploying a new program at a new address and migrating everything. This is by design. Immutability is a security feature, not a bug.

**The ProgramData account is a PDA, but you don't manage it.** The BPF Loader derives and manages it. You never interact with it directly. All operations go through the loader's instructions.

---

### Summary

A Solana program is two accounts working together:

- **Program Account** (36 bytes): the stable identity. Holds the program ID and a pointer to the ProgramData account. Marked `executable: true`. Never changes across upgrades.
- **ProgramData Account** (45 bytes header + bytecode): the swappable implementation. Holds the ELF bytecode, the deployment slot, and the upgrade authority. This is what gets replaced during upgrades.
- **BPF Loader** owns both accounts and controls all modifications through its instruction set.
- The split exists so the program ID can remain stable while the bytecode gets replaced. This is how Solana does hot upgrades without breaking client integrations, PDA derivations, or cross-program invocations.

Next up: [Part 4](/posts/solana-program-lifecycle-part-4/) covers the full deploy and upgrade flow, including the buffer account pattern and what happens when things fail mid-way.

---

### References

- [BPF Loader Upgradeable, Solana Docs](https://solana.com/docs/core/programs#bpf-loader)
- [UpgradeableLoaderState enum, solana-loader-v3-interface (docs.rs)](https://docs.rs/solana-loader-v3-interface/latest/solana_loader_v3_interface/state/enum.UpgradeableLoaderState.html)
- [Loader Upgradeable Instructions (docs.rs)](https://docs.rs/solana-loader-v3-interface/latest/solana_loader_v3_interface/instruction/index.html)
- [Accounts, Solana Docs](https://solana.com/docs/core/accounts)
