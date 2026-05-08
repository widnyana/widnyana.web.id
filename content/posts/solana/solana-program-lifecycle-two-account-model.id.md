---
title: 'Bagaimana Program Solana Benar-Benar Hidup On-Chain: Model Dua Akun'
date: 2026-04-25T10:00:00+07:00
description: "Program Solana tidak disimpan dalam satu akun. Mereka terbagi menjadi dua akun yang saling terhubung dan dikelola oleh BPF Loader: sebuah Program Account kecil yang berfungsi sebagai identitas, dan ProgramData Account yang lebih besar yang menyimpan bytecode. Post ini membahas model dua akun, menjelaskan kenapa program ID tidak pernah berubah saat upgrade, dan menunjukkan bagaimana arsitektur ini membuat hot-swappable code menjadi mungkin."
params:
  author: 'widnyana'
tags: ["solana", "blockchain", "web3", "bpf-loader", "program-deployment", "upgrades"]
categories: ["solana", "blockchain"]
keywords: ["solana bpf loader", "solana program account", "solana programdata account", "upgradeable loader state", "solana two account model", "solana program upgrade", "bpf loader upgradeable", "solana executable account"]
series: ["Solana Program Lifecycle"]
cover:
  image: "/images/solana-account-model.svg"
---

Ini bagian 3 dari seri [Solana Program Lifecycle](/id/series/solana-program-lifecycle/). Di [Bagian 1](/id/posts/solana/solana-accounts-storage-rent/) kita bahas model akun. Di [Bagian 2](/id/posts/solana/solana-compute-units/) kita bahas compute unit. Sekarang kita masuk ke sesuatu yang jarang kepikiran sama developer, biasanya cuma kepikiran pas sesuatu udah rusak: gimana sih program bener-bener hidup di on-chain?

Begini nih: program Solana itu bukan satu akun. Dia dua akun. Dan hubungan antara keduanya adalah yang bikin upgrade bisa dilakuin tanpa merusak semua yang bergantung ke program tersebut.

---

### Plot twist: program kamu itu dua akun

![Pak Vincent: plot twist energy](/images/solana/pak-vincent-plot-twist.png)

Waktu kamu deploy program pakai `solana program deploy`, kamu dapet program ID. ID itu adalah alamat Solana. Kebanyakan developer ngira bytecode hidup di alamat itu. Nggak juga sih.

Program ID nunjuk ke sebuah **Program Account** yang kecil, cuma 36 byte. Akun itu cuma berisi satu hal yang berguna: sebuah pointer ke akun kedua, yaitu **ProgramData Account**, yang naro ELF bytecode yang beneran, nomor slot, dan upgrade authority.

```
Program Account (program ID kamu)
├── discriminator: 4 byte (u32 = 2, mengidentifikasi ini sebagai varian "Program")
└── programdata_address: 32 byte (menunjuk ke bytecode yang sebenarnya)

ProgramData Account (menyimpan kode yang sebenarnya)
├── discriminator: 4 byte (u32 = 3, mengidentifikasi ini sebagai varian "ProgramData")
├── slot: 8 byte (kapan program terakhir di-deploy/upgrade)
├── authority option: 1 byte (0 = immutable, 1 = punya upgrade authority)
├── upgrade_authority_address: 32 byte (siapa yang bisa upgrade, jika ada)
└── ELF bytecode: sisa dari akun
```

Kedua akun punya owner program BPF Loader Upgradeable di `BPFLoaderUpgradeab1e11111111111111111111111`. Perhatikan `1` nggantikan `l` di "Upgradeable." Alamat Solana di-encode dalam base58, dan dalam base58 karakter `1` nunjukin zero byte. Hasilnya kebaca kayak "Upgradeable" dengan typo, tapi emang begitulah hasil encoding-nya.

Akun ProgramData diturunkan secara deterministik dari akun Program. Punya owner BPF Loader:

```rust
pub fn get_program_data_address(program_address: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[program_address.as_ref()],
        &id(), // BPFLoaderUpgradeab1e11111111111111111111111
    ).0
}
```

