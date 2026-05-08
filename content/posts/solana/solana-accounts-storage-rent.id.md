---
title: 'Akun Solana, Penyimpanan, dan Rent: Bagaimana Solana Mengingat Sesuatu'
date: 2026-04-18T10:00:00+07:00
description: "Panduan mendalam tentang model akun Solana, penyimpanan on-chain dengan serialisasi Borsh, minimum rent-exempt, menutup akun, dan Program Derived Addresses (PDA): fondasi yang perlu dipahami setiap developer Solana."
params:
  author: 'widnyana'
tags: ["solana", "blockchain", "web3", "accounts", "pda", "rent", "borsh", "storage"]
categories: ["solana", "blockchain"]
keywords: ["solana accounts", "model akun solana", "solana rent", "solana rent exempt", "solana PDA", "program derived address", "penyimpanan solana", "serialisasi borsh", "kepemilikan akun solana", "invoke_signed", "menutup akun solana"]
series: ["Solana Program Lifecycle"]
cover:
  image: "/images/solana-accounts-storage-rent.png"
---

Ini Bagian 1 dari seri [Solana Program Lifecycle](/id/series/solana-program-lifecycle/). Kalau kamu baru mulai belajar develop di Solana, mulai dari sini aja. Konsep-konsep di sini bakal muncul terus di semua yang kamu bikin nanti.

---

### 1. Model Akun

Di Solana, semuanya itu akun. Program, data user, token, bahkan state ledger, semuanya disimpen di akun. Nggak ada database engine, nggak ada tabel relasional. Cuma akun doang, tersebar di peta key-value datar di mana setiap key itu alamat 32-byte dan setiap value itu sebuah akun.

Setiap akun di Solana punya field-field ini:

| Field | Isinya |
|---|---|
| `lamports` | Saldo akun dalam lamports (1 SOL = 1 miliar lamports) |
| `data` | Array byte mentah. Di sinilah data kamu beneran disimpen |
| `owner` | Program ID yang ngendalikan akun ini |
| `executable` | `true` kalau akun ini berisi kode program yang bisa dijalanin |
| `rent_epoch` | Field warisan. Nyimpen state rent (detailnya bahas di bawah) |

Buat kamu yang pernah develop di Ethereum, ini bedanya yang paling gede: Solana misahin kode dari data. Sebuah **program akun** nyimpen bytecode yang bisa dieksekusi (mirip contract). Sebuah **data akun** nyimpen state yang dibaca dan ditulis sama program. Itu dua akun yang beda, ya.

Kenapa sih penting? Karena pas transaksi nyentuh data akun yang beda-beda, runtime bisa proses semuanya secara paralel. Nggak ada bottleneck global state tunggal.

---

### 2. Siapa Punya Apa

Setiap akun punya owner (sebuah program ID). Runtime Solana ngejalanin aturan simpel soal siapa yang boleh nyentuh apa:

- Cuma **program owner** yang bisa ubah `data` sebuah akun
- Cuma **program owner** yang bisa kurangi lamports dari akun itu
- Program mana aja bisa **nambah** lamports ke akun mana aja yang writable
- **Owner** itu satu-satunya program yang bisa alihin kepemilikan ke program lain (dan cuma kalau akunnya nggak executable)
- Dua program nggak bisa pinjem akun yang sama buat ditulis bareng-bareng

