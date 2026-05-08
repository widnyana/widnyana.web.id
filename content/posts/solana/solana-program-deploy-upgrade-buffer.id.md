---
title: 'Deploy, Upgrade, dan Pola Buffer Account'
date: 2026-05-02T10:00:00+07:00
description: "Deploy program Solana tidak bersifat atomik. Ini adalah rangkaian langkah yang melibatkan akun Buffer sementara, penulisan bytecode dalam potongan (chunk), dan langkah aktivasi akhir yang membuat atau mengganti program. Postingan ini membahas alur deploy dan upgrade secara lengkap, menjelaskan kenapa Buffer account ada, dan menunjukkan cara mengklaim kembali SOL saat deploy gagal di tengah jalan."
params:
  author: 'widnyana'
tags: ["solana", "blockchain", "web3", "bpf-loader", "program-deployment", "upgrades", "buffer-account"]
categories: ["solana", "blockchain"]
keywords: ["solana program deploy", "solana buffer account", "solana program upgrade", "solana program close buffers", "solana program write-buffer", "DeployWithMaxDataLen", "loader-v3 upgrade", "solana orphaned buffer", "solana-keygen recover buffer", "solana program extend"]
series: ["Solana Program Lifecycle"]
cover:
  image: "images/solana/solana-program-deploy-upgrade-buffer.png"
---

Ini Bagian 4 dari seri [Solana Program Lifecycle](/id/series/solana-program-lifecycle/). Di [Bagian 3](/id/posts/solana/solana-program-lifecycle-two-account-model/) kita udah bahas kalau satu program itu ternyata dua akun: Program Account 36-byte yang nge-point ke ProgramData Account yang nyimpen bytecode aslinya. Sekarang kita masuk ke bagian yang lebih seru: gimana kedua akun itu dibikin dan diganti.

Versi singkatnya: ada akun ketiga yang ikut campur. Akun sementara. Dia cuma ada selama deploy atau upgrade berlangsung, dan kalau ada yang nggak beres, dia bisa ngendon di chain nahan SOL lu sampai lu sadar dan klaim balik.

Akun ketiga itu adalah Buffer.

---

### Kenapa deploy bukan satu transaksi

Transaksi Solana punya batas keras 1232 byte. Itu sudah termasuk signature, message header, daftar akun, dan data instruksi. Setelah dikurangi overhead, payload instruksi yang bisa dipakai cuma sekitar 800 sampai 1000 byte per transaksi.

Program Anchor tipikal itu ukurannya 200KB sampai 500KB bytecode ELF yang udah dikompilasi. Hitung-hitungannya nggak bakal cocok. Nggak mungkin muat nge-load bytecode program beneran di satu transaksi.

Jadi Solana mutusin bagi kerjanya ke banyak transaksi. Bytecode ditaruh dulu di area penampungan, baru diaktifin di langkah terakhir. Area penampungan itulah Buffer Account.

Alurnya sama baik untuk deploy pertama kali maupun upgrade. Cuma langkah aktivasi doang yang beda.

```
Build file .so (offchain)
   |
   v
Buat akun Buffer onchain
   |
   v
Tulis bytecode dalam potongan (banyak transaksi)
   |
   v
Aktivasi: baik DeployWithMaxDataLen atau Upgrade
   |
   v
Buffer dikosongkan, lamports diteruskan
```

Setiap potongan itu transaksi terpisah. Setiap transaksi bayar fee. `solana program deploy` sih nyembunyiin semua ini dari lu, tapi sebenarnya dia jalanin puluhan sampai ratusan transaksi atas nama lu.

---

### Buffer account, secara detail

Buffer account itu cuma akun biasa, punya program BPF Loader Upgradeable, dengan layout tertentu. Ingat tabel discriminator dari [Bagian 3](/id/posts/solana/solana-program-lifecycle-two-account-model/):

| Nilai | Varian |
|-------|--------|
| 1 | `Buffer` |
| 2 | `Program` |
| 3 | `ProgramData` |

Sebuah Buffer punya header 37-byte diikuti byte program mentah:

```
[0..4]   u32 discriminator = 1
[4..5]   u8 option (1 = Some, 0 = None)
[5..37]  Pubkey authority_address (ada jika option = 1)
[37..]   byte program mentah (diunggah dalam potongan)
```

Field `authority_address` itu gerbangnya. Cuma buffer authority yang bisa nulis byte tambahan ke buffer, ngerubah buffer authority, atau make buffer buat deploy atau upgrade program. Kalau lu bikin buffer terus tinggal pergi, nggak ada orang lain yang bisa make buffer itu. Bytecode di dalamnya udah terkunci ke authority lu.