Alamat program yang sama, alamat ProgramData yang sama. Setiap saat. Ini adalah PDA yang diturunkan dari alamat program itu sendiri, punya owner BPF Loader.

---

### Kenapa dibagi dua akun sih?

Pemisahan ini ada karena satu alasan: **upgrade**.

Kalau program ID dan bytecode hidup di akun yang sama, ng-upgrade bytecode berarti ngubah akun tersebut. Padahal program ID direferensikan di mana-mana: PDA, kode client, file konfigurasi, CPI call dari program lain, token accounts, governance proposal. Ubah itu, semuanya rusak.

Jadi, Program Account nggak pernah berubah. Dia pointer tetap sebesar 36 byte. Waktu kamu upgrade, cuma akun ProgramData yang dapet bytecode baru. Pointer-nya tetap sama. Semua yang mereferensikan program ID tetap jalan.

```
Sebelum upgrade:
  Program Account (ID: ABC...123) → ProgramData (slot 200, bytecode v1)

Setelah upgrade:
  Program Account (ID: ABC...123) → ProgramData (slot 450, bytecode v2)
              ^^^ tidak berubah ^^^           ^^^ slot baru, bytecode baru ^^^
```

Program ID itu identitas yang stabil. Akun ProgramData itu implementasi yang bisa diganti.

![Model dua akun: Program Account menunjuk ke ProgramData Account](/images/program-account-expanded.svg)

---

### Apa sih "executable" itu beneran?

Di [Bagian 1](/id/posts/solana/solana-accounts-storage-rent/), kita udah lihat kalau setiap akun punya field `executable`. Buat kebanyakan akun, nilainya `false`. Buat akun program, nilainya `true`. Tapi apa yang beneran dilakuin runtime sama field ini?

Waktu transaksi manggil sebuah program, runtime ngecek:

1. Apakah akun ditandai `executable: true`?
2. Apakah akun punya owner program loader (BPF Loader Upgradeable, atau BPF Loader legacy)?

Kalau keduanya `true`, runtime ngikutin struktur akun loader buat nemuin bytecode. Buat program upgradeable, itu berarti baca akun Program, ambil `programdata_address`, load akun itu, dan ekstrak ELF bytecode mulai dari byte offset 45 (ukuran header ProgramData).

Loader terus verifikasi bytecode (checksum, validasi format) dan compile via JIT buat eksekusi. Ini cuma terjadi di pemanggilan pertama dalam sebuah slot. Hasil kompilasi di-cache sama runtime, jadi pemanggilan berulang dalam slot yang sama nggak usah compile ulang.

Intinya: `executable: true` bukan berarti "akun ini isinya kode yang bisa dijalanin." Artinya "akun ini adalah entry point program. Ikutin struktur loader buat nemuin kode yang beneran." Program Account itu entry point. ProgramData Account itu kodenya.

---

### Layout akun lengkap dalam byte

Enum `UpgradeableLoaderState` pakai serialisasi bincode. Ini layout byte-nya yang persis.

**Nilai discriminator:**

| Nilai | Varian | Artinya |
|-------|--------|---------|
| 0 | `Uninitialized` | Akun kosong, belum dipakai |
| 1 | `Buffer` | Akun sementara buat upload bytecode |
| 2 | `Program` | Entry point program (total 36 byte) |
| 3 | `ProgramData` | Bytecode yang beneran + metadata |

**Program Account (total 36 byte):**
```
[0..4]   u32 discriminator = 2
[4..36]  Pubkey programdata_address
```

**ProgramData Account (header 45 byte + ELF bytecode):**
```
[0..4]    u32 discriminator = 3
[4..12]   u64 slot
[12..13]  u8 option (0 = None = immutable, 1 = Some = punya authority)
[13..45]  Pubkey upgrade_authority_address (ada kalau option = 1)
[45..]    ELF bytecode mentah
```

**Buffer Account (header 37 byte + bytecode parsial):**
```
[0..4]   u32 discriminator = 1
[4..5]   u8 option (0 = None, 1 = Some)
[5..37]  Pubkey authority_address (ada kalau option = 1)
[37..]   byte program mentah (diupload dalam potongan-potongan)
```