Pas kamu bikin akun, [System Program](https://solana.com/docs/core/accounts) (`11111111111111111111111111111111`) jadi ownernya. Buat nyerahin ke program kamu, System Program transfer kepemilikannya. Setelah program kamu jadi ownernya, cuma program kamu doang yang bisa tulis ke akun itu.

```
Siklus hidup akun:
1. System Program bikin akun → owner = System Program
2. System Program alihin kepemilikan ke program kamu
3. Program kamu sekarang jadi satu-satunya yang bisa nyentuh data akun ini
```

Buat akun program (yang punya `executable: true`), ownernya itu loader program, biasanya BPF Loader. Itu bahasannya di Bagian 3.

---

### 3. Bagaimana Penyimpanan Bekerja

Data akun itu cuma array byte mentah. Nggak ada schema engine, nggak ada ORM, nggak ada sihir. Program kamu yang mutusin cara pack dan unpack byte-nya.

#### Borsh: Serializer Pilihan Utama

Mayoritas program Solana pakai [Borsh](https://borsh.io/), format serialisasi biner yang ringkas dan deterministik. Contoh struct data:

```rust
use borsh::{BorshSerialize, BorshDeserialize};

#[derive(BorshSerialize, BorshDeserialize)]
pub struct UserProfile {
    pub authority: Pubkey,    // 32 byte
    pub username: String,     // 4 byte (prefix panjang) + byte string aktual
    pub karma: u64,           // 8 byte
    pub is_active: bool,      // 1 byte
}
```

Ngitung ukuran itu penting banget karena kamu harus alokasi byte sejak awal:

```
UserProfile = 32 (Pubkey) + (4 + max_username_len) + 8 + 1
```

Kalau kamu pakai [Anchor](https://www.anchor-lang.com/), tambahin 8 byte buat discriminator yang otomatis ditambahin di awal.

#### Aturan Ukuran

Ukuran data akun maksimal itu **10 MB**. Kamu alokasi ruang pas pembuatan dan nggak bisa dibesarin lagi nanti. Nutup dan bikin ulang itu satu-satunya cara buat ngubah ukuran. Saran gue sih: selalu alokasi lebih gede dari yang kamu butuhin. Nambah beberapa byte sekarang itu jauh lebih murah daripada migrasi data kemudian harinya.

#### Tips Layout

Taruh field berukuran tetap di awal, field berukuran variabel (string, vec) di akhir. Ini bikin semuanya ada di offset yang bisa diprediksi:

```
+-------------------+
| 8 byte: Anchor   |  <- Anchor discriminator (kalau pakai Anchor)
|   discriminator   |
+-------------------+
| Field ukuran tetap |  <- Pubkey, u64, bool, selalu di offset yang diketahui
+-------------------+
| Field ukuran      |  <- String, Vec, taruh di bagian akhir
|   variabel        |
+-------------------+
```

---

### 4. Rent: Membayar untuk Penyimpanan

Nyimpen data di Solana butuh SOL. Jaringan sebutnya **rent**, tapi kerjanya lebih kayak deposit. Kamu bisa klaim balik seluruh saldonya pas nutup akun.

Begini deal-nya: setiap akun harus pegang saldo lamport minimum yang proporsional sama ukuran datanya. Saldo ini bikin data tetap hidup on-chain.

#### Rent-Exempt: Kondisi Normal

Pendekatan praktisnya gampang aja: danai setiap akun dengan cukup lamports buat nutup **dua tahun** rent di muka. Setelah itu, akun jadi **rent-exempt**. Runtime nggak pernah potong apa-apa dari akun itu.

Ini bukan opsional di praktiknya. Setiap akun yang kamu bikin harus rent-exempt sejak hari pertama.

```bash
# CLI: cek minimum rent-exempt buat ukuran data tertentu
solana rent 150
# Output: Rent-exempt minimum: 0.001934880 SOL

# Atau query langsung via RPC
curl https://api.devnet.solana.com -s -X POST \
  -H "Content-Type: application/json" -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getMinimumBalanceForRentExemption",
    "params": [150]
  }'
```

Field `rent_epoch` yang kamu liat di struktur akun? Itu warisan dari zaman dulu waktu rent emang dipotong per epoch. Di praktiknya sekarang, setiap akun baru harus didanai sampai minimum rent-exempt pas pembuatan. Runtime nggak bakal ngizinin kamu bikin akun yang dananya kurang.

#### Menutup Akun

Kalau kamu udah nggak butuh sebuah akun lagi, program kamu bisa nutup itu akun buat klaim balik SOL-nya:

```rust
// Anchor: tutup akun dan klaim balik SOL
pub fn close_account(ctx: Context<CloseAccount>) -> Result<()> {
    let dest = &mut ctx.accounts.destination;
    let source = &mut ctx.accounts.account_to_close;

    // Pindahin semua lamports keluar
    dest.lamports = dest.lamports
        .checked_add(source.lamports)
        .ok_or(ErrorCode::Overflow)?;
    source.lamports = 0;

    // Bersihin datanya
    source.data.zero_fill();

    Ok(())
}
```

Akunnya masih ada di alamatnya, tapi saldo nol dan data kosong. Garbage collection yang ngurus sisanya.

---

### 5. Program Derived Addresses (PDA)

PDA ngasih program buat punya dan ngelola akun **tanpa private key sama sekali**. Ini mungkin bagian Solana yang paling bikin bingung orang, jadi kita bahas pelan-pelan ya.

#### Apa yang Membedakan PDA

Alamat Solana normal itu public key dari [keypair Ed25519](https://solana.com/docs/core/pda). Mereka punya private key yang cocok buat nandatangan transaksi. PDA beda: ini alamat yang sengaja diturunkan supaya **jatuh dari kurva Ed25519**. Nggak ada private key buat PDA. Selamanya.

Bayangin gini aja: PDA itu kayak alamat kotak surat yang cuma satu program tertentu punya kuncinya. Nggak ada manusia, nggak ada program lain, yang bisa nandatangani buat PDA itu.

Kamu nurunin PDA dari dua hal:

- Sebuah **program ID**: program mana yang "punya" alamat ini
- **Seeds**: string byte sembarang yang kamu pilih (misalnya `b"profile"` atau public key user)

```typescript
// TypeScript (web3.js)
const [pdaAddress, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("user_profile"), userPublicKey.toBuffer()],
  programId
);
```

```rust
// Rust
let (pda_address, bump_seed) = Pubkey::find_program_address(
    &[
        b"user_profile",
        user_authority.key.as_ref(),
    ],
    &program_id,
);
```

Proses derivasinya nyoba nilai bump mulai dari 255, hitung mundur, sampai nemu alamat yang ada di luar kurva Ed25519. Byte bump terakhir itulah yang dikembaliin bareng alamatnya.

Yang penting diingat: nurunin PDA itu cuma matematika doang. Itu nggak bikin apa-apa jadi on-chain. Kaya yang dijelasin di [dokumentasi Solana](https://solana.com/docs/core/pda), PDA itu kayak alamat di peta. Karena alamatnya ada bukan berarti ada bangunan di situ. Kamu tetap harus bikin akunnya secara eksplisit.

#### Kenapa PDA Berguna

**Alamat yang bisa diprediksi.** Seeds yang sama + program yang sama = alamat yang sama, kapan aja. Frontend kamu bisa hitung di mana akun berada tanpa nanya ke chain.

**Kontrol cuma oleh program.** Cuma program owner yang bisa nandatangani buat PDA-nya via [`invoke_signed`](https://solana.com/docs/core/cpi). Nggak ada key eksternal yang bisa campur tangan. Ini yang bikin PDA aman. Nggak ada manusia, nggak ada program lain, yang bisa bajak.

**Desain state yang fleksibel.** Kombinasi seed yang beda ngasih alamat yang beda. Satu akun per user? Seeds `[b"profile", user_pubkey]`. Config global? Seeds `[b"config"]`. Petakan state kamu sesuka hati deh.

#### Pola Seed yang Umum

```rust
// Satu akun per user
seeds = [b"profile", user_pubkey]

// Banyak item per user
seeds = [b"item", user_pubkey, item_index.to_le_bytes()]

// Config global tunggal
seeds = [b"config"]
```

#### Menandatangani dengan PDA

Pas program kamu perlu nandatangani transaksi atas nama PDA (misalnya, transfer SOL dari PDA), kamu pakai [`invoke_signed`](https://solana.com/docs/core/cpi):

```rust
use solana_program::program::invoke_signed;

// Runtime ngecek: apakah seeds ini + program ID gue = PDA ini?
invoke_signed(
    &transfer_instruction,
    &accounts,
    &[
        &[
            b"user_profile",
            authority.key.as_ref(),
            &[bump_seed],  // disimpen pas akun dibikin
        ],
    ],
)?;
```

Runtime nurunin ulang alamat dari seeds dan program ID. Kalau cocok sama akun yang lagi dioperasiin, tanda tangannya valid. Ini satu-satunya cara PDA bisa nandatangani. Nggak ada private key cadangan.

---

### 6. Mengikat Semuanya

Yuk taruh semuanya ke praktik. Seorang user kirim transaksi. Runtime muat setiap akun yang nyangkut di instruksi. Program kamu cek field owner: bener nih program ini yang punya data akun tersebut? Kalau iya, dia baca dan tulis byte mentah (serialisasi Borsh).

Setiap akun yang nyangkut butuh saldo lamport-nya di atau di atas minimum rent-exempt. Kalau PDA jadi bagian dari alur, program kamu nandatangani pakai `invoke_signed` dengan seeds. Runtime cek ulang semua aturan kepemilikan dan penandatanganan. Nggak ada pengecualian.

Akun, penyimpanan, rent, dan PDA. Kuasai keempatnya, dan sisa pengembangan Solana bakal jauh lebih gampang. [Bagian 2](/id/posts/solana-compute-units/) bahas compute unit: gimana Solana ngukur dan mbatasin kerjaan yang bisa dikerjain transaksi kamu.

---

### Referensi

- [Accounts, Solana Docs](https://solana.com/docs/core/accounts)
- [Program Derived Addresses, Solana Docs](https://solana.com/docs/core/pda)
- [Cross-Program Invocations, Solana Docs](https://solana.com/docs/core/cpi)
- [getMinimumBalanceForRentExemption, Solana RPC](https://solana.com/docs/rpc/http/getminimumbalanceforrentexemption)
- [Borsh Specification](https://borsh.io/)