Buffer bayar rent buat ukuran penuhnya. Buffer 400KB nahan sekitar 2.79 SOL dalam lamport rent-exempt. SOL itu punya lu sih, tapi terkunci di buffer sampai langkah aktivasi ngosongin itu (jalur sukses) atau lu nutup buffer secara manual (kalau gagal).

---

### Alur deploy lengkap, instruksi per instruksi

Saat lu jalanin `solana program deploy ./target/deploy/program.so`, CLI ngejalanin urutan ini. Instruksi loader-v3 yang relevan didokumentasikan di `solana_loader_v3_interface::instruction`.

**Langkah 1: Buat akun Buffer.**

CLI manggil System Program buat alokasi akun kosong, ukurannya `37 + max_data_len` byte, didanai sampai rent-exempt. Terus manggil `InitializeBuffer` di loader, yang nulis discriminator dan authority ke 37 byte pertama.

```
System Program: CreateAccount -> akun kosong, dimiliki oleh loader v3
Loader v3:      InitializeBuffer -> ngatur discriminator dan authority
```

**Langkah 2: Tulis bytecode dalam potongan.**

CLI manggil `Write` berkali-kali. Setiap instruksi `Write` nerima offset sama potongan byte, terus nyalin ke buffer di offset tersebut. Setiap transaksi bawa satu instruksi `Write` dengan payload sebanyak yang muat di batas transaksi 1232 byte.

Buat program 400KB dengan kira-kira 900 byte payload per transaksi, itu sekitar 450 transaksi. CLI ngirimnya paralel kalau bisa, ngulang kalau gagal, sampai setiap byte berhasil mendarat.

Nah, ini bagian yang lama. Ini juga bagian yang paling sering gagal kalau jaringan lagi padet. Kalau RPC ngedrop beberapa transaksi ini, buffer bakal berakhir dengan lubang di dalamnya, dan langkah aktivasi bakal nolak bytecode tersebut.

**Langkah 3: Aktivasi dengan `DeployWithMaxDataLen`.**

Setelah buffer penuh, CLI ngirim satu transaksi terakhir dengan instruksi `DeployWithMaxDataLen`. Instruksi ini ngerjain beberapa hal secara atomik:

1. Bikin akun Program di alamat program ID.
2. Bikin akun ProgramData di PDA yang diturunkan.
3. Baca bytecode dari buffer, verifikasi ELF, dan salin ke akun ProgramData.
4. Atur `upgrade_authority_address` akun ProgramData ke siapa pun yang nandatangani.
5. Tandai akun Program sebagai `executable: true`.
6. Kosongin akun Buffer dan potong datanya. Lamports buffer nutup rent buat akun ProgramData baru.

Setelah transaksi tunggal ini mendarat, program udah aktif dong. Transaksi apa pun di slot berikutnya bisa manggil dia.

Akun-akun yang disentuh sama `DeployWithMaxDataLen`:

```
0. [writable, signer] Payer untuk akun ProgramData baru
1. [writable]         Akun ProgramData baru
2. [writable]         Akun Program baru
3. [writable]         Buffer (tempat bytecode diunggah)
4. []                 Rent sysvar
5. []                 Clock sysvar
6. []                 System program
7. [signer]           Upgrade authority program
```

Authority buffer harus cocok sama upgrade authority yang nandatangani deploy. Loader ngecek ini dan nolak deploy kalau beda. Ini yang ngehalang penyerang bikin buffer atas nama lu terus nyuruh lu deploy barangnya.

---

### Alur upgrade lebih pendek

Upgrade program yang udah ada itu make ulang Langkah 1 dan 2 dari alur deploy, persis sama. Satu-satunya perbedaan cuma di langkah aktivasi.

Daripada `DeployWithMaxDataLen`, CLI ngirim `Upgrade`. Dari sumber runtime:

> Saat `UpgradeableLoaderInstruction::Upgrade` diproses, runtime memverifikasi bahwa akun Program writable dan dimiliki oleh loader-v3, memverifikasi bahwa akun Buffer berisi state Buffer dengan authority yang benar, memverifikasi bahwa `upgrade_authority_address` akun ProgramData cocok dan bukan None, memverifikasi bahwa program belum di-deploy di slot saat ini, memuat dan memverifikasi byte ELF baru dari buffer, menyalin bytecode baru dari buffer ke akun ProgramData dan meng-nol-kan byte sisanya, mendanai akun ProgramData sampai rent-exempt, mengosongkan akun buffer dan memotong datanya.

