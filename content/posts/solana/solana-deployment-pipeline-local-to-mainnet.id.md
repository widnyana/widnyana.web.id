---
title: 'Dari Lokal ke Mainnet: Pipeline Deployment'
date: 2026-05-08T10:00:00+07:00
description: "Men-deploy program Solana ke mainnet lebih dari sekedar menjalankan perintah deploy. Tulisan ini memetakan pipeline lengkap dari testing lokal dengan Surfpool, validasi di devnet, hingga deployment ke mainnet, termasuk biaya deployment, priority fees, verifikasi pasca-deploy, dan checklist pra-mainnet yang sering dilewatkan tutorial."
params:
  author: 'widnyana'
tags: ["solana", "blockchain", "web3", "deployment", "surfpool", "solana-verify", "devnet", "mainnet"]
categories: ["solana", "blockchain"]
keywords: ["solana deployment pipeline", "solana local testing surfpool", "solana devnet deployment", "solana mainnet deployment", "solana-verify verifiable build", "solana program dump", "solana priority fees deploy", "solana deployment checklist", "surfpool vs solana-test-validator"]
series: ["Solana Program Lifecycle"]
cover:
  image: "/images/solana/solana-deployment-pipeline-local-to-mainnet.png"
---

Ini Bagian 6 dari seri [Solana Program Lifecycle](/id/series/solana-program-lifecycle/). Di [Bagian 5](/id/posts/solana/solana-upgrade-authority-keypair-to-immutable/) kita bahas soal upgrade authority, dari keypair tunggal, multisig Squads, SPL Governance, sampai flag `--final` yang udah nggak bisa di-undo lagi. Sekarang kita mundur dikit dan liat gambaran besarnya: gimana sih program kamu bergerak dari file di laptop jadi bytecode yang beneran hidup di mainnet.

Jawaban singkatnya: bukan cuma `solana program deploy` doang. Perintah deploy itu langkah terakhir, bukan keseluruhan proses. Dev yang langsung lompat ke mainnet biasanya nyadarinya pas upload buffer parsial macet jam 3 pagi, atau pas CPI yang sempurna di lokal diam-diam gagal karena akun yang dibutuhkan ternyata nggak pernah ada di mainnet.

---

### Pipeline-nya

Progresi standarnya tiga environment: lokal, devnet, mainnet.

```
Lokal (Surfpool)       Devnet             Mainnet
────────────────────   ─────────────────  ──────────────────────
Iterasi tercepat       Jaringan nyata     Uang nyata
SOL palsu              SOL palsu          SOL nyata
State mainnet          State devnet       State mainnet
Tanpa latensi          ~400ms per slot    ~400ms per slot
Cheatcode tersedia     Tanpa cheatcode    Tanpa cheatcode
```

Testnet? Opsional sih. Solana Foundation pakai itu buat testing validator. Mayoritas dev aplikasi langsung skip aja. Devnet itu checkpoint yang bener-bener penting sebelum mainnet.

---

### Testing lokal dengan Surfpool