Akun Buffer itu tempat penampungan sementara yang dipakai pas deploy dan upgrade. Detailnya ada di [Bagian 4](/id/posts/solana/solana-program-deploy-upgrade-buffer/).

---

### Kenapa BPF Loader punya program kamu

Baik Program Account maupun ProgramData Account punya field `owner` yang di-set ke `BPFLoaderUpgradeab1e11111111111111111111111`. Ini bukan cuma saran. Runtime ngejalanin ini keras.

Ingat aturan kepemilikan dari [Bagian 1](/id/posts/solana/solana-accounts-storage-rent/): cuma program owner yang bisa ngubah data sebuah akun. Karena BPF Loader punya akun Program dan ProgramData, dia satu-satunya entitas yang bisa ngubah pointer bytecode atau bytecode itu sendiri. Program kamu nggak bisa modif kodenya sendiri. Program lain juga nggak bisa.

Makannya upgrade dilakuin lewat instruksi BPF Loader (`Upgrade`, `DeployWithMaxDataLen`, `SetAuthority`). Loader ngecek tanda tangan upgrade authority sebelum ngizinin perubahan apapun. Tanpa tanda tangan authority yang valid, nggak ada yang terjadi deh.

Waktu kamu bikin program jadi immutable (pakai `solana program deploy --final` atau `solana program set-upgrade-authority --final`), loader set field `upgrade_authority_address` ke `None` (byte option di offset 12 jadi 0). Setelah itu, loader nolak semua instruksi upgrade secara permanen. Nggak ada rollback. Nggak ada undo. Bytecode-nya dibekukan.

---

### Biaya runtime dari model dua akun

Di [Bagian 2](/id/posts/solana/solana-compute-units/) kita udah bahas biaya compute unit. Loader upgradeable punya biaya CU sendiri:

```
UPGRADEABLE_LOADER_COMPUTE_UNITS: 2,370 CU
```

Itu biaya dasar yang dibebankan loader pas proses instruksi apapun (deploy, upgrade, close). Biaya aktual buat load dan eksekusi program itu terpisah dan tergantung ukuran bytecode.

Model dua akun juga berarti runtime load dua akun buat setiap pemanggilan program: Program Account (36 byte, cepat) dan ProgramData Account (seukuran bytecode, bisa gede). Buat program Anchor tipikal sekitar 300-500KB bytecode, berarti dua pemuatan akun per pemanggilan. Biaya transfer data saat CPI adalah 1 CU per 250 byte (`cpi_bytes_per_unit`), jadi memuat akun ProgramData sebesar 400KB makan sekitar 1,600 CU cuma buat transfer data.

Ini overhead yang nggak bisa kamu kontrol. Itu harga dari arsitektur upgradeable. Trade-off-nya worth it sih: kamu dapet hot upgrade dengan biaya beberapa ribu CU per pemanggilan.

---

### Loader legacy: BPF Loader v1

Sebelum loader upgradeable ada, dulu ada dua loader non-upgradeable:

- **Deprecated loader** (`BPFLoader1111111111111111111111111111111111`): yang asli. Udah nggak dipakai buat deploy baru.
- **BPF Loader v2** (`BPFLoader2111111111111111111111111111111111`): masih jalan, tapi bytecode hidup langsung di akun program. Nggak ada pointer, nggak ada akun ProgramData, nggak ada upgrade.

Program yang di-deploy pakai salah satu loader ini immutable dari sananya. Kamu nggak bisa upgrade. Kalau ada bug, harus deploy program baru di alamat baru dan migrasi semuanya. Nyebelin banget, dan itulah kenapa loader upgradeable dibikin.

Program baru sebaiknya selalu pakai loader upgradeable. `solana program deploy` udah pakai itu secara default, jadi itulah yang kamu dapet kecuali kamu sengaja maksa pakai loader legacy.

---

### Verifikasi model dua akun langsung on-chain

Kamu bisa lihat semuanya sendiri nih. Ambil program ID apapun dan cek akun-akunnya.

