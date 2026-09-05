---
title: 'Mint Authority and Freeze Authority: The Two Powers Every SPL Token Has'
date: 2026-05-20T10:00:00+07:00
draft: false
description: "Every SPL token has two authority fields in its mint account: mint authority controls who can create new supply, freeze authority controls who can lock any holder's tokens. They get confused constantly. This post covers what each one does, how they interact, and why checking both is the first step in auditing any token."
params:
  author: 'widnyana'
tags: ["solana", "blockchain", "web3", "spl-token", "mint-authority", "freeze-authority", "token-audit"]
categories: ["solana", "blockchain"]
keywords: ["solana mint authority", "solana freeze authority", "spl-token authorize", "spl-token freeze", "solana token renounce", "COption Pubkey", "solana mint account layout"]
series: ["Solana Authorities"]
cover:
  image: "/images/solana/solana-authorities-mint-freeze.png"
---

This is Part 2 of the [Solana Authorities](/series/solana-authorities/) series. In [Part 1](/posts/solana/solana-authorities-pattern/) we covered the authority pattern itself: what authorities are, how they differ from ownership, and what `None` means. Now we go deep on the two authorities every SPL token has.

Disabling the mint authority does not disable the freeze authority. A token with a "renounced" mint can still have every holder locked out of their tokens. These are two independent fields in a single 82-byte account, and checking only one of them is not enough.

---

### Mint authority: who creates supply

The mint authority controls who can call the `MintTo` instruction. When it is `Some(pubkey)`, only that pubkey can create new tokens. When it is `None`, the supply is permanently fixed. No one can mint more, ever.

```bash
# Check the current mint authority
spl-token display <MINT_ADDRESS>

# Transfer mint authority to a new key
spl-token authorize <MINT_ADDRESS> mint <NEW_PUBKEY>

# Permanently disable minting (irreversible)
spl-token authorize <MINT_ADDRESS> mint --disable
```

This is the "renounce" that memecoin launchpads like Pump.fun do automatically. When a token's mint authority is `None`, no one can inflate the supply. Checking mint authority is step one in evaluating any token.

---

### Freeze authority: who can lock your tokens

The freeze authority controls who can call `FreezeAccount` and `ThawAccount` on any token account for this mint. When a token account is frozen, the holder cannot transfer or burn tokens. They can still receive, but they cannot send.

```bash
# Freeze a specific holder's token account
spl-token freeze <TOKEN_ACCOUNT_ADDRESS>

# Thaw (unfreeze) the account
spl-token thaw <TOKEN_ACCOUNT_ADDRESS>

# Transfer freeze authority
spl-token authorize <MINT_ADDRESS> freeze <NEW_PUBKEY>

# Permanently disable freeze capability (irreversible)
spl-token authorize <MINT_ADDRESS> freeze --disable
```

There is no per-account opt-in or consent. If the freeze authority is `Some(pubkey)`, that pubkey can freeze any token account for this mint at any time. The only protection is to check whether the freeze authority has been disabled before buying.

---

### The freeze authority playbook

Freeze authority has both legitimate and illegitimate uses.

**Legitimate uses:**

- **Stablecoin compliance.** Circle (USDC), Tether (USDt), and Paxos (USDP) all have freeze authority enabled on their Solana mints. When a court order or sanctions list requires blocking an address, the issuer freezes that token account.
- **Security tokens.** Regulated tokens use freeze authority to enforce transfer restrictions. Accounts that fail KYC checks get frozen.

**Illegitimate uses:**

- **Rug pulls.** The creator keeps freeze authority enabled, waits for enough buyers, then freezes seller accounts so no one can exit. The creator's own tokens remain unfrozen, and the liquidity pool gets drained.

Detecting this is straightforward: if a token's freeze authority is not `None`, someone can freeze your account. Whether they will is a trust question, not a technical one.

---

### Verifying "renounced" claims

Many token projects claim their authorities are "renounced" or "burned." Verifying takes one command:

```bash
spl-token display <MINT_ADDRESS>
```

Check two things:

1. **Mint Authority** should show `none`. Not a burn address like `1nc1nerator11111111111111111111111111111111`. Not a dead key. The word `none` in the CLI output means the capability is permanently disabled.
2. **Freeze Authority** should show `none`. Same check.

Some projects "renounce" by transferring authority to a burn address (a key whose private key is unknown). This is not the same as disabling. A future vulnerability, key recovery, or quantum computing advance could theoretically allow someone to use that key.

`None` is the only genuinely irreversible state. The program logic itself rejects the instruction before even checking for a signature.