Versi baru langsung berlaku di slot berikutnya (`deployment_slot + 1`).

Akun Program nggak berubah. Pointer `programdata_address` nggak berubah. Cuma bytecode di dalam akun ProgramData yang diganti. Semua yang nge-referensikan program ID sebelum upgrade tetap jalan setelahnya.

Instruksi `Upgrade` butuh akun keempat yang nggak ada di versi deploy: **spill account**. Lamports buffer pertama-tama nambah dana akun ProgramData sampai rent-exempt, dan sisanya mendarat di spill account. CLI ngatur defaultnya ke wallet deployer, jadi SOL-nya balik lagi, cuma lewat beberapa lompatan.

Tiga batasan yang harus lu inget:

1. **Buffer authority harus cocok sama upgrade authority program saat ini.** Loader nolak upgrade kalau beda. Ini kenapa lu nggak bisa upgrade program orang lain meskipun bisa bikin buffer dengan bytecode mereka.
2. **Lu nggak bisa upgrade dua kali di slot yang sama.** Pengecekan slot (`clock.slot != slot`) ngehalang ini. Kalau nyoba, lu bakal kena error dan harus nunggu slot berikutnya.
3. **Bytecode baru harus muat di akun ProgramData yang ada.** Kalau upgrade lu lebih besar dari `max_data_len` awal, lu harus perbesar program dulu pake `solana program extend`, yang butuh rent tambahan.

---

### Kenapa upload dipisahin dari aktivasi

Pola buffer kelihatannya kayak upacara tambahan yang ribet, tapi sebenarnya dia nyelesain tiga masalah nyata.

**Atomisitas.** Langkah aktivasi itu satu transaksi. Entah program berakhir dengan bytecode baru yang lengkap, atau nggak sama sekali. Nggak pernah ada momen di mana program punya setengah bytecode baru dan setengah yang lama. Buffer nge-akumulasi semua penulisan tanpa nyentuh program yang aktif, terus commit dalam satu tembakan.

**Multisig dan governance.** Pihak yang ngunggah bytecode dan pihak yang ngotorisasi deploy nggak harus sama. Seorang developer bisa nulis buffer pake hot wallet, transfer buffer authority ke multisig, terus minta multisig nyelesaiin instruksi `Upgrade`. Beginilah cara tim yang pake Squads atau SPL Governance ngirim upgrade.

Alurnya kayak gini nih:

```bash
# Developer mengunggah bytecode ke buffer
solana program write-buffer ./target/deploy/program.so

# Output: Buffer: <BUFFER_ADDRESS>

# Developer mentransfer buffer authority ke multisig
solana program set-buffer-authority <BUFFER_ADDRESS> \
  --new-buffer-authority <MULTISIG_ADDRESS>

# Anggota multisig mengusulkan dan menyetujui transaksi yang berisi
# instruksi loader-v3 Upgrade dengan buffer ini
```

Setelah multisig nandatangani upgrade, program ke-update dan lamports buffer ngalir ke spill address yang ditentuin proposal. Para penandatangan multisig nggak perlu ngurus bytecode mentah sendiri. Mereka cuma verifikasi hash buffer sebelum approve.

Buat build yang bisa diverifikasi, perintah `solana-verify get-buffer-hash <BUFFER_ADDRESS>` ngasih anggota multisig cara buat konfirmasi kalau buffer onchain cocok sama bytecode dari build yang diketahui.

**Isolasi kegagalan.** Kalau unggahan gagal di tengah jalan, program yang aktif nggak terpengaruh sama sekali. Buffer sih rusak, tapi akun ProgramData yang ada nggak tersentuh. Bayangin kalau modelnya potongan ditulis langsung ke akun ProgramData: unggahan parsial bakal nyisain program aktif dalam keadaan rusak. Berabe kan?

---

### Saat deploy gagal (dan itu emang sering terjadi)

Deploy di dunia nyata gagal lebih sering daripada yang diakui dokumentasi. Penyebab paling umum: kemacetan RPC, SOL nggak cukup di wallet deployer, dan masalah jaringan sementara pas fase penulisan berpotongan.

Saat deploy gagal di tengah jalan, lu bakal berakhir di salah satu dari tiga keadaan ini:

**Keadaan 1: Buffer udah dibuat tapi penulisan gagal.** Lu punya akun onchain yang nahan SOL rent dengan bytecode parsial atau bahkan tanpa bytecode sama sekali. CLI biasanya nyetak sesuatu kayak:

```
Error: Data writes to account failed: Custom program error
To recover the buffer, run `solana-keygen recover` and then
`solana program deploy --buffer <RECOVERED_BUFFER>`
```