```bash
# Periksa akun program
solana program show <PROGRAM_ID>

# Output:
# Program ID: <PROGRAM_ID>
# Owner: BPFLoaderUpgradeab1e11111111111111111111111
# ProgramData Address: <PROGRAMDATA_ADDRESS>
# Authority: <UPGRADE_AUTHORITY atau none>
# Last Deployed In Slot: <SLOT>
```

Atau query data akun mentah via RPC:

```bash
# Dapatkan akun program
solana account <PROGRAM_ID> --output json

# Dapatkan akun programdata (bytecode yang sebenarnya)
solana account <PROGRAMDATA_ADDRESS> --output json
```

Akun program bakal kecil banget (36 byte). Akun ProgramData bakal jauh lebih gede, sesuai ukuran bytecode ditambah header 45 byte.

Buat verifikasi derivasi alamat ProgramData:
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

Ini harus cocok sama `ProgramData Address` yang ditunjukin sama `solana program show`.

---

### Hal-hal yang sering bikin Kaget developer

**Ukuran akun ProgramData ditentukan saat deploy.** Waktu kamu deploy pakai `solana program deploy --max-len 400000`, akun ProgramData dibuat dengan ruang buat 400KB bytecode. Kalau bytecode hasil upgrade melebihi itu, upgrade gagal dong. Kamu nggak bisa gedein akun tanpa redeploy dari awal (atau pakai instruksi `ExtendProgram` buat nambah ruang, yang butuh SOL buat tambahan saldo rent-exempt).

**Akun buffer yatim bikin SOL terbuang.** Kalau deploy gagal di tengah jalan, akun buffer tetap ada on-chain dengan SOL yang terkunci di dalamnya. Pakai `solana program close --buffers` buat klaim balik.

**Bikin program immutable itu permanen.** Nggak ada perintah "unfinalize." Setelah authority dihapus, program ID itu dibekuin selamanya. Kalau ada bug, satu-satunya pilihan deploy program baru di alamat baru dan migrasi semuanya. Ini by design. Immutability itu fitur keamanan, bukan bug.

**Akun ProgramData adalah PDA, tapi kamu nggak ngelola dia.** BPF Loader yang nurunin dan ngelola itu. Kamu nggak pernah berinteraksi langsung dengannya. Semua operasi dilakuin lewat instruksi loader.

---

### Mengikat Semuanya

Yuk taruh semuanya dalam konteks. Sebuah transaksi manggil program kamu. Runtime ngecek: apakah akun `executable: true`? Apakah punya owner loader? Kalau iya, dia ngikutin pointer dari Program Account ke ProgramData Account, load ELF bytecode, dan mulai jalanin.

Program ID nggak pernah berubah. Pointer nggak pernah berubah. Waktu kamu upgrade, loader ganti bytecode di dalam ProgramData Account dan naikin nomor slot. Setiap client, setiap derivasi PDA, setiap CPI call yang mereferensikan program ID sebelum upgrade tetap jalan setelahnya. Itulah tujuan dari pemisahan ini.

BPF Loader punya kedua akun. Dia yang mutusin apa yang boleh dimodif dan apa yang nggak. Program kamu nggak bisa nyentuh kodenya sendiri. Program lain juga nggak bisa. Semua modifikasi dilakuin lewat instruksi loader, dan setiap instruksi ngecek upgrade authority.

[Bagian 4](/id/posts/solana/solana-program-deploy-upgrade-buffer/) bahas alur deploy dan upgrade secara lengkap, termasuk pola akun buffer dan apa yang terjadi kalau sesuatu gagal di tengah jalan.

---

### Referensi

- [BPF Loader Upgradeable, Solana Docs](https://solana.com/docs/core/programs#bpf-loader)
- [UpgradeableLoaderState enum, solana-loader-v3-interface (docs.rs)](https://docs.rs/solana-loader-v3-interface/latest/solana_loader_v3_interface/state/enum.UpgradeableLoaderState.html)
- [Loader Upgradeable Instructions (docs.rs)](https://docs.rs/solana-loader-v3-interface/latest/solana_loader_v3_interface/instruction/index.html)
- [Accounts, Solana Docs](https://solana.com/docs/core/accounts)
