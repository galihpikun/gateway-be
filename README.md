# Gateway backend

Node.js + Express + PostgreSQL + Prisma. Gunakan Node yang mendukung TypeScript stripping (Node 22.18+ atau 24+) karena Prisma client diimpor dari file `.ts`.

## Menjalankan lokal

1. Salin `.env.example` menjadi `.env` dan isi konfigurasi database, JWT, Cloudinary, Xendit, dan Resend.
2. Jalankan `npm install`, `npx prisma db push`, lalu `npm run dev`.
3. Frontend: isi `NEXT_PUBLIC_API_URL=http://localhost:3001`, lalu jalankan `npm run dev` di `gateway-fe`.

`npm run seed` bersifat opsional untuk data latihan; tidak diperlukan untuk pengujian workflow. Jangan jalankan seed pada database transaksi nyata.

## Email Resend

```env
RESEND_API_KEY=re_api_key_anda
RESEND_FROM_EMAIL=Gateway <noreply@domain-anda.com>
```

Key cukup memiliki izin sending untuk domain pengirim. Verifikasi domain dan DNS melalui dashboard Resend sebelum mengirim ke pengguna. Alamat `onboarding@resend.dev` hanya untuk pengujian yang diizinkan akun Resend; gunakan domain terverifikasi untuk penggunaan aplikasi umum. Jangan memasukkan key ke variabel `NEXT_PUBLIC_*` atau Git. SMTP dan Nodemailer sudah tidak dipakai. Kegagalan pengiriman menghasilkan error API, bukan pesan sukses palsu. OTP tidak dicetak ke log.

Referensi: https://resend.com/docs/send-with-nodejs

## Xendit

Isi `XENDIT_SECRET_KEY` dan `XENDIT_WEBHOOK_TOKEN` di `.env`. Gunakan test mode untuk pengembangan. Pasang URL backend yang dapat dijangkau Xendit:

- Payment Session webhook: `https://HOST_BACKEND/api/payments/webhook`
- Refund webhook: `https://HOST_BACKEND/api/refunds/webhook`

Konfigurasikan token callback sesuai dashboard. URL localhost tidak bisa dijangkau gateway tanpa tunnel atau deployment. Server memvalidasi `x-callback-token`. Simpan payment ID dari callback untuk refund; data sesi lama direkonsiliasi melalui API sesi.

Saat `node index.js` atau `npm run dev` berjalan, maintenance setiap 30 detik merekonsiliasi sesi pembayaran, melepas reservasi expired, memproses refund APPROVED, dan memeriksa refund PROCESSING. Antrean disimpan sebagai record refund, sehingga restart tidak menghilangkan pekerjaan. Gunakan satu proses maintenance untuk deployment ini; pemrosesan ulang gateway menggunakan idempotency key yang sama.

Pembayaran terlambat mencoba mendapatkan stok lagi. Jika event sudah ditutup/dibatalkan atau stok tidak tersedia, order dicatat PAID dan refund penuh masuk antrean tanpa menerbitkan tiket aktif. Pembatalan event mengembalikan sisa pembayaran, termasuk event non-refundable; refund pelanggan biasa tetap dipotong 5%. Tiket dikunci selama permintaan refund aktif. Refund FAILED dapat dicoba lagi melalui approval admin.

Dokumentasi gateway: https://docs.xendit.co/apidocs/create-a-refund dan https://docs.xendit.co/apidocs/webhook-notification-sent-defined-webhook-url-updates-payment-session

## Workflow dan tes

Organizer mengirim empat dokumen → admin menyetujui dokumen dan profil → organizer membuat draft beserta jenis tiket secara atomik → submit → admin publish → organizer menugaskan staf → pembeli checkout → callback/reconciliation PAID → QR diterbitkan → staf memilih event dan redeem sekali.

Undangan staf pada draft diaktifkan ketika admin publish; penugasan pada event published langsung aktif. Role STAFF dipakai sebagai izin global, sedangkan akses tiap event tetap diperiksa dari assignment. Konser closed tidak dapat menerima staf baru. Harga/kuota jenis tiket hanya bisa diubah sebelum event dipublikasikan.

`npm test` mencakup unit, kontrak provider, dan tes HTTP dengan PostgreSQL asli. Tes HTTP membuat data dengan UUID sendiri dan membersihkannya dalam `finally`. Provider Resend/Xendit/Cloudinary disimulasikan di tes; tes tidak mengirim uang, dokumen, atau email nyata. Siapkan database pengembangan yang dapat ditulis.

Pengujian provider nyata memerlukan kredensial aktif, sender Resend terverifikasi, dan callback Xendit yang dapat diakses. Lulus tes lokal tidak berarti domain/DNS atau dashboard gateway telah dikonfigurasi.
