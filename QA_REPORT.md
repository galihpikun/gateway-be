# Gateway QA Report

## Round 2 Summary

21 November 2026 (WIB) · Branch `qa/full-audit-and-fix` pada backend, web, dan mobile.

**READY_WITH_WARNINGS.** Semua 13 temuan audit awal sudah diperbaiki dan ter-push. Dua temuan tambahan selama verifikasi juga diperbaiki, yaitu akses tier yang belum dipublikasikan dan pembacaan hasil pencarian staf di mobile. Total yang ditangani **15 ditemukan, 15 diperbaiki dan ter-push, 0 bug kode yang masih terbuka dari cakupan audit**.

### Fixed Bugs Report · Ronde 2

- **QA-006 · High · Backend.** Penerbitan OTP belum menerapkan jeda per email dan jenis, sementara penggunaan OTP dan perubahan akun dapat tersimpan terpisah. Jeda 60 detik dan batas lima kesalahan kini tersimpan di PostgreSQL. Konsumsi OTP dan perubahan akun dilakukan dalam satu transaksi. Kode kedaluwarsa atau habis pakai mengembalikan 400 dan pembatasan percobaan mengembalikan 429. Implementasi di `gateway-be/src/service/otpService.js:23` dan `gateway-be/src/service/otpService.js:57`. Regresi di `gateway-be/test/qa-r2-otp.test.js:9` dan `:30` meliputi alamat yang dinormalisasi, kedaluwarsa dan penggunaan ulang pada kedua jenis OTP, serta lima percobaan salah. Push lulus. [BE 9ecdd76](https://github.com/galihpikun/gateway-be/commit/9ecdd76af79ad3dfbe011607e671bb4cde94ebf7)
- **QA-007 · High · Backend.** Dokumen organizer yang baru diunggah sebelumnya mendapat URL publik. Upload baru memakai delivery `authenticated`. Admin atau organizer pemilik menerima tautan bertanda tangan selama 10 menit dengan respons `private, no-store`. URL lama diteruskan untuk kompatibilitas. Implementasi di `gateway-be/src/service/cloudinaryService.js:24` dan `gateway-be/src/controllers/organizerController.js:7`. Regresi di `gateway-be/test/workflow.test.js:55` mencakup opsi tanda tangan, persistensi upload, respons pemilik dan admin, serta pembacaan URL lama dengan Cloudinary simulasi. Push lulus. [BE 51544ff](https://github.com/galihpikun/gateway-be/commit/51544ff23cd1713f20b42105a284cf53431053b8) [Cloudinary media access control](https://cloudinary.com/documentation/control_access_to_media)
- **QA-008 · High · Backend, web, mobile.** Permintaan refund `PENDING_APPROVAL` masih menahan scan setelah acara mulai. Scan kini menolak permintaan lama tersebut dengan alasan sistem dan meneruskan check-in jika tiket memenuhi syarat. Status `APPROVED`, `PROCESSING`, dan `SUCCEEDED` tetap menahan tiket. Dompet tiket web dan mobile menampilkan alasan ketika penguncian berlaku. Implementasi di `gateway-be/src/controllers/ticketRedemptionController.js:172`, `gateway-be/src/service/issuedTicketService.js:10`, `gateway-fe/src/app/my-tickets/page.tsx:259`, dan `gateway-mobile/src/components/TicketDialog.tsx:12`. Regresi di `gateway-be/test/workflow.test.js:286` mencakup status terkunci sebelum konser dan scan setelah refund kedaluwarsa. Tiga push lulus. [BE c066029](https://github.com/galihpikun/gateway-be/commit/c066029334544af5a7eda2b490b49b6f491a7891) [Web b75b814](https://github.com/RezaAdityaRamadhan26/gateway-fe/commit/b75b814ca7f2cce1c7f44dd8e0c2fbc91c17d75c) [Mobile e0e36b2](https://github.com/galihpikun/gateway-mobile/commit/e0e36b2ddf5f4c5305c8e0d29e9785d980265ff0)
- **QA-009 · Medium · Backend, web, mobile.** Checkout Rp0 masih berusaha membuat sesi Xendit. Order gratis kini disimpan sebagai `PAID` dengan metode `FREE` dan `paymentUrl: null`. Kuota, tiket dan antrean email masuk dalam transaksi yang sama. Pembatalan konser menonaktifkan tiket gratis tanpa memanggil refund Xendit. Klien menampilkan CTA gratis dan memakai tampilan konfirmasi order. Implementasi di `gateway-be/src/controllers/orderController.js:247`, `gateway-be/src/service/refundService.js:746`, `gateway-fe/src/app/events/[id]/checkout/page.tsx:134`, dan `gateway-mobile/src/app/checkout/[id].tsx:107`. Regresi di `gateway-be/test/workflow.test.js:312` mencakup order, tiket, kuota, antrean email, dan pembatalan tanpa provider. Tiga push lulus. [BE b0d119f](https://github.com/galihpikun/gateway-be/commit/b0d119f263abb0cae9131ad952fa9d98b6bf02a7) [Web 2dfdb3f](https://github.com/RezaAdityaRamadhan26/gateway-fe/commit/2dfdb3fc09a9e8f35cbe9b99816c4eb5ca5c9a6a) [Mobile d18b762](https://github.com/galihpikun/gateway-mobile/commit/d18b7628e91bdfa75f3459b5964f213d70e21d52)
- **QA-012 · Medium · Web.** Gagal refresh sesi karena gangguan API atau koneksi sebelumnya menghapus token. Web kini menghapus sesi hanya setelah API mengembalikan 401 atau 403, menyediakan percobaan ulang saat gangguan sementara, dan mengabaikan refresh yang sudah kedaluwarsa karena logout atau perubahan sesi. Implementasi di `gateway-fe/src/context/AuthContext.tsx:59` dan `gateway-fe/src/lib/sessionRefresh.ts:1`. Regresi di `gateway-fe/test/sessionRefresh.test.mjs` meliputi 503, kegagalan jaringan, status penolakan sesi, dan urutan refresh/logout. Push lulus. [Web 52e754b](https://github.com/RezaAdityaRamadhan26/gateway-fe/commit/52e754bade405a185814d7e497cca2b5ce650b37)
- **QA-011 · Medium · Backend.** Perubahan zona dan tier membaca status event di luar penguncian yang dipakai review. Ubah layout, mutasi tier, submit, approve, dan reject kini memeriksa event setelah memperoleh kunci baris yang sama. Implementasi di `gateway-be/src/utils/eventLock.js:7`, `gateway-be/src/controllers/eventController.js:349`, `:398`, `:559`, `:676`, dan `gateway-be/src/controllers/ticketTypeController.js:78`. Regresi di `gateway-be/test/qa-r2-event-lock.test.js:8` menahan baris event di PostgreSQL, menjalankan edit dan submit secara paralel, lalu memeriksa hasil persetujuan. Push lulus. [BE 121faab](https://github.com/galihpikun/gateway-be/commit/121faabfcb2673869c2e7a26368e2ee92bc0821e)
- **QA-010 · Medium · Backend.** Ganti atau hapus media sebelumnya menyisakan aset lama, termasuk upload baru saat penyimpanan gagal. Setelah commit, aset lama dihapus bila ID sudah tidak direferensikan. Jika upload sempat berhasil dan penyimpanan gagal, aset baru dibersihkan. Kegagalan hapus dicatat sebagai warning. Implementasi di `gateway-be/src/service/eventMediaService.js:32`, `gateway-be/src/controllers/eventController.js:379`, dan `gateway-be/src/service/cloudinaryService.js:14`. Regresi di `gateway-be/test/workflow.test.js:156` mencakup kompensasi, aset bersama, penghapusan sesudah commit, dan kegagalan provider simulasi. Push lulus. [BE 620af6a](https://github.com/galihpikun/gateway-be/commit/620af6aa61456263f1f9fb6720dbdede48499fe2)
- **QA-013 · Medium · Backend, web, mobile.** Endpoint daftar memakai parsers yang berbeda serta batas yang tidak seragam. Parser bersama menerapkan page 1, limit 20, maksimum 100, dan HTTP 400 untuk nilai tidak valid. Bentuk respons tanpa parameter tetap kompatibel. Katalog web dan mobile meminta daftar tanpa pagination server karena katalog sudah melakukan pencarian dan paging lokal. Implementasi di `gateway-be/src/utils/paginate.js:15`, `gateway-be/src/controllers/orderController.js:330`, `gateway-be/src/service/issuedTicketService.js:98`, `gateway-fe/src/lib/api.ts:242`, dan `gateway-mobile/src/lib/api.ts:204`. Regresi di `gateway-be/test/unit.test.js:18` dan `gateway-be/test/workflow.test.js:118` mencakup nilai batas, 15 rute daftar, dan kontrak lama tanpa pagination. Tiga push lulus. [BE d49c2dc](https://github.com/galihpikun/gateway-be/commit/d49c2dc35019b973148aa804e3359e5f5b8d762f) [Web a4ef158](https://github.com/RezaAdityaRamadhan26/gateway-fe/commit/a4ef158082d6e0fe6f6141e9ff63465e37a0acc1) [Mobile 5ba3a6d](https://github.com/galihpikun/gateway-mobile/commit/5ba3a6d8015edd9292cf04b44d53dabec9a43e30)

### Temuan tambahan yang diperbaiki

- **Visibilitas tier sebelum publikasi.** Dua endpoint baca tier tidak menerapkan visibilitas event. Kini tier event yang belum tersedia untuk publik hanya ditampilkan bagi pemilik dan admin. Tier pada event terbit yang masih aktif dapat dibaca tanpa login. Implementasi di `gateway-be/src/controllers/ticketTypeController.js:8`. Regresi PostgreSQL di `gateway-be/test/qa-r2-runtime.test.js:149` mencakup draft dan event terbit. Push lulus. [BE 55125f4](https://github.com/galihpikun/gateway-be/commit/55125f486c123458a372465ff9dfaf8c8f2854ef)
- **Pencarian staf di mobile.** Klien memperlakukan respons pagination sebagai array. Sekarang fungsi API mengambil `data` sebagai daftar dan masih menerima array lama. Implementasi di `gateway-mobile/src/lib/api.ts:297`. Kontrak halaman diverifikasi lewat integrasi HTTP backend, kemudian typecheck, lint dan export mobile lulus. Push lulus. [Mobile 3029510](https://github.com/galihpikun/gateway-mobile/commit/30295102ee124407bb46df5717d9949b5856f3d5)

### Role-by-Role Coverage Matrix · Ronde 2

- **USER.** Login, pemblokiran login baru dan JWT lama saat disuspend, lalu pemulihan akses. Checkout gratis menerbitkan tiket dan antrean email. Lima checkout independen untuk kuota dua menghasilkan dua respons 201 dan tiga 409. PostgreSQL mencatat dua tiket terjual dan kuota nol.
- **ORGANIZER.** Suspend dan unsuspend berlaku untuk sesi lama maupun login baru. Tes PostgreSQL mencakup pemilik dibanding organizer kedua untuk detail, edit, submit, tier, staf, dan daftar refund. Pembatalan event dan keputusan refund ada di rute admin. Penghapusan event tidak memiliki rute dan menghasilkan 404. Tier event publik tetap dapat dibaca tanpa login.
- **STAFF.** Suspend dan unsuspend diverifikasi. Undangan belum aktif dan penugasan event berbeda ditolak pada lookup dan redeem. Lima scan bersamaan untuk satu tiket menghasilkan satu 200 dan empat 409. Status redeemed tersimpan di PostgreSQL.
- **ADMIN.** Tes persetujuan dan penolakan per dokumen memeriksa status serta alasan yang disimpan. Tes memeriksa satu baris audit untuk setiap aksi yang diuji, termasuk dokumen, organizer, event, suspend/unsuspend, dan approve/reject refund.

Suite terpisah memakai fixture berlabel `qa_r2_` dan provider simulasi. Regresi OTP kedaluwarsa, penggunaan ulang, cooldown, dan batas percobaan ada pada suite QA-006. Push suite lulus. [BE 4d444ca](https://github.com/galihpikun/gateway-be/commit/4d444ca1a2663b465386f1df0145ba6e04ad2964)

### Verifikasi akhir

- **Backend** lulus `npm test`, 26 lulus, 0 gagal, 0 dilewati. Pemeriksaan setelah smoke menemukan 0 fixture `qa_r2_` tersisa pada tabel yang diperiksa. Tidak ada perubahan tercatat pada `generated/prisma/` atau migrasi.
- **Web** lulus `node --test test/*.test.mjs` dengan 3 lulus, 0 gagal, 0 dilewati. Typecheck, lint dan build produksi lulus, termasuk 22 dari 22 halaman statis.
- **Mobile** lulus typecheck, `npm run lint` dan Expo export untuk Android dan iOS.
- **Smoke lokal** memakai backend loopback 3198 dan preview produksi Next.js 3199. Browser diarahkan ke backend QA pada sesi terisolasi, dengan GET dan login fixture sebagai satu-satunya permintaan yang diizinkan. Katalog terisi, detail dan pilihan tiket gratis tampil, tamu diarahkan ke login, lalu checkout menampilkan form Data pembeli dan tombol **Ambil tiket gratis**. Pada viewport 390 px, lebar dokumen tetap 390 px. Pesanan tidak disubmit di browser. Penerbitan order gratis diuji di suite backend. Kedua listener QA dihentikan dan fixture smoke dihapus.

Log regresi mencakup kegagalan hapus media dan retry email yang sengaja disimulasikan. Driver PostgreSQL masih mengeluarkan warning deprecation saat query paralel berbagi koneksi, tanpa kegagalan pada rangkaian tes ini.

### Remaining / Unresolved dan release readiness

**0 bug kode terbuka dari temuan audit.** Verifikasi yang masih diperlukan untuk produksi mencakup pemindaian QR dengan kamera fisik Android/iOS, akses picker upload pada perangkat nyata, pembayaran dan webhook Xendit sandbox, pengiriman email QR dengan domain Resend terverifikasi, serta akses dokumen dan penghapusan media pada akun Cloudinary yang sesungguhnya. Dokumen lama masih menggunakan URL publik warisan dan memerlukan migrasi aset terpisah bila aksesnya hendak dibatasi. Pembeli memperoleh informasi status penguncian refund di kedua klien. Pembatalan permintaan refund oleh pembeli tetap belum tersedia.

## Riwayat Ronde 1

Tanggal audit 20 November 2026 (WIB) · Cakupan gateway-be, gateway-fe, gateway-mobile

## 1. Executive Summary

**NOT_READY untuk produksi.** Build dan regresi lulus. Kebijakan pemulihan akun, perlindungan dokumen identitas organizer, dan penanganan refund saat gerbang dibuka masih perlu ditutup sebelum dipakai di acara nyata. Audit ini meliputi pemeriksaan kode, integrasi lokal dengan PostgreSQL dan provider simulasi, serta smoke test web.

| Severity | Bugs Found | Bugs Fixed & Pushed | Remaining/Unresolved Bugs |
|---|---:|---:|---:|
| Critical | 1 | 1 | 0 |
| High | 5 | 2 | 3 |
| Medium | 7 | 2 | 5 |
| Low | 0 | 0 | 0 |
| **Jumlah** | **13** | **5** | **8** |

Kelima bug menghasilkan tujuh commit perbaikan karena QA-004 menyentuh tiga repositori. Ketiga repo memakai branch <code>qa/full-audit-and-fix</code>. Semua push perbaikan mengembalikan exit code 0. Direktori <code>Uji-Level</code> berada di luar Git. Laporan disimpan di root tersebut dan salinannya dipublikasikan dari branch QA backend.

| Repo | Origin | Commit perbaikan terakhir |
|---|---|---|
| gateway-be | [galihpikun/gateway-be](https://github.com/galihpikun/gateway-be/tree/qa/full-audit-and-fix) | <code>3df4fa701f8f81f3edfe981adbd036ca525b3bf1</code> |
| gateway-fe | [RezaAdityaRamadhan26/gateway-fe](https://github.com/RezaAdityaRamadhan26/gateway-fe/tree/qa/full-audit-and-fix) | <code>1bcb0c7e8c914a3ab41a735e58d282450482bd40</code> |
| gateway-mobile | [galihpikun/gateway-mobile](https://github.com/galihpikun/gateway-mobile/tree/qa/full-audit-and-fix) | <code>0cba9c429ef14f3585818d5db6765b950d8b8730</code> |

Untuk menguji QA-004 bersama, jalankan backend QA sebelum web dan mobile QA. Klien hanya menawarkan pengajuan refund bila detail order berisi <code>canRequestRefund: true</code>. Deployment harus menyediakan <code>JWT_SECRET</code> yang valid agar login dan verifikasi token berfungsi.

## 2. Commands & Verification Matrix

| Repo | Command | Baseline | Final |
|---|---|---|---|
| gateway-be | <code>npm test</code> | PASS, 13 tes lulus, 0 gagal | PASS, 16 tes lulus, 0 gagal, 0 dilewati |
| gateway-be | <code>node --test --test-name-pattern 'fails closed' test/unit.test.js</code> | FAIL, konfigurasi JWT kosong tetap menghasilkan token | PASS, 1/1 |
| gateway-be | <code>node --test --test-name-pattern 'payment reconciliation continues' test/providers.test.js</code> | FAIL, simulasi timeout menghentikan batch | PASS, 1/1 |
| gateway-be | <code>node --test test/workflow.test.js</code> | FAIL untuk assertion baru, flag kelayakan refund belum tersedia | PASS, 1/1, mencakup tiga keadaan kelayakan |
| gateway-be | <code>node --test --test-name-pattern 'idempotent checkout retry' test/unit.test.js</code> | FAIL, status 500 alih-alih 200 pada simulasi konflik unik | PASS, 1/1 |
| gateway-fe | <code>node --test test/checkout.test.mjs</code> | FAIL, <code>crypto.randomUUID is not a function</code> pada simulasi HTTP lokal | PASS, 1/1 |
| gateway-fe | <code>npx tsc --noEmit --incremental false</code> | PASS, exit 0 | PASS, exit 0 |
| gateway-fe | <code>npm run lint</code> | PASS, exit 0 | PASS, exit 0 |
| gateway-fe | <code>npm run build</code> | PASS, 22/22 halaman statis | PASS, 22/22 halaman statis, exit 0 |
| gateway-mobile | <code>npx tsc --noEmit</code> | PASS, exit 0 | PASS, exit 0 |
| gateway-mobile | <code>npm run lint</code> | PASS, exit 0 | PASS, exit 0 |
| gateway-mobile | <code>npx expo export --platform all --output-dir "$env:TEMP/gateway-full-audit-export"</code> | Tidak dijalankan pada baseline | PASS, bundle web, Android, dan iOS |

**Smoke web lokal.** <code>npm run dev -- --hostname 127.0.0.1 --port 3199</code> berhenti karena direktori web sudah memiliki dev server milik pengguna di 3000. Smoke diteruskan memakai <code>npm run start -- --hostname 127.0.0.1 --port 3199</code>. Backend QA dijalankan dengan mengimpor <code>index.js</code> dari <code>node --input-type=module</code> dan memanggil <code>app.listen(3198, '127.0.0.1')</code> sehingga worker provider tidak ikut aktif. Adapter sementara di sesi browser membatasi panggilan backend menjadi GET ke instance ini.

| Pemeriksaan smoke | Hasil |
|---|---|
| Beranda, data konser, kategori | PASS, 6 tautan konser terlihat, GET katalog dan kategori 200 |
| Detail satu konser dari katalog | PASS, judul tampil, GET detail 200 |
| Checkout tanpa sesi login | PASS, CTA masuk untuk membeli tiket |
| Tiket saya, acara organizer, scanner staf, admin tanpa login | PASS, keempat halaman beralih ke form masuk |
| Cleanup | PASS, listener QA 3198 dan 3199 berhenti. Query PostgreSQL untuk pola fixture mencatat 0 akun, 0 buyer contact, dan 0 OTP tes yang tersisa. |

Pesan retry Resend selama tes berasal dari respons simulasi 503 yang sengaja diuji. Driver <code>pg</code> mengeluarkan warning deprecation tentang query paralel pada koneksi yang sama. Warning tersebut belum mengubah hasil tes. Semua sampel provider memakai simulasi. Environment pengujian tidak memerlukan pembayaran, email, atau perubahan aset Cloudinary nyata.

## 3. Fixed Bugs Report (Yang Sudah Diperbaiki)

| Bug ID | Severity | Layer (BE/FE/Mobile) | File:Line | Root Cause | Fix Summary | Regression Test Added | Git Commit Hash | GitHub Push Status |
|---|---|---|---|---|---|---|---|---|
| QA-001 | Critical | BE | <code>src/utils/generateToken.js:6</code>, <code>src/middlewares/jwtMiddleware.js:28</code> | Penandatanganan dan verifikasi memakai konfigurasi bawaan ketika secret kosong. | Kedua jalur memakai pengecekan konfigurasi yang sama dan berhenti saat secret hilang atau kosong. | <code>test/unit.test.js</code>, signing gagal saat konfigurasi hilang dan saat hanya spasi. | [f8bd2fc](https://github.com/galihpikun/gateway-be/commit/f8bd2fcbc1b124cf17c75d67dcf52dcae2be98ad) | PASS, exit 0 |
| QA-002 | High | BE | <code>src/service/paymentService.js:60</code> | Error provider pada satu lookup keluar dari seluruh batch rekonsiliasi. | Isolasi error per order, lanjutkan sesi lain, dan antrekan kembali sesi yang gagal. | <code>test/providers.test.js</code>, satu sesi timeout lalu sesi berikutnya tetap diproses. | [7afc364](https://github.com/galihpikun/gateway-be/commit/7afc364603fe30f8decf4b4610151b9cd1f49e82) | PASS, exit 0 |
| QA-003 | High | FE | <code>src/lib/checkout.ts:35</code>, <code>src/app/events/[id]/checkout/page.tsx:85</code> | Checkout memanggil API UUID yang memerlukan konteks aman. Pemanggilan berada di luar penanganan error form. | Buat key acak 128 bit melalui <code>getRandomValues</code> di dalam penanganan error. | <code>test/checkout.test.mjs</code>, browser simulasi menyediakan byte acak tanpa API UUID. | [c52a8fc](https://github.com/RezaAdityaRamadhan26/gateway-fe/commit/c52a8fced1c65849528f38257b1ebd8b75bf731f) | PASS, exit 0 |
| QA-004 | Medium | BE, FE, Mobile | BE <code>src/service/refundService.js:23</code>, <code>src/controllers/orderController.js:415</code>. FE <code>src/app/my-orders/[id]/page.tsx:447</code>. Mobile <code>src/app/orders/[id].tsx:66</code>. | Dua klien menebak kelayakan refund dengan aturan berbeda. Form dapat tampil meski backend akan menolak. | Detail order mengirim flag dari aturan backend. Kedua klien memakainya untuk tampilan dan submit. | <code>test/workflow.test.js</code>, order layak sebelum acara, tidak layak sesudah ada pengajuan, serta tidak layak saat konser aktif. | [BE cb70087](https://github.com/galihpikun/gateway-be/commit/cb70087c0bb83bd783209ebdea2cbb39dbe2e6f4), [FE 1bcb0c7](https://github.com/RezaAdityaRamadhan26/gateway-fe/commit/1bcb0c7e8c914a3ab41a735e58d282450482bd40), [Mobile 0cba9c4](https://github.com/galihpikun/gateway-mobile/commit/0cba9c429ef14f3585818d5db6765b950d8b8730) | PASS, 3 push terpisah, exit 0 |
| QA-005 | Medium | BE | <code>src/controllers/orderController.js:98</code>, <code>src/controllers/orderController.js:308</code> | Dua checkout dengan key sama dapat sama-sama melewati lookup awal. Request kedua menerima 500 ketika constraint unik menangkap konflik. | Baca ulang order milik pembeli dengan key yang sama setelah konflik dan gunakan aturan replay/fingerprint yang sama. | <code>test/unit.test.js</code>, lookup awal kosong lalu simulasi konflik unik mengembalikan order dan URL yang sudah tercatat. | [3df4fa7](https://github.com/galihpikun/gateway-be/commit/3df4fa701f8f81f3edfe981adbd036ca525b3bf1) | PASS, exit 0 |

QA-002 menguji isolasi batch pada service dengan Prisma dan provider stub. QA-005 menguji penanganan konflik pada controller tanpa mengklaim reproduksi balapan PostgreSQL. Detail ketersediaan metode random pada konteks lokal mengikuti definisi Web Crypto. [W3C Web Cryptography API](https://w3c.github.io/webcrypto/#crypto-interface)

## 4. Remaining / Unresolved Bugs Report (Bug yang Masih Ada)

### QA-006 · High · BE · Pemulihan akun memerlukan pengendalian percobaan

- **File:Line** <code>gateway-be/src/controllers/authController.js:302</code>, <code>:353</code>, <code>:421</code> dan <code>gateway-be/src/routes/authRoutes.js</code>.
- **Observed Bug & Impact** Kode memiliki waktu kedaluwarsa dan status pemakaian, tetapi jalur reset belum menerapkan batas percobaan atau jeda pengiriman yang konsisten. Pembacaan OTP dan penandaan telah terpakai juga terjadi dalam langkah berbeda.
- **Evidence** <code>STATIC_CHECKED</code>. Workflow tes membuktikan kode salah ditolak dan reset sah berhasil. Peninjauan konfigurasi dan kontrol dilakukan dari source tanpa uji penyalahgunaan.
- **Why Not Fixed Yet** <code>BLOCKED_NEEDS_APPROVAL</code> untuk kebijakan batas percobaan, penyimpanan penghitung lintas instance, dan aturan rotasi kode pemulihan.
- **Recommended Fix** Terapkan kebijakan konsisten per akun dan pengirim permintaan, konsumsi OTP secara atomik, serta uji kedaluwarsa, penggunaan sekali, dan pemulihan normal dengan provider simulasi.

### QA-007 · High · BE · Pengiriman dokumen identitas organizer belum terikat kontrol akses

- **File:Line** <code>gateway-be/src/controllers/organizerController.js:92</code> dan <code>:154</code>, <code>gateway-be/src/service/cloudinaryService.js:14</code>.
- **Observed Bug & Impact** Dokumen identitas memakai jalur unggah gambar umum dan menyimpan URL langsung. Aplikasi belum menentukan delivery privat secara eksplisit pada jalur ini. Pengaturan aktual bucket/provider belum diverifikasi dan keterbukaan dokumen nyata tidak diuji.
- **Evidence** <code>STATIC_CHECKED</code>. Ikuti penyimpanan satu dokumen fixture sintetis sampai konfigurasi delivery di sandbox dengan akses yang disetujui.
- **Why Not Fixed Yet** <code>BLOCKED_NEEDS_APPROVAL</code>. Peralihan dokumen lama ke delivery privat memerlukan persetujuan retensi, migrasi aset, dan model akses admin/organizer.
- **Recommended Fix** Simpan aset sensitif sebagai authenticated asset. Gunakan URL sementara setelah otorisasi dan pindahkan aset lama secara terkontrol.

### QA-008 · High · BE, FE, Mobile · Refund tertunda dapat menahan tiket di gerbang

- **File:Line** <code>gateway-be/src/controllers/ticketRedemptionController.js:131</code> dan <code>gateway-be/src/service/refundService.js:438</code>.
- **Observed Bug & Impact** Refund aktif mengunci tiket untuk check-in. Persetujuan customer refund diblokir ketika konser sudah dimulai, sehingga pengajuan yang masih menunggu persetujuan memerlukan intervensi petugas/admin saat pembeli tiba.
- **Reproduction Steps** Di sandbox, buat pengajuan refund pada order fixture sebelum hari acara dan biarkan menunggu. Saat jadwal fixture aktif, bandingkan status pengajuan dan pesan yang diterima petugas untuk tiket tersebut.
- **Why Not Fixed Yet** <code>BLOCKED_NEEDS_APPROVAL</code>. Bisnis perlu menetapkan kapan pengajuan yang belum diproses kedaluwarsa. Refund yang sudah dikirim ke provider harus tetap dilindungi.
- **Recommended Fix** Buat aturan transisi sebelum gerbang dibuka dan tampilkan penguncian serta opsi penyelesaian di antarmuka.

### QA-009 · Medium · BE, FE, Mobile · Tiket berharga nol mengikuti alur pembayaran

- **File:Line** <code>gateway-be/src/controllers/ticketTypeController.js:44</code>, <code>gateway-be/src/controllers/orderController.js:274</code>, <code>gateway-mobile/src/components/EventCard.tsx</code>.
- **Observed Bug & Impact** Organizer dapat membuat tier dengan harga nol. Mobile menampilkannya sebagai gratis, tetapi backend tetap meminta sesi pembayaran untuk order total nol. Jalur penerbitan langsung untuk order gratis belum tersedia.
- **Reproduction Steps** Buat tier gratis dengan fixture dan pantau pemanggilan PaymentService melalui spy. Gunakan respons provider simulasi untuk melihat status order.
- **Why Not Fixed Yet** <code>BLOCKED_NEEDS_APPROVAL</code>. Perlu keputusan apakah platform mendukung tiket gratis atau mewajibkan harga minimal, berikut implikasi pembatalan dan laporan.
- **Recommended Fix** Terapkan jalur penerbitan gratis yang atomik atau validasi harga minimum di semua entry point.

### QA-010 · Medium · BE · Penggantian media meninggalkan aset lama

- **File:Line** <code>gateway-be/src/controllers/eventController.js:342</code>, <code>:370</code>.
- **Observed Bug & Impact** Mengganti/menghapus preview hanya mengubah kolom event. Upload yang sudah berhasil sebelum update database gagal juga belum punya kompensasi. Aset yang tidak lagi dirujuk tetap tersimpan dan bisa menambah biaya.
- **Reproduction Steps** Pakai Cloudinary stub, ganti preview fixture, lalu periksa referensi baru di database dan riwayat stub. Ulangi dengan simulasi kegagalan update database setelah upload.
- **Why Not Fixed Yet** <code>BLOCKED_NEEDS_APPROVAL</code> untuk aturan retensi dan pembersihan aset, terutama gambar yang mungkin dipakai referensi lain.
- **Recommended Fix** Antrekan pembersihan aset hanya setelah perubahan referensi sukses dan verifikasi tidak ada referensi lain. Bersihkan upload baru yang tidak pernah terpasang.

### QA-011 · Medium · BE · Edit zona dapat bertabrakan dengan proses review

- **File:Line** <code>gateway-be/src/controllers/ticketTypeController.js:95</code> sampai bagian update dan <code>gateway-be/src/controllers/eventController.js:388</code>.
- **Observed Bug & Impact** Validasi tier dan status draft dibaca sebelum penulisan tier. Submit/publish dan perubahan tier belum memakai satu batas transaksi yang konsisten. Organizer dapat melihat hasil review yang tidak sesuai perubahan zona terakhir di dua sesi yang sedang bekerja.
- **Evidence** <code>STATIC_CHECKED</code>. Susun fixture integrasi dua transaksi untuk membuktikan satu snapshot layout/tier dipakai dari edit sampai review.
- **Why Not Fixed Yet** <code>OPEN</code>. Perlu pengujian concurrency PostgreSQL dan pemilihan urutan lock yang konsisten untuk menghindari deadlock.
- **Recommended Fix** Tetapkan transaksi dan version check di parent event yang berlaku untuk edit layout, tier, submit, dan approve.

### QA-012 · Medium · FE · Gangguan API sementara menghapus sesi web

- **File:Line** <code>gateway-fe/src/context/AuthContext.tsx:51</code>.
- **Observed Bug & Impact** Semua kegagalan refresh profil masuk ke catch yang menghapus token. Gangguan jaringan atau 5xx dapat memaksa pengguna masuk ulang.
- **Reproduction Steps** Dengan akun fixture, stub refresh profil menjadi 503 lalu pulihkan API. Bandingkan persistensi sesi dengan kasus 401 yang normal.
- **Why Not Fixed Yet** <code>OPEN</code>. Perlu verifikasi state loading, retry, dan tampilan halaman berizin ketika status sesi belum dapat dipastikan.
- **Recommended Fix** Hapus token hanya saat backend memastikan sesi tidak valid. Bedakan status offline/timeout dan uji recovery serta logout bersamaan dengan refresh.

### QA-013 · Medium · BE · Validasi pagination belum seragam

- **File:Line** <code>gateway-be/src/controllers/orderController.js:324</code>, <code>gateway-be/src/service/issuedTicketService.js:143</code>, <code>gateway-be/src/utils/paginate.js:1</code>.
- **Observed Bug & Impact** Beberapa daftar meneruskan angka query langsung ke Prisma. Metadata tidak dikendalikan oleh satu kontrak untuk batas halaman, limit, dan respons ketika nilainya di luar rentang.
- **Evidence** <code>STATIC_CHECKED</code>. Uji batas pagination pada daftar fixture dengan unit test untuk nilai kosong, pecahan, dan di luar rentang.
- **Why Not Fixed Yet** <code>BLOCKED_NEEDS_APPROVAL</code> untuk batas default/maksimum dan kompatibilitas mode lama yang mengembalikan array tanpa pagination.
- **Recommended Fix** Pakai parser pagination bersama, pertahankan bentuk respons yang dibutuhkan klien lama, dan pastikan penolakan input menghasilkan 400 yang konsisten.

## 5. Role-by-Role Coverage Matrix

| Role | Bukti backend | Bukti web/mobile | Sisa verifikasi |
|---|---|---|---|
| USER | Registrasi/login, OTP reset sah dan kode salah, validasi kontak, pembatasan checkout organizer, idempotency dan fingerprint, penerbitan tiket, email retry, refund, pembayaran terlambat dalam suite otomatis. | Web katalog/detail/CTA sign-in dan redirect tiket/checkout diuji di browser. Regresi key HTTP lokal dan konsumsi flag refund lulus. Mobile typecheck/lint/bundle lulus. | OTP kedaluwarsa dan penggunaan ulang pada semua alur, oversell dengan transaksi paralel nyata, toast error lintas bahasa, pembayaran provider sandbox. |
| ORGANIZER | Pengajuan dokumen dengan provider stub, persetujuan profil, pembuatan konser dan tier atomik, validasi tipe preview/layout/zone, pembatasan pembelian, serta daftar refund. | Route web tanpa sesi diuji. Picker, form organizer, pemetaan layout dan video diperiksa dari kode web/mobile. | Matriks lintas-organizer untuk seluruh mutasi berbasis kepemilikan, pergantian media gagal, render 3D dan native picker. |
| STAFF | Assignment, validasi event terpilih, penerbitan kode QR, check-in sah, serta scan ulang berurutan ditolak. Pemeriksaan role/assignment sebelum data aksi diverifikasi dari kode. | Route scanner web tanpa sesi diuji. UI mobile dan lifecycle kamera diperiksa dari kode dan bundle. | Scan paralel dengan perangkat nyata, unactivated invitation, aturan refund pending, kamera dan izin lintas perangkat. |
| ADMIN | Review organizer, approve/cancel konser, approve refund, webhook refund ulang. Guard admin dan pemanggilan audit log pada tindakan utama ditinjau. | Redirect admin tanpa login pada web diuji. Admin web/mobile lulus build dan typecheck. | Uji runtime suspend/unsuspend setiap role, review dokumen individual dan kondisi rekaman audit di seluruh mutasi, serta variasi login web/mobile. |

Pemeriksaan otorisasi mencakup susunan middleware, scope pemilik, dan assignment staf. Area yang belum memiliki assertion atau pengujian runtime eksplisit tetap dicatat sebagai celah cakupan. Provider yang digunakan source saat ini adalah **Xendit** untuk pembayaran/refund, **Resend** untuk email, dan **Cloudinary** untuk media.

## 6. Manual Device & Visual QA Checklist

- [ ] **Expo Android dan iOS, NEEDS_DEVICE_QA**. Gunakan ponsel yang dapat menjangkau backend lokal. Login, buka tiket valid, ukur apakah QR muat, dan pindai dari perangkat gerbang. Uji tombol kembali Android, tutup modal, orientasi layar, dan pinch/scroll.
- [ ] **Native file picker, NEEDS_DEVICE_QA**. Gunakan dokumen fixture sintetis. Pilih, ganti, dan batalkan PNG/JPG/WebP hingga 5 MB, MP4/WebM hingga 25 MB, serta file yang melewati batas. Verifikasi URI upload dan nama file di <code>gateway-mobile/src/lib/filePicker.ts</code> serta media pada konser setelah reload.
- [ ] **Kamera staf, NEEDS_DEVICE_QA**. Uji grant, deny, cabut lalu berikan ulang izin, kamera sibuk, pindah aplikasi, kembali ke scanner, scan satu tiket, dan coba ulang. Uji fallback input manual. Jalur web <code>gateway-fe/src/app/staff/scan/useGateCamera.ts</code> dan mobile <code>gateway-mobile/src/app/staff.tsx</code>.
- [ ] **Preview dan venue, STATIC_CHECKED**. Buka konser dengan template arena, teater, dan lapangan. Ganti tier dan periksa kecocokan zona di peta. Verifikasi loading/error video, perpindahan pointer/fokus, dan fallback WebGL pada <code>VenueMap</code>, <code>VenueScene</code>, dan <code>ConcertPreview</code>. Di mobile, cocokkan denah 2D dan video di <code>ConcertMedia</code> dengan konfigurasi backend.
- [ ] **Pembayaran sandbox, NEEDS_SANDBOX_QA**. Gunakan akun sandbox Xendit. Cek luaran sukses, kedaluwarsa, callback ulang, retry QR email, dan refund simulasi. Item Midtrans di brief diterapkan ke Xendit sesuai integrasi yang ada.
- [ ] **Regresi visual, NEEDS_DEVICE_QA**. Periksa Bahasa Indonesia/English, gelap/terang, layar sempit, keyboard, jaringan putus saat refresh dan upload, lalu cek kembali checkout, modal QR, dan halaman order di setiap peran.
