---
title: 'Compute Units Solana: Apa yang Kamu Bayar untuk Menjalankan Kode'
date: 2026-04-21T10:00:00+07:00
description: "Panduan praktis tentang compute units (CU) Solana: memahami budget 200K per instruksi dan 1.4M per transaksi, kenapa operasi berbeda biayanya berbeda, mengukur penggunaan CU dengan anchor test dan simulateTransaction, serta menerapkan pola optimasi untuk menulis program Anchor yang efisien."
params:
  author: 'widnyana'
tags: ["solana", "blockchain", "web3", "compute-units", "optimization", "anchor"]
categories: ["solana", "blockchain"]
keywords: ["solana compute units", "compute unit budget", "solana optimization", "anchor optimization", "solana priority fees", "compute unit profiling", "transaction efficiency"]
series: ["Solana Program Lifecycle"]
cover:
  image: "/images/solana-compute-units.png"
---

Ini Bagian 2 dari seri [Solana Program Lifecycle](/id/series/solana-program-lifecycle/). Di Bagian 1 kita udah bahas cara kerja akun. Sekarang gue mau bahas hal yang bakal bikin kode lu hancur kalau dibiariin: compute units.

Transaksi Solana nggak ngasih peringatan saat kita mendekatin batas compute. Dia cuma gagal aja. User kehilangan fees. Nggak ada pengembalian. Banyak developer baru nyadar masalah ini pas mainnet mulai nolak transaksi yang sebelumnya lancar jaya di devnet.

Post ini about cara nghindarin pelajaran mahal itu.

---

### Masalahnya: Transaksi kita lebih mahal dari yang kita kira

Transaksi Solana nggak gagal secara elegan saat kehabisan compute. Dia cuma mati begitu aja. User kehilangan fees. Nggak ada pengembalian. Nggak ada peringatan.

Masalahnya: kebanyakan developer menebak biaya compute mereka alih-alih ngukur. "Oh, CPI kayanya aman sih, gue bisa muat 10." Terus pas di-profiling, ternyata 10 CPI aja udah bakar porsi gede dari budget 1.4M. Tambah verifikasi tanda tangan, beberapa account load, dikit deserialization, dan tiba-tiba transaksi udah jebol budget.

Masalah kedua: nggak jelas bagian kode mana yang mahal sampai lu ukur. Verifikasi tanda tangan 25,000 CU. Operasi aritmatika sederhana sekitar 100-150 CU di praktiknya (termasuk overhead serialisasi). Bedanya signifikan banget. Tanpa profiling, semuanya cuma tebakan doang.

Post ini ngebahas cara lihat biaya aslinya. Dan begitu biayanya kelihatan, optimasi jadi kebaca sendiri.

---

### Apa itu compute unit (CU)?

Compute unit itu kayak meter pada transaksi. Setiap operasi makan jumlah tertentu. Kalau habis, transaksi gagal.

**Budget-nya:**

| Apa | Budget | Catatan |
|---|---|---|
| Per instruksi | 200,000 CU | Alokasi default. Beberapa instruksi sistem dikasih lebih dikit. |
| Per transaksi | 1,400,000 CU | Total dari semua instruksi. Kalau kode kita murah, kita bisa minta lebih dikit. |
| Batas akun | 32 akun per transaksi (64 dengan Address Lookup Tables) | Transaksi standar 32. Address Lookup Tables (ALT) naikin ini ke 64. Setiap akun yang diload makan CU berdasar ukuran data. |

Konsepnya mirip gas di Ethereum: setiap operasi punya biaya. Ethereum ngasih estimasi biaya sebelum pengiriman; Solana nggak nunjukin estimasi itu secara default, jadi biaya CU harus diukur eksplisit. Kalau nggak, siap-siap aja gagal diam-diam.

---

### Kenapa operasi yang beda biayanya beda banget

Nggak semua kode itu sama. Ada operasi yang 10 CU. Ada yang 25,000 CU. Selisihnya tiga orde magnitudo. Runtime nge-charge berdasar seberapa berat setiap operasi sebenernya.

