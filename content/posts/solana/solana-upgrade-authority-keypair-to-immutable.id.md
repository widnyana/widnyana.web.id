---
title: 'Upgrade Authority: Dari Keypair hingga Immutable'
date: 2026-05-05T10:00:00+07:00
description: "Setiap program Solana yang bisa di-upgrade memiliki satu field yang mengontrol siapa bisa mengganti bytecodenya: upgrade_authority_address di akun ProgramData. Tulisan ini menelusuri siklus hidup lengkap field tersebut, dari satu keypair melalui multisig Squads dan SPL Governance, hingga flag --final yang irreversibel dan membekukan program selamanya."
params:
  author: 'widnyana'
tags: ["solana", "blockchain", "web3", "upgrade-authority", "bpf-loader", "program-deployment"]
categories: ["solana", "blockchain"]
keywords: ["solana upgrade authority", "solana program immutable", "solana set-upgrade-authority", "solana program final", "solana squads multisig", "solana governance upgrade", "bpf loader set authority"]
series: ["Solana Program Lifecycle"]
cover:
  image: "/images/solana/solana-upgrade-authority-keypair-to-immutable.png"
---

Ini bagian 5 dari seri [Solana Program Lifecycle](/id/series/solana-program-lifecycle/). Di [Bagian 4](/id/posts/solana/solana-program-deploy-upgrade-buffer/) kita udah bahas alur deploy dan upgrade: akun Buffer, chunked writes, dan langkah aktivasi yang nyalin bytecode ke akun ProgramData. Setiap instruksi upgrade ngecek satu hal sebelum nerusin: siapa yang boleh ngejalaninnya.

Satu hal itu adalah field `upgrade_authority_address`: 33 byte di akun ProgramData yang ngontrol siapa bisa ganti bytecode program. Tulisan ini bakal nge-track siklus hidup lengkap field itu, dari keypair yang nge-deploy program sampe flag `--final` yang irreversibel dan nulis `None`, ngebekuin program selamanya.

---

### Field upgrade authority

Kamu masih inget kan dari [Bagian 3](/id/posts/solana/solana-program-lifecycle-two-account-model/) kalau akun ProgramData nyimpen bytecode plus beberapa metadata? Layout-nya, diserialisasi pake bincode:

```
[0..4]    u32 discriminator = 3 (varian ProgramData)
[4..12]   u64 slot (slot deployment/upgrade terakhir)
[12..13]  u8 option discriminant (0 = None, 1 = Some)
[13..45]  Pubkey upgrade_authority_address (hanya ada jika option = 1)
[45..]    byte program mentah (ELF bytecode)
```

Tiga puluh tiga byte ngontrol semuanya. Byte 12 adalah flag option. Kalau nilainya `1`, byte 13 sampe 44 nyimpen public key authority. Kalau nilainya `0`, berarti nggak ada authority. Programnya immutable.

Program BPF Loader Upgradeable (`BPFLoaderUpgradeab1e11111111111111111111111`) ngecek field ini sebelum ngejalanin instruksi-instruksi berikut:

- `Upgrade` (discriminator 1): ganti bytecode. Butuh tanda tangan authority. Ditolak kalau field-nya `None`.
- `SetAuthority` (discriminator 4): ubah authority. Butuh tanda tangan authority yang sekarang. Authority baru nggak usah nandatangani.
- `SetAuthorityChecked` (discriminator 7): sama kayak `SetAuthority`, tapi authority baru juga harus nandatangani.
- `Close` (discriminator 5): tutup akun ProgramData dan klaim balik lamports. Butuh tanda tangan authority. Ditolak kalau field-nya `None`.

Saat byte 12 bernilai `0`, nggak ada satu pun instruksi di atas yang bisa jalan. Nggak ada signer yang valid. Program dibekuin secara permanen.

---

### Ngecek authority saat ini

CLI kasih jawaban cepat:

```bash
solana program show <PROGRAM_ID>
```

Output-nya kira-kira gini:

```
Program Id: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

Program Data Address: 5UUJQbPM6X7m2cawNGm8F95Z3LeLRBCE4F8xBrfTDdaF

Authority: Ds3Z9QxexjxtkWvhLnbmGzAuyxZrhk8VmN8cc8P2R5eS

Last Deployed In Slot: 284531193
```

Baris `Authority` nunjukin upgrade authority yang sekarang. Kalau program udah immutable, dia nunjukin:

```
Authority: none
```

Untuk mainnet, tinggal tambah flag cluster:

```bash
solana program show <PROGRAM_ID> --url mainnet-beta
```

Mau liat semua program beserta authority-nya? Gini:

```bash
solana program show --programs
```

Pengecekan programatik. Turunkan alamat ProgramData dari program ID, terus baca data akunnya:

```rust
use solana_sdk::pubkey::Pubkey;
use solana_sdk::bpf_loader_upgradeable;

let (program_data_address, _) = Pubkey::find_program_address(
    &[program_id.as_ref()],
    &bpf_loader_upgradeable::id(),
);

// Fetch akunnya, lalu baca byte [12..45]
// Byte 12:  0 = None (immutable), 1 = Some
// Byte 13-44: pubkey authority (saat byte 12 == 1)
```

Derivasinya deterministik: program ID yang sama selalu map ke alamat ProgramData yang sama. Kamu bisa verifikasi secara lokal tanpa musti akses jaringan.

---

### Transfer upgrade authority

Transfer dasar pake `SetAuthority`:

```bash
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <NEW_PUBKEY>
```

Di balik layar, ini bikin instruksi dengan byte discriminator `4`. Authority yang sekarang nandatangani. Authority baru cuma jadi referensi akun di dalam instruksi, tapi TIDAK perlu nandatangani.

Kalimat terakhir itulah bahayanya. Salah ketik di alamat berarti kamu kirim authority ke public key acak yang nggak dikontrol siapa pun. Programnya emang nggak immutable, tapi nggak ada yang bisa ngupgrade juga dong. Buatnya sama aja kayak ngebakar authority, cuma ProgramData masih nunjukin `Some(wrong_address)` bukan `None`.

Varian yang lebih aman adalah `SetAuthorityChecked` (byte discriminator `7`):

```bash
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <NEW_PUBKEY> \
  --new-upgrade-authority-signer <PATH_TO_KEYPAIR>
```

Di sini authority baru juga nandatangani. Ini ngebuktikan kalau key authority baru beneran punya private key yang cocok. Kalau kamu salah ketik alamatnya, instruksi langsung gagal karena keypair yang salah nggak bisa ngasilin tanda tangan yang valid.

Selalu pake `SetAuthorityChecked` kalau transfer ke keypair. Kalau transfer ke PDA (multisig, governance), `SetAuthority` satu-satunya opsi karena PDA nggak punya private key buat nandatangani.

Kamu bisa transfer ke pubkey valid apa aja: keypair lain, PDA multisig Squads, PDA governance, atau bahkan `11111111111111111111111111111111` (System Program, yang nggak punya private key, efektif ngebakar authority tanpa bikin program jadi fully immutable).

---

### Pola progresi

Sebagian besar proyek yang serius ngikutin jalur kematangan buat upgrade authority mereka. Setiap transisi nyempitin siapa yang bisa bertindak: dari satu orang, ke anggota M-of-N, ke voter berbobot token, ke nggak ada seorang pun. Setiap transisi bersifat satu arah dalam praktiknya.

---

#### Tahap 1: Keypair (pengembangan)

Keypair deployer pegang authority. Ini default setelah `solana program deploy`. Iterasi cepat. Satu perintah buat ngirim build baru:

```bash
solana program deploy ./target/deploy/program.so --program-id <KEYPAIR>
```

Single point of failure. Kalau keypair-nya ke-compromise, penyerang bisa ganti bytecode program dengan apa aja. Nggak ada delay, nggak ada proses approval, nggak ada rollback.

Cocok buat devnet dan testnet awal sih. Tapi nggak cocok buat apapun yang nangani nilai riil di mainnet.

---

#### Tahap 2: Multisig (peluncuran produksi)

Transfer authority ke PDA multisig Squads. Multisig ngelakuin threshold approval M-of-N sebelum instruksi apapun bisa dijalanin sebagai authority.