`solana-test-validator` (juga tersedia sebagai `solana local-validator` di versi CLI yang lebih baru) udah usang. Tool testing lokal yang sekarang adalah [Surfpool](https://docs.surfpool.run/), di-maintain langsung sama Solana Foundation.

Bedanya yang paling kerasa itu di soal state. `solana-test-validator` itu jalanin jaringan terisolasi, nggak punya akses ke data akun nyata. Mau ngetes CPI ke Jupiter? Harus clone puluhan akun dan program secara manual dulu sebelum satu test pun bisa jalan. Capek banget. Surfpool itu jaringan yang di-fork secara lazy: dia ngambil data akun mainnet (atau devnet) on-demand pas transaksi kamu ngaksesnya. Akses pertama ke akun yang belum ada di lokal akan trigger fetch data. Akses berikutnya baca dari salinan lokal yang udah di-cache.

Install-nya satu baris, terus arahin Solana CLI ke RPC lokal yang jalan di port 8899:

```bash
curl -sL https://run.surfpool.run/ | bash
surfpool start
solana config set --url localhost
```

Dashboard Studio bisa diakses di `http://127.0.0.1:18488` setelah Surfpool jalan.

Buat project Anchor, `Anchor.toml` kamu seharusnya udah ngarahin cluster lokal ke `http://localhost:8899`. Buat test suite Anchor, pakai flag kompatibilitas ini:

```bash
surfpool start --legacy-anchor-compatibility
```

**Cheatcode** itu metode RPC khusus yang Surfpool sediain buat development. Ini nggak ada di jaringan nyata ya.

- `surfnet_setAccount`: atur lamports, data, owner, dan flag executable di akun apapun
- `surfnet_setTokenAccount`: atur saldo akun SPL token, delegate, dan state
- `surfnet_resetAccount`: balikin akun ke state mainnet aslinya

Time travel juga tersedia lewat cheatcode (`surfnet_timeTravel`, `surfnet_pauseClock`, `surfnet_resumeClock`) dan lewat UI Studio. Berguna banget buat apapun yang baca `Clock::get()`: jadwal vesting, lockup, distribusi reward berbasis epoch.

Studio (di `http://127.0.0.1:18488`) nampilin detail transaksi, byte akun sebelum dan sesudah tiap instruksi, profil compute unit per instruksi, plus faucet live namanya "The Heist" yang bisa danai akun apapun dengan token apapun secara instan, tanpa batas rate. Mantap kan.

Buat fork dari RPC tertentu alih-alih endpoint publik default, pakai `--rpc-url`:

```bash
surfpool start --rpc-url https://your-private-rpc.example.com
```

Endpoint publik default cukup buat testing dengan traffic rendah, tapi ada batas rate-nya. Buat forking mainnet yang lebih berat, pakai RPC privat dari Helius, QuickNode, atau Triton.

---

### Devnet: ngetes pipeline deployment yang beneran

Devnet itu bukan environment lokal lagi ya. Devnet jalanin flow deploy yang sama persis dengan mainnet, artinya dia ngetes edge case yang sama: chunked write, pembuatan buffer account, instruksi aktivasi, penanganan priority fee. Masalah yang cuma muncul di pipeline deploy beneran bakal keliatan di sini, dan untungnya pakai SOL palsu.

Pindah cluster:

```bash
solana config set --url devnet
```

Ambil SOL devnet:

```bash
solana airdrop 2
```

Deploy:

```bash
anchor build
solana program deploy ./target/deploy/your_program.so
```

Setelah deploy devnet berhasil, jalanin test suite integrasi lengkap kamu ke devnet. Kalau ada test yang lolos di lokal pakai Surfpool tapi gagal di devnet, bedanya hampir pasti salah satu dari ini:

- Akun yang kamu anggap ada ternyata nggak ada di devnet
- Logika yang bergantung ke clock atau slot berperilaku beda di timing nyata
- Priority fee terlalu rendah buat kondisi kemacetan devnet

Biasanya orang kelewat ini: devnet di-reset secara berkala. Program yang di-deploy di sana bakal hilang pas reset. Jangan perlakukan state devnet sebagai sesuatu yang permanen.

---

### Berapa biaya deploy sebenarnya

Biaya deploy itu dominan sama rent, bukan fee. Program Account isinya cuma 36 byte data pointer. ProgramData Account yang nyimpen bytecode lengkap, dan di situlah biaya benerannya ada.

Cek minimum rent-exempt buat ukuran apapun:

```bash
solana rent <BYTES>
```

Header ProgramData account itu 45 byte. Buat binary program 200KB:

```bash
solana rent 200045
# Rent-exempt minimum: 1.39644696 SOL
```

Buat program 400KB:

```bash
solana rent 400045
# Rent-exempt minimum: 2.79261672 SOL
```

SOL itu bukan fee ya. SOL itu dikunci di ProgramData account sebagai rent-exemption. Kalau nanti kamu tutup program, SOL itu dikembalikan ke authority. Kalau kamu jadiin immutable (udah kita bahas di [Bagian 5](/id/posts/solana/solana-upgrade-authority-keypair-to-immutable/)), SOL itu terkunci secara permanen.

Selama fase upload, deploy juga bikin Buffer account sementara yang ukurannya sama dengan bytecode ditambah header 37 byte. Pas langkah aktivasi, buffer dikosongin dan lamports-nya ditransfer ke ProgramData account, jadi kamu nggak bayar keduanya bareng-bareng. Biaya rent net-nya cuma satu akun.

Selain rent, deploy juga ngirim puluhan sampai ratusan transaksi (satu per chunk bytecode). Tiap transaksi bayar base fee 5000 lamports. Buat program 400KB dengan kira-kira 450 transaksi, total base fee sekitar 2.250.000 lamports (0,00225 SOL). Priority fee nambah ke biaya itu tergantung kondisi jaringan.

---

### Priority fee saat deploy

Mainnet lebih ramai dari devnet. Transaksi yang lancar di devnet bisa macet atau gagal di mainnet kalau priority fee-nya kebawah.

Perintah deploy nerima harga compute unit:

```bash
solana program deploy ./target/deploy/your_program.so \
  --with-compute-unit-price 50000
```

Nilainya dalam microlamport per compute unit. Transaksi deploy tipikal pakai sekitar 3.000 sampai 5.000 compute unit. Dengan 50.000 microlamport per CU, priority fee per transaksi sekitar 150.000 sampai 250.000 microlamport (0,00000015 sampai 0,00000025 SOL). Buat 450 transaksi, itu nambah kira-kira 0,00007 sampai 0,0001 SOL ke total biaya. Kecil sih secara dolar, tapi cukup buat dorong transaksi melewati antrean tanpa fee.

Pas periode kemacetan tinggi, 50.000 microlamport mungkin kurang. Cek level fee saat ini:

```bash
solana fees --url mainnet-beta
```

Atau pakai API priority fee dari provider RPC kamu, yang ngasih estimasi per-persentil berdasar transaksi yang baru saja berhasil.

Buat flow write-buffer-then-upgrade yang dipakai di setup multisig dan governance, atur harga compute unit di langkah write-buffer juga:

```bash
solana program write-buffer ./target/deploy/your_program.so \
  --with-compute-unit-price 50000
```

Fase write punya lebih banyak transaksi daripada langkah aktivasi. Kalau transaksi write macet, kamu bakal dapet buffer yatim yang nahan SOL. Jadi jangan cuma pasang priority fee di deploy aja dong.

---

### Flag `--max-len`

Udah dibahas di [Bagian 4](/id/posts/solana/solana-program-deploy-upgrade-buffer/), tapi perlu ditegaskan lagi nih. Pas pertama kali deploy, ProgramData account diukur persis sesuai bytecode saat ini. Upgrade berikutnya yang lebih besar dari ukuran itu bakal gagal kecuali kamu panggil `solana program extend` dulu, atau kecuali CLI modern yang auto-extend (yang nggak kamu dapet secara otomatis di flow multisig).

Deploy dengan ruang cadangan:

```bash
solana program deploy ./target/deploy/your_program.so \
  --max-len 600000
```

Ini ngalokasiin 600.000 byte meskipun binary saat ini 400.000 byte. Biayanya:

```bash
solana rent 600045
# Rent-exempt minimum: ~4.18893 SOL
```

dibanding deploy dengan ukuran pas:

```bash
solana rent 400045
# Rent-exempt minimum: ~2.79262 SOL
```

Kira-kira 1,4 SOL ekstra yang terkunci buat ngindarin transaksi extend di masa depan. Apakah tradeoff ini sepadan, tergantung seberapa sering kamu rencana upgrade dan apakah flow upgrade kamu nyangkut proposal multisig yang butuh langkah extend terpisah.

---

### Verifikasi pasca-deploy

Setelah deploy ke mainnet, pastiin bytecode on-chain cocok dengan yang kamu build di lokal. Pengecekan dasarnya gini:

```bash
# Dump bytecode on-chain
solana program dump <PROGRAM_ID> on-chain-dump.so --url mainnet-beta

# Bandingkan hash
sha256sum on-chain-dump.so
sha256sum ./target/deploy/your_program.so
```

Kalau hash-nya cocok, binary yang bener udah di-deploy. Kalau nggak cocok, berarti kamu ke-deploy file yang salah atau build-nya nggak deterministik.

`solana program dump` ngambil bytecode mentah dari ProgramData account, nge-strip header 45 byte, terus nulis byte ELF ke sebuah file. Hasilnya harus identik byte-per-byte dengan binary yang kamu deploy.

---

### Verifiable build dengan `solana-verify`

Pengecekan SHA-256 ngebuktikan kalau kamu bisa bikin ulang binary yang sama. Tapi ini nggak ngebuktikan kalau orang lain juga bisa, atau kalau source code di repo kamu cocok dengan binary yang di-deploy.

Verifiable build nyelesain ini lewat proses build deterministik berbasis Docker. Environment build di-pin: toolchain Rust yang sama, toolchain Solana yang sama, dependensi yang sama. Siapapun bisa bikin ulang binary dari commit source yang sama.

Install:

```bash
cargo install solana-verify
```

Build binary verifiable:

```bash
solana-verify build --library-name your_program
```

Ini jalan di dalam container Docker yang di-pin. Binary hasilnya ada di `target/deploy/your_program.so`.

Ambil hash binary lokal:

```bash
solana-verify get-executable-hash ./target/deploy/your_program.so
```

Ambil hash program on-chain (`-um` itu singkatan dari mainnet):

```bash
solana-verify get-program-hash -um <PROGRAM_ID>
```

Keduanya harus cocok. Kalau nggak, kemungkinan kamu ke-deploy binary yang beda atau kamu jalanin build non-verifiable setelah `solana-verify build`.

Buat daftarin verifikasi on-chain biar siapapun bisa verifikasi secara trustless tanpa harus jalanin build sendiri:

```bash
solana-verify verify-from-repo \
  --program-id <PROGRAM_ID> \
  -um \
  https://github.com/your-org/your-repo
```

Ini bikin PDA buat program verify yang nyimpen git URL, commit hash, dan argumen build. API verifikasi publik OtterSec baca PDA ini dan bikin status verifikasi bisa di-query dari Solana Explorer dan tooling lainnya. Setelah terdaftar, halaman Explorer program bakal nampilin badge verified.

Yang jadi kendala praktisnya itu waktu build. Build berbasis Docker bisa makan sampai 30 menit di Apple Silicon karena emulasi x86. Di mesin Linux x86 native, jauh lebih cepat. Kalau kamu build di CI, perhitungkan ini dalam perencanaan waktu pipeline ya.

---

### Checklist pra-mainnet

**Build dan binary:**
- [ ] Build pakai `solana-verify build` kalau kamu rencana ngirim verified build, bukan `anchor build`
- [ ] Hash binary sebelum deploy: `sha256sum ./target/deploy/your_program.so`
- [ ] Cek ukuran binary: `ls -lh ./target/deploy/your_program.so`
- [ ] Jalanin `solana rent <bytes>` buat ukuran ProgramData dan pastiin wallet kamu cukup

**Persiapan cluster:**
- [ ] Pindah ke mainnet: `solana config set --url mainnet-beta`
- [ ] Konfirmasi wallet deployer dan saldonya: `solana address` terus `solana balance`
- [ ] Cek fee saat ini dan pilih nilai `--with-compute-unit-price`: `solana fees --url mainnet-beta`

**Authority:**
- [ ] Tentuin upgrade authority awal sebelum deploy (default-nya keypair deployer)
- [ ] Kalau pakai multisig: siapin alamat Squad PDA buat di-transfer segera setelahnya
- [ ] Jangan biarin hot keypair jadi upgrade authority lebih lama dari yang diperlukan

**Deploy:**
- [ ] Pakai `--max-len` kalau kamu perkirain program bakal berkembang
- [ ] Catat alamat buffer kalau deploy gagal di tengah jalan (CLI bakal nyetaknya)

**Verifikasi:**
- [ ] Konfirmasi authority: `solana program show <PROGRAM_ID> --url mainnet-beta`
- [ ] Dump dan hash binary on-chain, bandingin dengan binary lokal (liat "Verifikasi pasca-deploy" di atas)
- [ ] Kalau pakai verifiable build: jalanin `solana-verify verify-from-repo` dan konfirmasi hash-nya cocok

**Transfer authority:**
- [ ] Transfer ke multisig: `solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <SQUAD_PDA>`
- [ ] Konfirmasi transfer: `solana program show <PROGRAM_ID> --url mainnet-beta`

---

### Hal-hal yang sering menjebak developer

**`solana-test-validator` ngasih kepercayaan palsu.** Dia jalan dalam isolasi. CPI ke protokol nyata gagal karena program dan akunnya emang nggak ada di sana. Surfpool ngekspos kelas kegagalan ini secara lokal sebelum sampai ke devnet atau mainnet.

**Wallet deployer butuh lebih banyak SOL dari yang lu kira.** Rent buffer ditambah rent ProgramData bisa lebih dari 3 SOL buat program ukuran normal. Tambahin fee transaksi, priority fee, dan margin keamanan. Datang ke mainnet dengan 3 SOL terus program butuh 2,8 SOL, cuma butuh satu gangguan jaringan doang sebelum deploy parsial yang perlu pemulihan.

**Priority fee pengaruhi fase write, bukan cuma aktivasi.** Ada ratusan transaksi write. Kalau macet, kamu dapet buffer yatim yang nahan SOL terkunci. Setel `--with-compute-unit-price` di `write-buffer` maupun `deploy`.

**Build yang kamu tes nggak selalu build yang kamu deploy.** Jalanin `anchor build` setelah `solana-verify build` bakal nimpa binary verified dengan binary yang nggak deterministik. Kalau niatnya ngirim verified build, deploy binary yang dihasilkan `solana-verify build`, dan jangan rebuild di antara itu sama perintah deploy.

**Transfer authority itu nggak otomatis.** Setelah deploy mainnet pertama kali, upgrade authority adalah keypair deployer. Biarin di situ itu risiko dong. Transfer ke multisig sebelum kamu tutup sesi.

**Devnet dan mainnet bisa berbagi program ID yang sama.** `Anchor.toml` pakai section terpisah buat localnet, devnet, dan mainnet, tapi semuanya bisa ngarah ke file keypair yang sama. Ini disengaja buat project yang mau alamat yang sama di seluruh cluster. Ini juga jadi jebakan kalau kamu keliru soal cluster yang sedang ditarget pas jalanin `anchor deploy`.

---

### Mengikat semuanya

Perintah deploy itu lima detik terakhir dari proses yang butuh perencanaan. Surfpool buat iterasi lokal, devnet buat validasi pipeline end-to-end, mainnet buat produksi. Tiap environment nangkap sesuatu yang nggak bisa ditangkap environment sebelumnya.

Kejutan menit-menit akhir yang paling sering terjadi itu soal SOL. Rent itu biayanya, bukan fee. Program 400KB ngunci 2,79 SOL sebelum satu pun transaksi pengguna jalan. Jalanin `solana rent` sebelum kamu mulai, bukan setelah upload buffer macet.

Upgrade authority dimulai sebagai keypair deployer. Transfer sebelum kamu tutup terminal. [Bagian 5](/id/posts/solana/solana-upgrade-authority-keypair-to-immutable/) bahas apa yang terjadi kalau kamu lupa.

---

### Referensi

- [Surfpool Documentation](https://docs.surfpool.run/) - environment testing lokal dan IaC untuk Solana
- [Surfpool CLI Basics, Solana Docs](https://solana.com/docs/intro/installation/surfpool-cli-basics) - dokumentasi resmi Solana untuk perintah Surfpool
- [Deploying Programs, Solana Docs](https://solana.com/docs/programs/deploying) - workflow dan flag CLI deploy
- [Verified Builds, Solana Docs](https://solana.com/docs/programs/verified-builds) - workflow verifiable build dan pendaftaran on-chain
- [solana-verify CLI (Ellipsis Labs)](https://github.com/Ellipsis-Labs/solana-verifiable-build) - sumber tool original dan rilis
- [solana-verify CLI (Solana Foundation)](https://github.com/solana-foundation/solana-verifiable-build) - fork yang di-maintain Solana Foundation
- [Program Deployment, Solana Docs](https://solana.com/docs/core/programs/program-deployment) - referensi instruksi loader-v3