> Biaya CU di bawah berasal dari [sumber Agave runtime](https://github.com/anza-xyz/agave/blob/0fa97007f2983b4cefc537573b8cfc391a35fa75/program-runtime/src/execution_budget.rs). Nilai-nilai ini bisa berubah antar versi runtime. Selalu profil pake `cargo test-sbf` buat angka aslinya dari kode kamu.

**Murah (10-100 CU):**
- Operasi memori (`mem_op_base_cost`): 10 CU
- Logging (`log_64_units`): 100 CU
- Akses Sysvar (`sysvar_base_cost`): 100 CU

**Sedang (85-1,500 CU):**
- Hashing SHA-256 (`sha256_base_cost`): 85 CU dasar + 1 CU per byte. Hash 32-byte sekitar ~117 CU.
- Derivasi alamat program (`create_program_address_units`): 1,500 CU

**Mahal (10,000+ CU):**
- Recovery tanda tangan secp256k1 (`secp256k1_recover_cost`): 25,000 CU per tanda tangan
- Deserialisasi Borsh untuk struct besar (bervariasi berdasar ukuran)
- Cross-program invocations (CPI): 946 CU biaya invokasi dasar (`invoke_units`), ditambah seluruh biaya eksekusi program yang dipanggil dan transfer data akun (`cpi_bytes_per_unit` = 250 bytes/CU)

Angka CPI ini sering bikin orang kaget. Invokasi dasarnya cuma 946 CU, tapi total biaya CPI nyangkup semua yang dikerjain program yang dipanggil. CPI ke System Program untuk transfer mungkin totalnya ~26,000 CU setelah eksekusi programnya disertakan. CPI ke program DeFi yang kompleks bisa bakar 100,000+ CU. Biaya dasarnya kecil; eksekusi callee-nya yang dominan.

**Contoh: Berapa biaya sebuah transfer**

Transfer sederhana ke System Program:
```
Overhead instruksi:           200-500 CU
Muat 3 akun:                  ~500 CU
Bangun instruksinya:          ~100 CU
Invokasi dasar CPI:           ~946 CU
System Program memprosesnya:  ~200 CU
─────────────────────────────────────
Total:                        ~2,000 CU (dasar) sampai ~26,000 CU (dengan overhead CPI penuh)
```

Transfer sederhana muat dengan nyaman. Tapi tambahin satu verifikasi tanda tangan secp256k1 (+25,000 CU) dan totalnya ~27,000 CU. Tambah deserialisasi Borsh 10KB (~40 CU untuk transfer data dengan 250 bytes/CU) dan satu CPI lagi ke program kompleks (~50,000+ CU), dan tiba-tiba udah 77,000+ CU. Masih di bawah 200K sih, tapi akumulasi ini kelihatan banget.

---

### Ukur, jangan tebak

Sebelum ngoptimasi apapun, kita perlu lihat angka aslinya. Menebak itu buang waktu doang.

**Pake cargo test-sbf**

`cargo test-sbf` (dipanggil secara internal oleh `anchor test`) ngompilasi dan jalanin program kita ke `BanksClient` lokal. Saat test jalan, log program nunjukin persis berapa banyak CU yang dimakan:

```bash
cargo test-sbf
```

Output-nya nyertain satu baris per instruksi:

```
Program <id> invoke [1]
Program log: ...
Program <id> consumed 45,231 of 200,000 compute units
Program <id> success
```

Itu data nyata dari kode kita yang sebenernya. Kita juga bisa pake metode RPC `simulateTransaction` (diekspos sebagai `solana confirm -v` di CLI) buat dapetin estimasi CU buat transaksi ke cluster live sebelum kita kirim.

**Contoh test Anchor yang nyata:**

```rust
#[tokio::test]
async fn test_my_instruction_cu_usage() {
    let program_test = ProgramTest::new(
        "my_program",
        id(),
        processor!(process_instruction),
    );
    let mut ctx = program_test.start_with_context().await;

    // Siapkan akun dan instruksi...
    let tx = Transaction::new_signed_with_payer(
        &[your_instruction],
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer],
        ctx.last_blockhash,
    );

    // Jalanin. Log program bakal cetak CU yang dimakan.
    ctx.banks_client
        .process_transaction(tx)
        .await
        .expect("Transaksi gagal");
}
```

Jalanin ini dan perhatiin outputnya. Kita bakal ngeliat sesuatu kayak:

```
Program <id> consumed 78,432 of 200,000 compute units
```

Angka 78,432 itu angka asli kita. Bukan tebakan, bukan hitung-hitungan. Pengukuran nyata.

---

### Pola optimasi (dan di mana beneran membantu)

Begitu kita bisa ngukur, kita bisa ngoptimasi. Ini pola-pola yang beneran penting.

#### Pola 1: Minimalkan CPI (dampak paling gede)

Setiap cross-program invoke punya biaya dasar 946 CU, tapi total biayanya nyangkup semua yang dikerjain program yang diinvoke. CPI ke Token Program mungkin makan 15,000 CU total. CPI ke program kompleks bisa bakar 100,000+ CU. Numpuk 10 CPI ke berbagai program dan biayanya numpuk cepet banget.

**Jebakannya:**
```rust
// 10 CPI ke instruksi transfer. Meskipun masing-masing "cuma" ~26,000 CU total,
// itu udah 260,000+ CU sebelum logic bisnis apapun
for user in users {
    invoke(&transfer_instruction, &[...])?;
}
```

**Solusinya:**
Kalau program target nyangkep batching, pake dong. Kalau nggak, pindahin loop ke luar transaksi dan lakuin beberapa transaksi sebagai gantinya.

Ini perbaikan dengan dampak paling gede. Setiap CPI yang nggak perlu itu buang biaya invokasi dasarnya (946 CU) plus seluruh biaya eksekusi callee-nya. Ngilangin CPI hampir selalu jadi optimasi dengan dampak tertinggi.

#### Pola 2: Jangan deserialisasi yang nggak kita butuhin

Mendeserialisasi struct Borsh 10KB itu makan CU. Tapi kalau kita cuma butuh byte 64-72, mendeserialisasi semuanya itu pemborosan.

```rust
// Buruk: deserialisasi seluruh struct
let full_state: MyState = MyState::try_from_slice(&account.data)?;
let field_i_need = full_state.specific_field;

// Lebih baik: baca cuma yang dibutuhin
let bytes = &account.data[64..72];  // 8 byte untuk u64
let field_i_need = u64::from_le_bytes(bytes.try_into()?);
```

Ini cuma masuk akal kalau profiling nunjukin deserialisasi emang bottleneck-nya. Kebanyakan waktu sih nggak. Pake sebagai jalan terakhir pas udah deket batas CU dan optimasi lain nggak nolong.

#### Pola 3: Berhenti nyertain akun yang nggak kita pake

Batas akun itu 32 per transaksi standar (64 dengan Address Lookup Tables). Transfer data akun makan 1 CU per 250 byte selama CPI (`cpi_bytes_per_unit`). Kalau akun nggak disentuh, jangan disertakan.

**Pemborosannya:**
```rust
#[derive(Accounts)]
pub struct MyInstruction<'info> {
    pub signer: Signer<'info>,
    pub state: Account<'info, State>,
    pub unused1: UncheckedAccount<'info>,
    pub unused2: UncheckedAccount<'info>,
    // ... 20 akun lagi yang nggak kita sentuh
}
```

22 akun yang nggak dipake itu? Biaya loading data yang kebuang. Setiap byte yang ditransfer selama CPI makan CU.

**Solusinya:**
```rust
#[derive(Accounts)]
pub struct MyInstruction<'info> {
    pub signer: Signer<'info>,
    pub state: Account<'info, State>,
}
```

Sertakan cuma yang beneran kita baca atau tulis.

#### Pola 4: Jangan verifikasi 10 tanda tangan dalam satu instruksi

Recovery secp256k1 makan 25,000 CU per tanda tangan (`secp256k1_recover_cost`). Verifikasi 10 tanda tangan dan itu 250,000 CU cuma buat verifikasi. Budget hampir abis sebelum ada kerjaan nyata yang kejadian.

**Kalau butuh banyak tanda tangan:**
- Verifikasi di offchain dan cuma validasi hasilnya di onchain
- Pake program multisig yang mem-batch verifikasi
- Pecah jadi beberapa transaksi

Ini batasan keras, bukan pola. Kalau use case butuh 10 verifikasi tanda tangan dalam satu instruksi, berarti lu melawan arsitekturnya, bukan kerja samaama dia.

---

### Priority fees: bayar buat lompat antrian

Saat mainnet sibuk, transaksi nunggu. Bayar priority fee bisa motong antrian. Semakin banyak bayar per CU, semakin tinggi prioritasnya.

> `set_compute_unit_price` nerima **micro-lamports** per compute unit. 1 lamport = 1,000,000 micro-lamports.

```rust
use solana_sdk::compute_budget::ComputeBudgetInstruction;

// Minta 50,000 CU (bukan default 200K)
// Bayar 1,000 micro-lamports per CU sebagai priority fee
let mut instructions = vec![
    ComputeBudgetInstruction::set_compute_unit_limit(50_000),
    ComputeBudgetInstruction::set_compute_unit_price(1_000),
];
instructions.push(your_instruction);

// Total priority fee: 50,000 * 1,000 micro-lamports = 50,000,000 micro-lamports = 50,000 lamports = 0.00005 SOL
```

**Kapan pakenya:**
- Saat kemacetan, kalau transaksi kita terus timeout
- Operasi yang sensitif ke waktu: MEV (nyusun ulang trade buat keuntungan), liquidation (nutup pinjaman berisiko dengan cepet), arbitrage (manfaatin beda harga sebelum market berubah)
- Load testing tekanan mainnet

**Di devnet/testnet:**
```rust
ComputeBudgetInstruction::set_compute_unit_price(0)  // Gratis
```

---

### Budget transaksi: kapan perlu dipecah

Budget-nya 1.4M CU total per transaksi. Kalau merangkai beberapa instruksi, biaya masing-masing harus keliatan.

**Contoh: Transaksi aman**
```
Instruksi 1: 45,000 CU
Instruksi 2: 60,000 CU
Instruksi 3: 35,000 CU
Total: 140,000 CU < 1,400,000 CU ✓
```

**Contoh: Jebol budget**
```
Instruksi 1: 600,000 CU
Instruksi 2: 600,000 CU
Instruksi 3: 600,000 CU
Total: 1,800,000 CU > 1,400,000 CU ✗ GAGAL
```

Kalau mendekatin 1.4M, pecah jadi dua transaksi. Lakukan pas development dong, bukan pas insiden produksi.

---

### Checklist sebelum mainnet

Ini yang bedain kode yang bisa di-deploy dari kode yang gagal di produksi.

1. **Profil pake cargo test-sbf**: ukur penggunaan CU aslinya. Jangan nebak.
2. **Test kasus terberat**: akun maksimal, data maksimal, semua dibatasin. Berapa biayanya?
3. **Estimasikan priority fees**: saat jam sibuk, berapa biaya 1,000 micro-lamports per CU dalam SOL?
4. **Rencanain pemecahan**: kalau deket 1.4M, pecah jadi beberapa transaksi sekarang.
5. **Review hot paths**: fungsi yang sering dipanggil harus pake pola optimasi di atas.

**Contoh output checklist:**
```
test_initialize_state     ... ok (12,500 CU)
test_transfer             ... ok (26,100 CU)
test_complex_update       ... ok (145,000 CU)
test_batch_operation      ... ok (850,000 CU) ← deket 1.4M, perlu dipecah
```

Kalau ada test yang melebihi 1.4M, refactor dulu sebelum deploy.

---

### Apa yang sering bikin developer kaget

Kejutan terbesar: kebanyakan developer Solana nggak tahu berapa banyak CU program mereka sebenernya pake. Semuanya lancar di devnet, terus mainnet mulai nolak transaksi dengan pesan "insufficient compute budget" dan errornya nggak ngasih tahu instruksi mana yang meledakkan budget.

Kejutan kedua: CPI dominan di budget kebanyakan program. Kamu bisa ngoptimasi deserialisasi dan account loading seharian dan hemat 10,000 CU. Atau lu bisa ngilangin satu CPI yang nggak perlu dan hemat seluruh biaya eksekusinya. Satu perubahan, dampak gede.

Hal ketiga: angka CU di log `cargo test-sbf` itu data nyata dari kode kamu yang sebenernya. Jangan ng_estimator. Profil.

---

### Mengikat semuanya

Bayangin semuanya bergerak. Sebuah transaksi masuk. Runtime ngasih dia 1.4M CU. Setiap instruksi di dalamnya dapet 200K. Setiap operasi, dari pembacaan memori sampai recovery secp256k1, nggerogoti budget itu. Saat nyapai nol, transaksi mati. Nggak ada pengembalian.

Langkah yang bisa diandalkan adalah profil sebelum hal lain. `cargo test-sbf` ngasih angka nyata. Pake. Cari tau ke mana CU sebenernya pergi. Biasanya itu CPI: satu cross-program invoke yang nggak perlu bisa lebih mahal dari semua yang lain digabungin. Hilangin itu, dan budget kebuka lagi.

Priority fees nolong melewatin kemacetan. Tapi dia nggak bakal nyelamatin kode yang bakar 1.2M CU karena numpuk CPI yang malas. Transaksi yang cuma pake 80K CU karena hot paths-nya ketat jarang butuh priority fees sama sekali.

[Bagian 3](/id/posts/solana/solana-program-lifecycle-two-account-model/) bahas gimana program Solana beneran hidup di onchain: model dua akun yang bikin upgrade bisa dilakuin tanpa merusak semua yang bergantung ke program tersebut.