---

### Worked example: mint, freeze, thaw, renounce

A complete walkthrough on devnet.

**Step 1: Create a token with both authorities.**

```bash
spl-token create-token --url devnet
# Token address: <MINT>
# Mint Authority: <YOUR_KEY>
# Freeze Authority: <YOUR_KEY>
```

**Step 2: Create a token account and mint supply.**

```bash
spl-token create-account <MINT> --url devnet
spl-token mint <MINT> 1000 --url devnet
```

**Step 3: Freeze another account.**

```bash
spl-token create-account <MINT> --owner <OTHER_KEY> --url devnet
spl-token transfer <MINT> 100 <OTHER_TOKEN_ACCOUNT> --url devnet
spl-token freeze <OTHER_TOKEN_ACCOUNT> --url devnet
```

The frozen account can still receive but cannot send. If `<OTHER_KEY>` tries to transfer out, it fails with `AccountFrozen`.

**Step 4: Thaw, then renounce both authorities.**

```bash
spl-token thaw <OTHER_TOKEN_ACCOUNT> --url devnet

spl-token authorize <MINT> mint --disable --url devnet
spl-token authorize <MINT> freeze --disable --url devnet
```

**Step 5: Verify.**

```bash
spl-token display <MINT> --url devnet
# Mint Authority: none
# Freeze Authority: none
```

This is the state that "fair launch" tokens aim for: fixed supply, no one can freeze any account.

---

### What catches developers off-guard

**Disabling mint does not disable freeze.** These are independent fields. Many projects advertise "renounced mint" while keeping freeze authority. That still gives them the power to lock holders out.

**Freezing does not prevent receiving.** A frozen account can still receive tokens. A malicious freeze authority can lock your tokens and then send you more tokens you also cannot move.

**You cannot re-enable a disabled authority.** Once `--disable` writes zeros to the discriminant, there is no instruction in the Token Program to reverse it. The only way to "get back" a renounced authority is to deploy a new mint and migrate everyone.

---

### Under the hood: Mint account layout

This section is for when you need to decode raw account data. Most readers can skip it.

A Mint account is 82 bytes, owned by the Token Program (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`).

```rust
pub struct Mint {
    pub mint_authority: COption<Pubkey>,  // 36 bytes
    pub supply: u64,                       // 8 bytes
    pub decimals: u8,                      // 1 byte
    pub is_initialized: bool,              // 1 byte
    pub freeze_authority: COption<Pubkey>, // 36 bytes
}
```

The byte layout:

```
[0..4]    mint_authority discriminant (0=None, 1=Some)
[4..36]   mint_authority pubkey
[36..44]  supply (u64)
[44]      decimals (u8)
[45]      is_initialized (bool)
[46..50]  freeze_authority discriminant (0=None, 1=Some)
[50..82]  freeze_authority pubkey
```

Both authority fields use `COption<Pubkey>`, not the standard Rust `Option<Pubkey>`. `COption` is a custom type that predates Borsh standardization. It uses a 4-byte `u32` discriminant instead of Borsh's 1-byte discriminant.

This matters when you decode raw account data: read 4 bytes for the discriminant, not 1. If you get the size wrong, everything after it decodes as garbage. The Token-2022 program uses the same `COption` for backwards compatibility.

A fully renounced mint will have bytes 0-3 and 46-49 set to `0, 0, 0, 0`, with the pubkey slots zeroed out.

---

### Summary

Every SPL token has two authorities stored in its Mint account:

| Authority | Controls | `None` means |
|-----------|----------|-------------|
| Mint | Who can increase supply | Fixed supply forever |
| Freeze | Who can freeze/thaw token accounts | No one can ever freeze |

Both can be transferred to a new key or permanently disabled. "Renouncing" means setting to `None`, not transferring to a burn address.

When evaluating any token, check both. A disabled mint authority with an active freeze authority is not "fully renounced."

Next: [Part 3 covers Token Account Authorities](/posts/solana/solana-authorities-token-account/), including the close authority and delegate fields that most developers do not know exist.

---

### References

- [SPL Token Source: state.rs (Mint struct)](https://github.com/solana-program/token/blob/main/program/src/state.rs)
- [Tokens on Solana, Solana Docs](https://solana.com/docs/tokens)
- [SPL Token Basics: Set Authority, Solana Docs](https://solana.com/docs/tokens/basics#set-authority)
- [Freeze/Thaw Account, Solana Docs](https://solana.com/docs/tokens/basics#freeze-account)