**Keadaan 2: Semua penulisan berhasil tapi `DeployWithMaxDataLen` gagal.** Buffer udah lengkap tapi aktivasi nggak pernah terjadi. Jalur pemulihannya sama aja.

**Keadaan 3: Deploy sebenarnya berhasil tapi CLI crash sebelum nglapor.** Program udah aktif. Coba jalanin `solana program show <PROGRAM_ID>` buat konfirmasi.

Buat Keadaan 1 dan 2, lu punya dua opsi nih.

**Opsi A: Lanjutin dari buffer yang udah ada.** CLI nyetak recovery seed phrase pas bikin buffer. Pake `solana-keygen recover` buat bikin ulang keypair buffer, terus kembaliin ke perintah deploy:

```bash
solana-keygen recover -o recovered-buffer.json
# masukkan seed phrase yang dicetak oleh deploy yang gagal

solana program deploy ./target/deploy/program.so \
  --buffer recovered-buffer.json \
  --program-id <PROGRAM_KEYPAIR>
```

CLI cukup pintar buat skip potongan yang udah ditulis dan cuma ngisi yang hilang. Ini jalur yang murah sih. Lu cuma bayar penulisan yang nggak mendarat di percobaan pertama.

**Opsi B: Tutup buffer dan mulai dari awal.** Kalau buffer udah terlalu rusak, atau kalau lu cuma pengen mulai bersih, tutup aja:

```bash
# Daftar semua buffer yang dimiliki authority kamu
solana program show --buffers

# Tutup satu buffer tertentu
solana program close <BUFFER_ADDRESS>

# Atau tutup semuanya sekaligus
solana program close --buffers
```

Ini ngosongin SOL rent balik ke wallet lu. Setiap buffer biasanya nahan 2 sampai 3 SOL buat program ukuran normal, jadi biarin mereka bertebaran di chain itu mubazir banget.

Biaya percobaan ulang yang bersih adalah rent buat buffer baru ditambah fee transaksi buat penulisan. Buat program 400KB dengan 450 penulisan berpotongan di fee prioritas tipikal, itu kira-kira 0.02 SOL dalam fee di atas rent yang dikunci terus dikembalikan.

---

### Flag `--max-len` dan `extend`

Saat lu deploy pertama kali, akun ProgramData dibikin dengan ukuran tetap. Ukurannya berasal dari salah satu dua sumber:

1. Flag `--max-len` yang dikasih ke `solana program deploy`, kalau diatur.
2. Ukuran yang cukup buat nampung bytecode saat ini, kalau `--max-len` nggak disertakan.

Ukuran ini jadi batas atas buat upgrade in-place selanjutnya. Kalau bytecode lu tumbuh melewatinya, upgrade gagal dengan `account data too small for instruction` kecuali akun di-gedein dulu.

Versi CLI Solana modern otomatis ngeperbesar akun ProgramData selama redeploy kalau perlu, jadi nggak bakal kena kegagalan itu. Tapi alur multisig yang bikin instruksi `Upgrade` secara manual nggak punya safety net ini, jadi mereka harus manggil `solana program extend` sendiri sebelum upgrade bisa mendarat.

Lu bisa perbesar secara manual pake perintah `solana program extend`:

```bash
solana program extend <PROGRAM_ID> 10000
```

Ini nambah 10000 byte kapasitas ke akun ProgramData dan bayar rent tambahan dari wallet deployer. Nggak ada perintah buat ngecilin balik. ProgramData cuma bisa tumbuh, nggak bisa nyusut.

Pola umum buat proyek serius: deploy dengan nilai `--max-len` yang besar (misalnya, 2x binary saat ini) supaya upgrade di masa depan punya ruang tanpa perlu langkah extend. Tarifnya adalah ngunci SOL rent ekstra di awal. Imbalannya adalah upgrade jadi satu transaksi, bukan dua. Pilihan lu.

---

### Verifikasi alurnya sendiri

Lu bisa saksikan setiap langkah ini terjadi di devnet. Jalanin deploy dengan output verbose dan lu bakal ngelihat buffer dibikin, penulisan berpotongan, dan aktivasi akhir:

```bash
solana program deploy ./target/deploy/program.so --verbose
```

Atau pecah jadi langkah-langkah manual buat ngelihat buffer secara terpisah:

```bash
# Langkah 1 + 2: buat buffer dan tulis semua potongan, tapi jangan aktifkan
solana program write-buffer ./target/deploy/program.so

# Output: Buffer: <BUFFER_ADDRESS>

# Periksa buffer
solana account <BUFFER_ADDRESS>
solana program show <BUFFER_ADDRESS>

# Langkah 3: aktivasi dengan deploy dari buffer
solana program deploy --buffer <BUFFER_ADDRESS> \
  --program-id <PROGRAM_KEYPAIR>
```