Alur setup-nya:

1. Buat Squad lewat [UI Squads](https://app.squads.so) atau SDK
2. Konfigurasi anggota dan threshold (misalnya, 3-of-5)
3. Dapetin alamat PDA Squad
4. Transfer upgrade authority:

```bash
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <SQUAD_PDA_ADDRESS>
```

Alur upgrade lengkap di bawah kontrol multisig dibahas di [bagian end-to-end di bawah](#alur-upgrade-dengan-squads-end-to-end).

Apa yang kamu hilangin: kecepatan. Upgrade butuh quorum. Satu orang nggak bisa ngirim hotfix jam 3 pagi tanpa ngumpulin cukup anggota buat penuhin threshold. Respons darurat jadi lebih lambat.

Apa yang kamu dapet: nggak ada kompromi key tunggal yang bisa ganti program. Penyerang harus compromise M dari N anggota secara barengan.

---

#### Tahap 3: Governance (desentralisasi)

Transfer authority ke PDA SPL Governance yang terikat ke Realm. Voting berbobot token nentuin apakah upgrade dilakuin.

Alur setup-nya:

1. Buat Realm dengan community token mint pake [Realms](https://app.realms.today/)
2. Buat akun ProgramGovernance buat program tersebut (upgrade authority yang sekarang harus nandatangani)
3. PDA Governance jadi upgrade authority
4. Buat upgrade: buat proposal, pemegang token voting, kalau voting lolos ada masa timelock, baru eksekusi

Apa yang kamu hilangin: kontrol tim. Komunitas yang nentuin. Eksekusi lebih lambat karena periode voting dan timelock udah built-in di konfigurasi governance. Setup tipikal mungkin butuh periode voting 3 hari ditambah timelock 1 hari sebelum bisa eksekusi.

Distribusi token itu penting banget. Kalau satu entitas pegang 51% token governance, sistemnya secara efektif terpusat cuma with langkah ekstra. Governance cuma sedesentralisasi distribusi token-nya.

Apa yang kamu dapet: deliberasi publik. Setiap proposal upgrade keliatan on-chain. Pemegang token bisa nolak perubahan yang mereka nggak setuju. Tim nggak bisa ngirim upgrade kejutan.

---

#### Tahap 4: Immutable (final)

```bash
solana program set-upgrade-authority <PROGRAM_ID> --final
```

Ini map ke `SetAuthority` tanpa akun authority baru. Loader nulis `0` ke byte 12 akun ProgramData. 32 byte yang nyimpen pubkey authority di-zero-in.

Nggak bisa dibatalkan. Nggak ada instruksi yang bisa balikin authority. Instruksi `SetAuthority` butuh authority yang sekarang buat nandatangani. Saat field-nya `None`, nggak ada signer yang valid. Loader nolak instruksinya.

Apa yang kamu hilangin: seluruh kemampuan upgrade. Perbaikan bug mustahil dilakuin. Kalau kerentanan kritis ketemu setelah jadi immutable, nggak ada jalur pemulihan lewat program ID asli. Satu-satunya opsi adalah deploy program baru di alamat baru dan migrasi semua pengguna.

Apa yang kamu dapet: jaminan kepercayaan absolut. Pengguna bisa verifikasi kalau bytecode nggak akan pernah berubah. Nggak ada kompromi key, nggak ada voting governance, nggak ada approval multisig yang bisa ubah program. Kode on-chain adalah kode yang dijalanin, secara permanen.

---

### Ringkasan progresi

| Transisi | Apa yang hilang |
|---|---|
| Keypair ke Multisig | Kecepatan. Upgrade butuh quorum. |
| Multisig ke Governance | Kontrol tim. Komunitas yang nentuin. Eksekusi lebih lambat. |
| Governance ke Immutable | Seluruh kemampuan upgrade. Nggak ada perbaikan bug. Selamanya. |

---

### Kapan ngelakuin setiap transisi

**Keypair ke Multisig**: saat peluncuran mainnet, atau lebih awal lagi. Begitu dana pengguna berisiko, authority key tunggal itu udah kelalaian. Siapin multisig sebelum deployment mainnet, bukan setelahnya.

**Multisig ke Governance**: saat protokol udah stabil, udah diaudit, dan komunitas sebaiknya punya suara dalam upgrade. Kalau fungsionalitas inti masih sering berubah, governance cuma nambah latensi tanpa nambah nilai.

**Governance ke Immutable**: setelah audit, pengujian ketat, dan periode upgrade yang dikontrol governance tanpa insiden. Infrastruktur fondasional (program token, program sistem) masuk kategori ini. Apapun yang seharusnya dipercaya pengguna tanpa syarat.

Jangan skip tahap. Langsung lompat ke immutable berarti kamu nggak bisa benerin bug. Langsung ke governance berarti pemegang token yang milih patch darurat, itu kebanyakan terlalu lambat buat penanganan insiden. Progresi harus sesuai kematangan protokol kamu.

---

### Contoh nyata di mainnet

**Multisig Squads**: sebagian besar program DeFi di mainnet yang masih bisa di-upgrade pake Squads atau multisig serupa. Authority-nya PDA yang butuh approval quorum. Tim tetep punya kontrol tapi didistribusiin ke beberapa signer.

**SPL Governance**: [Marinade Finance](https://docs.marinade.finance/) pake SPL Governance buat upgrade program. Pemegang token voting pada proposal upgrade. Tim nggak bisa ngirim perubahan secara sepihak.

**Program immutable**: [Token Program](https://solana.com/docs/core/tokens) (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) dan [Associated Token Account Program](https://solana.com/docs/tokens#associated-token-account) (`ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`) udah dibekuin. Upgrade authority mereka `None`. Ini infrastruktur fondasional. Bayangin kalau mereka punya authority key yang aktif, setiap token di Solana bakal bergantung ke keamanan satu key itu.

---

### Alur upgrade dengan Squads (end to end)

Buat tim yang pake Squads, siklus upgrade lengkapnya gini nih:

```bash
# 1. Build versi baru secara lokal
anchor build

# 2. Tulis bytecode yang sudah dikompilasi ke akun buffer
solana program write-buffer ./target/deploy/program.so
# Output: Buffer: <BUFFER_ADDRESS>

# 3. Transfer authority buffer ke PDA Squad
# Tanpa langkah ini, multisig tidak bisa menggunakan buffer
solana program set-buffer-authority <BUFFER_ADDRESS> \
  --new-buffer-authority <SQUAD_PDA>

# 4. Dapatkan hash buffer untuk verifikasi
solana-verify get-buffer-hash <BUFFER_ADDRESS>
# Bagikan hash ini ke semua anggota multisig

# 5. Ajukan upgrade di Squads
# Proposal berisi instruksi loader-v3 Upgrade:
#   - Akun ProgramData (writable)
#   - Akun Program
#   - Akun Buffer (writable)
#   - Akun Spill (menerima sisa lamports)
#   - Rent sysvar
#   - Clock sysvar
#   - Authority = PDA Squad (menandatangani via CPI)

# 6. Anggota memverifikasi hash buffer cocok dengan build lokal mereka
# anchor build && solana-verify get-executable-hash ./target/deploy/program.so
# Jika hash cocok, setujui.

# 7. Setelah threshold terpenuhi, eksekusi proposal
# Squads melakukan CPI ke instruksi Upgrade BPF Loader
# Buffer dikosongkan dan dipotong. Bytecode program diganti.
# Versi baru aktif di slot berikutnya.
```

Langkah 3 itu yang paling sering kelupaan. Kalau kamu nggak transfer authority buffer ke PDA Squad sebelum ajukan proposal, instruksi upgrade bakal gagal karena authority buffer (wallet deployer kamu) nggak cocok sama authority program (PDA Squad). Loader ngecek keduanya dan nolak kalau nggak cocok.

---

### Hal yang sering menjebak developer

**Transfer ke alamat yang salah itu katastrofik dengan `SetAuthority`.** Alamat baru nggak nandatangani. Nggak ada validasi bahwa ada yang pegang private key-nya. Satu karakter salah ketik di pubkey berarti authority hilang. Selalu pake `SetAuthorityChecked` kalau authority baru itu keypair.

**Kamu nggak bisa batalkan `--final`.** Nggak ada pemulihan. Nggak ada override admin. Nggak ada instruksi "gue salah nih". Instruksi `SetAuthority` butuh authority yang sekarang buat nandatangani. Saat authority yang sekarang `None`, nggak ada signer yang valid dan instruksi ditolak. Ini emang sengaja didesain begitu.

**PDA multisig atau governance nggak punya private key.** Satu-satunya cara buat bertindak sebagai authority adalah lewat proses approval program tersebut. Buat Squads, berarti musti penuhin threshold. Buat SPL Governance, berarti harus lolos voting dan nunggu timelock. Kamu nggak bisa ekstrak private key dari PDA karena memang nggak ada.

**Distribusi token governance itu vektor serangan.** Seekor ikan paus yang ngakumulasi 51% token governance bisa ngelolosin proposal upgrade apapun. Governance berbobot token cuma sedesentralisasi distribusi token-nya. Kalau satu entitas pegang mayoritas, teater governance cuma nambah latensi tanpa nambah keamanan.

**Setelah `--final`, kamu juga nggak bisa `Close` program.** Instruksi `Close` butuh authority buat nandatangani, sama kayak `Upgrade` dan `SetAuthority`. Saat authority `None`, program dan akun ProgramData-nya ada selamanya. SOL rent yang terkunci di akun ProgramData nggak bisa diklaim balik. Buat program besar, itu bisa nyampe 2 sampe 3 SOL.

---

### Mengikat semuanya

Bayangin semua bergerak. Kamu deploy sebuah program. Keypair deployer pegang upgrade authority. Byte 12 di akun ProgramData bernilai `1`, dan byte 13 sampe 44 nyimpen public key keypair itu. Satu orang bisa ganti bytecode.

Kamu transfer authority itu ke multisig Squads. Sekarang butuh approval M-of-N buat upgrade. Kamu pindahin ke SPL Governance. Sekarang butuh voting berbobo token. Setiap langkah nyempitin siapa yang bisa bertindak, dan setiap langkah sulit dibatalkan.

Terus kamu jalanin `--final`. Loader nulis `0` ke byte 12. Field authority 32-byte di-zero-in. Nggak ada instruksi yang bisa balikin. Program dibekuin secara permanen. Nggak ada kompromi key, nggak ada voting governance, nggak ada approval multisig yang bisa ubah lagi.

Progresinya cenderung sesuai tingkat kematangan protokol. Keypair pas ngembangin. Multisig pas peluncuran mainnet. Governance buat desentralisasi. Immutable buat infrastruktur yang seharusnya nggak pernah berubah. Jangan skip tahap.

`SetAuthorityChecked` itu ada karena dulu ada orang salah ketik alamat transfer. Satu salah ketik di `SetAuthority` sama permanennya dengan `--final`.

[Bagian 6](/id/posts/solana/solana-deployment-pipeline-local-to-mainnet/) bahas pipeline deployment lengkap dari pengujian lokal sampe mainnet.

---

### Referensi

- [Solana Program Deployment Docs](https://solana.com/docs/core/programs/program-deployment) - referensi instruksi loader-v3 dan mekanisme upgrade
- [solana-sdk/loader-v3-interface instruction.rs](https://github.com/anza-xyz/solana-sdk/blob/HEAD/loader-v3-interface/src/instruction.rs) - discriminator instruksi dan layout akun
- [Squads Protocol](https://docs.squads.so/) - alur kerja upgrade multisig dan praktik keamanan terbaik
- [SPL Governance](https://github.com/solana-labs/solana-program-library/tree/master/governance) - governance on-chain untuk upgrade program
- [solana-verify](https://github.com/Ellipsis-Labs/solana-verifiable-build) - verifikasi hash buffer untuk build yang bisa diverifikasi
- [SIMD-0432: Loader v3 Reclaim Closed Program](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0432-loader-v3-reclaim-closed-program.md) - perilaku instruksi close untuk program immutable
