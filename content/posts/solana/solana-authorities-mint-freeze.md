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
---

This is Part 2 of the [Solana Authorities](/series/solana-authorities/) series. In [Part 1](/posts/solana/solana-authorities-pattern/) we covered the authority pattern itself: what authorities are, how they differ from ownership, and what `None` means. Now we go deep on the two authorities every SPL token has.

Disabling the mint authority does not disable the freeze authority. A token with a "renounced" mint can still have every holder locked out of their tokens. These are two independent fields in a single 82-byte account, and checking only one of them is not enough.

---

### The Mint account layout

A Mint account is 82 bytes, owned by the Token Program (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`). Here is every field:

```rust
pub struct Mint {
    pub mint_authority: COption<Pubkey>,  // 36 bytes
    pub supply: u64,                       // 8 bytes
    pub decimals: u8,                      // 1 byte
    pub is_initialized: bool,              // 1 byte
    pub freeze_authority: COption<Pubkey>, // 36 bytes
}
// Total: 82 bytes
```

The byte layout:

```
[0..4]    u32 discriminant for mint_authority (0=None, 1=Some)
[4..36]   mint_authority pubkey (present if discriminant = 1)
[36..44]  supply (u64)
[44]      decimals (u8)
[45]      is_initialized (bool)
[46..50]  u32 discriminant for freeze_authority (0=None, 1=Some)
[50..82]  freeze_authority pubkey (present if discriminant = 1)
```

Both authority fields use `COption<Pubkey>`, not the standard Rust `Option<Pubkey>`. `COption` is a custom type from the original SPL Token program that predates Borsh standardization. It uses a 4-byte `u32` discriminant instead of Borsh's 1-byte discriminant. This is a historical artifact, but it matters when you decode raw account data: you need to read 4 bytes for the discriminant, not 1.

If you look at the raw bytes of a mint with no authorities (fully renounced), bytes 0-3 will be `0, 0, 0, 0` and bytes 46-49 will also be `0, 0, 0, 0`. The pubkey slots (4-35 and 50-81) will be zeroed out.

---

### Mint authority: who creates supply

The mint authority controls who can call the `MintTo` instruction on this mint. When `mint_authority` is `Some(pubkey)`, only that pubkey can sign a transaction that creates new tokens. When it is `None`, the supply is permanently fixed. No one can mint more, ever.

```bash
# Check the current mint authority
spl-token display <MINT_ADDRESS>

# Transfer mint authority to a new key
spl-token authorize <MINT_ADDRESS> mint <NEW_PUBKEY>

# Permanently disable minting (irreversible)
spl-token authorize <MINT_ADDRESS> mint --disable
```

When you run `--disable`, the Token Program writes `0, 0, 0, 0` to bytes 0-3 of the mint account, and zeros out bytes 4-35. From that point on, any `MintTo` instruction against this mint will fail with `TokenError::FixedSupply`.

This is the "renounce" that memecoin launchpads like Pump.fun do automatically. When a token's mint authority is `None`, no one can inflate the supply. This is why checking mint authority is step one in evaluating any token.

---

### Freeze authority: who can lock your tokens

The freeze authority controls who can call `FreezeAccount` and `ThawAccount` on any token account associated with this mint. When a token account is frozen, the holder cannot transfer or burn tokens. They can still receive tokens, but they cannot send.

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

When you freeze an account, the Token Program changes the `state` field in the holder's token account from `Initialized` (1) to `Frozen` (2). When you thaw, it changes back to `Initialized` (1). The freeze authority must sign the freeze/thaw transaction.

The freeze authority has no per-account opt-in or consent. If the freeze authority is `Some(pubkey)`, that pubkey can freeze any token account for this mint, at any time, without the holder's permission. The only protection is to check whether the freeze authority has been disabled before buying.

---

### The freeze authority playbook

Freeze authority has both legitimate and illegitimate uses.

**Legitimate uses:**

Stablecoin issuers need freeze authority for regulatory compliance. When a court order or sanctions list requires blocking a specific address, the issuer freezes that token account. Circle (USDC), Tether (USDt), and Paxos (USDP) all have freeze authority enabled on their Solana mints, and their published compliance policies explain when and why they use it.

Regulated security tokens use freeze authority to enforce transfer restrictions. Only KYC-verified holders should be able to trade, so the issuer freezes accounts that fail compliance checks.

**Illegitimate uses:**

Rug-pull memecoins use freeze authority as an exit scam tool. The creator keeps freeze authority enabled, waits for enough buyers, then freezes seller accounts so no one can exit. The creator's own tokens remain unfrozen, and by the time holders realize what happened, the liquidity pool has been drained.

Detecting this is straightforward: if a token's freeze authority is not `None`, someone can freeze your account. Whether they will is a trust question, not a technical one.

---

### How stablecoin issuers actually use freeze authority

Circle's USDC mint on Solana (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) is a useful reference. The freeze authority is held by Circle's operational key. Their published policy states that they freeze accounts in response to law enforcement requests, court orders, and sanctions compliance (OFAC).

Tether's USDt on Solana (`Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`) and Paxos USDP follow the same pattern.

The key point for developers: if you are building a wallet, exchange, or DeFi protocol that handles stablecoins, you should assume freeze authority is active and build your UI to surface frozen states clearly. A frozen token account will fail on any transfer or burn instruction with `TokenError::AccountFrozen`.

---

### Verifying "renounced" claims

Many token projects claim their authorities are "renounced" or "burned." Verifying this takes one command:

```bash
spl-token display <MINT_ADDRESS>
```

Check two things:

1. `Mint Authority` should show `none`. Not a burn address like `1nc1nerator11111111111111111111111111111111`. Not a dead key. `none`. The word `none` in the CLI output means the discriminant bytes are zero and the capability is permanently disabled.

2. `Freeze Authority` should show `none`. Same check.

Some projects "renounce" by transferring authority to a burn address (a key whose private key is unknown). This is not the same as disabling. A future vulnerability, key recovery, or quantum computing advance could theoretically allow someone to use that key. `None` is the only genuinely irreversible state, because the program logic itself rejects the instruction before even checking for a signature.

---

### Worked example: mint, freeze, thaw, renounce

Here is a complete walkthrough on devnet:

```bash
# Create a new token with both authorities
spl-token create-token --url devnet
# Output: Token address: <MINT>
# Mint Authority: <YOUR_KEY>
# Freeze Authority: <YOUR_KEY>

# Create a token account and mint some supply
spl-token create-account <MINT> --url devnet
spl-token mint <MINT> 1000 --url devnet

# Create a second account and freeze it
spl-token create-account <MINT> --owner <OTHER_KEY> --url devnet
spl-token transfer <MINT> 100 <OTHER_TOKEN_ACCOUNT> --url devnet
spl-token freeze <OTHER_TOKEN_ACCOUNT> --url devnet

# The frozen account can still receive but cannot send
spl-token transfer <MINT> 50 <OTHER_TOKEN_ACCOUNT> --url devnet  # succeeds
# If <OTHER_KEY> tries to transfer out, it fails with AccountFrozen

# Thaw the account
spl-token thaw <OTHER_TOKEN_ACCOUNT> --url devnet

# Now renounce both authorities (irreversible)
spl-token authorize <MINT> mint --disable --url devnet
spl-token authorize <MINT> freeze --disable --url devnet

# Verify
spl-token display <MINT> --url devnet
# Mint Authority: none
# Freeze Authority: none
```

After this, the token has a fixed supply and no one can freeze any account. This is the state that "fair launch" tokens aim for.

---

### What catches developers off-guard

**`COption` is not `Option`.** The SPL Token program uses a custom `COption` type with a 4-byte discriminant. Newer programs (and Anchor's default serialization) use Borsh's `Option` with a 1-byte discriminant. If you are decoding raw account data, using the wrong discriminant size will give you garbage results. The Token-2022 program uses the same `COption` for backwards compatibility.

**Freezing does not prevent receiving.** A frozen account can still receive tokens. This means a malicious freeze authority can lock your tokens and then send you more tokens you also cannot move. The account state only blocks outgoing transfers and burns.

**Disabling mint authority does not disable freeze authority.** These are independent fields. A token can have its mint authority disabled (fixed supply) while the freeze authority is still active. Many projects advertise "renounced mint" while keeping freeze authority, which still gives them the power to lock holders out.

**You cannot re-enable a disabled authority.** Once `--disable` writes zeros to the discriminant, there is no instruction in the Token Program to reverse it. The only way to "get back" a renounced authority is to deploy a new mint and migrate everyone.

---

### Summary

Every SPL token has two authorities stored in its 82-byte Mint account:

- **Mint authority**: controls who can increase supply. `None` means fixed supply forever.
- **Freeze authority**: controls who can freeze/thaw any token account for this mint. `None` means no one can ever freeze.

Both use `COption<Pubkey>` with a 4-byte discriminant. Both can be transferred to a new key or permanently disabled. "Renouncing" means setting to `None`, not transferring to a burn address.

When evaluating any token, check both. A disabled mint authority with an active freeze authority is not "fully renounced."

Next: [Part 3 covers Token Account Authorities](/posts/solana/solana-authorities-token-account/), including the close authority and delegate fields that most developers do not know exist.

---

### References

- [SPL Token Source: state.rs (Mint struct)](https://github.com/solana-program/token/blob/main/program/src/state.rs)
- [Tokens on Solana, Solana Docs](https://solana.com/docs/tokens)
- [SPL Token Basics: Set Authority, Solana Docs](https://solana.com/docs/tokens/basics#set-authority)
- [Freeze/Thaw Account, Solana Docs](https://solana.com/docs/tokens/basics#freeze-account)