Setelah deploy, jalanin `solana program show --buffers` lagi. Buffer udah ilang. Lamports-nya ditransfer selama aktivasi, dan loader motong datanya jadi nol.

---

### Apa yang sering bikin developer kaget

**Program ID yang ditutup nggak bisa dipake ulang.** Kalau lu jalanin `solana program close <PROGRAM_ID>`, program ID itu dipensiunkan secara permanen. Nyoba deploy program baru di alamat yang sama bakal gagal dengan `Program <ID> has been closed, use a new Program Id`. Ini disengaja. Ini ngehalang program ID lama, yang mungkin di-hardcode contract lain, dari diam-diam diganti bytecode baru.

**Nutup buffer bukan sama dengan nutup program.** `solana program close --buffers` cuma hapus akun Buffer, bukan akun Program atau ProgramData. Flag `--buffers` itu yang aman buat dijalanin rutin. Nutup akun program itu langkah yang nggak bisa dibatalkan, jadi hati-hati.

**Buffer authority default ke wallet deployer.** Kalau lu pengen multisig ngekontrol upgrade, lu harus eksplisit transfer buffer authority sebelum ngusulin transaksi upgrade. Lupa langkah ini bikin buffer terkunci ke hot wallet lu dan multisig nggak bisa make dia. Pusing nanti.

**Deploy bisa berhasil meskipun CLI lapor gagal.** Masalah jaringan kadang bikin CLI timeout nunggu konfirmasi, padahal transaksi aktivasi udah mendarat. Selalu jalanin `solana program show <PROGRAM_ID>` setelah deploy yang "gagal" sebelum nyoba lagi. Kalau nggak, lu bisa buang SOL senilai satu buffer lagi buat sesuatu yang sebenarnya udah sukses.

**`solana program deploy` dan `solana program upgrade` ngerjain hal yang kurang lebih sama.** Subcommand upgrade itu pembungkus tipis di atas alur yang sama, cuma dia skip pembuatan akun Program baru kalau udah ada. Kebanyakan orang pake `solana program deploy` buat keduanya sih. Dia otomatis milih instruksi aktivasi yang tepat berdasar apakah program ID udah ada atau belum.

---

### Mengikat semuanya

Yuk taruh semuanya jadi satu. Lu jalanin `solana program deploy`. Di balik layar, CLI bikin akun Buffer, nulis bytecode lu ke dalamnya lewat ratusan transaksi, terus ngirim satu instruksi aktivasi terakhir yang nyalin bytecode ke akun ProgramData dan ngosongin Buffer. Program udah aktif.

Kalau fase penulisan gagal, lu berakhir dengan Buffer yatang yang nahan SOL. Kalau aktivasi gagal, buffer udah lengkap tapi program nggak tersentuh. Dalam kedua kasus, program yang aktif nggak bermasalah. Pola Buffer ngisolasi kegagalan. `solana program close --buffers` ngembaliin SOL-nya.

Pemisahan upload-lalu-aktivasi punya efek samping yang berguna: pihak yang ngunggah bytecode nggak harus sama dengan pihak yang nge-approve deploy. Seorang developer nulis buffer, transfer authority-nya ke multisig, dan multisig approve upgrade. Pemisahan inilah yang bikin upgrade yang dikontrol tim dan governance jadi mungkin.

[Bagian 5](/id/posts/solana/solana-upgrade-authority-keypair-to-immutable/) bahas upgrade authority itu sendiri, dari keypair tunggal lewat multisig Squads dan SPL Governance, sampai ke flag `--final` yang nggak bisa dibatalkan dan nge-bekuin program selamanya.

---

### Referensi

- [Program Deployment, Solana Docs](https://solana.com/docs/core/programs/program-deployment)
- [Deploying Programs, Solana Docs](https://solana.com/docs/programs/deploying)
- [Loader v3 Instruction Reference (docs.rs)](https://docs.rs/solana-loader-v3-interface/latest/solana_loader_v3_interface/instruction/index.html)
- [UpgradeableLoaderState, solana-loader-v3-interface (docs.rs)](https://docs.rs/solana-loader-v3-interface/latest/solana_loader_v3_interface/state/enum.UpgradeableLoaderState.html)
- [solana-verify get-buffer-hash, Solana Verifiable Build](https://github.com/Ellipsis-Labs/solana-verifiable-build)
