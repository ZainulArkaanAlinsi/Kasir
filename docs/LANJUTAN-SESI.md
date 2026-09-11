# KasirOne — Status & Lanjutan

> Dokumen serah-terima. Dibuat 11 September 2026, saat sesi pengerjaan ditutup.
> Buka file ini duluan kalau mau melanjutkan pekerjaan.

Commit terakhir: `0d69490` — sudah ter-push ke
`https://github.com/ZainulArkaanAlinsi/Kasir.git`, branch `main`, working tree bersih.

---

## 0 · Aturan yang tidak boleh dilanggar

1. **Nama Claude tidak boleh muncul di mana pun di repo ini.** Tidak ada
   `Co-Authored-By`, tidak ada baris sesi, tidak ada collaborator bot. Semua
   commit atas nama `Zainul Arkaan <zainaril13@gmail.com>`. Ini permintaan
   eksplisit yang sudah diulang dua kali.
2. **`serviceAccountKey.json` dan `.env` tidak pernah masuk Git.** Keduanya
   sudah ada di `.gitignore`; pastikan tetap begitu sebelum commit apa pun.
3. **Aplikasi tidak boleh berpura-pura sudah menerima uang.** Kalau QRIS belum
   terkonfigurasi, tombolnya menolak dengan penjelasan — bukan menampilkan QR
   hiasan yang terlihat sah tapi tidak menagih.
4. **Harga selalu dibaca dari database, tidak pernah dari browser.** Browser
   cuma mengirim `productId` + `qty`.

---

## 1 · Firebase — SUDAH JADI dan sudah diuji

| Item | Nilai |
|---|---|
| Project ID | `kasirone-3444` (display name: KasirOne) |
| Firestore | Native mode, `asia-southeast2` (Jakarta), free tier |
| Security rules | ter-deploy |
| Indeks komposit | ter-deploy |
| Auth Email/Password | aktif |
| Akun admin | `zainaril13@gmail.com`, custom claim `role: admin` |
| uid admin | `FSn81SSnmwSaYmsaImImvzhZlrJ3` |
| Web App ID | `1:208893220085:web:d04c9f909027984d05e1bc` |
| Konfigurasi web | `public/firebase-config.js` — sudah terisi, boleh publik |
| Kredensial server | `serviceAccountKey.json` di root — **rahasia** |

**Sandi admin sementara: `KasirOne#2026`.** Sandi ini pernah lewat percakapan,
jadi gantilah. Ini satu-satunya utang keamanan yang masih terbuka.

### Bukti sudah jalan (bukan klaim)

Login sungguhan lewat REST Identity Toolkit, lalu tokennya dipakai menembak API:

```
claim role = admin | email = zainaril13@gmail.com
GET  /api/products      -> 200
POST /api/products      -> 201  (Kopi Uji Coba, stok 10)
POST /api/transactions  -> TRX-20260911-1488
     subtotal 24000 | pajak 2640 | total 26640 | kembali 23360
stok 10 -> 8 per transaksi  (dicek, benar)
```

Data uji tersebut sudah dihapus lagi. Firestore dalam keadaan kosong.

### Konsol yang relevan

- Firebase: https://console.firebase.google.com/project/kasirone-3444/overview
- Firestore: .../firestore/data
- Authentication: .../authentication/users

---

## 2 · YANG BELUM KELAR

Urut dari yang paling menghambat.

### 2.1 Deploy Vercel — TERBLOKIR, butuh tangan kamu

Percobaan deploy gagal dengan **403 "You don't have permission to create the
project."** Sebabnya bukan kode: Vercel GitHub App belum diberi akses ke
repositori `Kasir`.

Langkah perbaikannya (harus dari akun kamu, tidak bisa diwakilkan):

1. Buka https://github.com/settings/installations
2. Pilih **Vercel** -> **Configure**
3. Di *Repository access*, tambahkan repo **ZainulArkaanAlinsi/Kasir**
4. Simpan, lalu ulangi deploy

Berkas yang sudah disiapkan dan tinggal dipakai: `vercel.json`, `api/index.js`.
`server/server.js` sudah tahu cara berjalan sebagai serverless function
(melewati `listen()` kalau `process.env.VERCEL` ada).

**Catatan penting soal Vercel:** `serviceAccountKey.json` tidak ikut ter-deploy
(sudah di `.dockerignore`/`.gitignore`). Di Vercel, kredensialnya harus
dimasukkan sebagai *environment variable*, bukan file. Ini **belum dikerjakan
dan belum diuji** — `server/services/firebase.js` saat ini cuma memanggil
`admin.credential.applicationDefault()`, yang membaca file. Butuh cabang
tambahan yang membaca isi JSON dari env var.

### 2.2 Midtrans sandbox — butuh pendaftaran kamu

QRIS sekarang berada di **mode nonaktif**: tombolnya menolak dengan penjelasan.
Ini disengaja, bukan bug.

1. Daftar di https://dashboard.sandbox.midtrans.com
2. Settings -> Access Keys -> salin *Server Key* (berawalan `SB-Mid-server-`)
3. Isi di `.env`: `MIDTRANS_SERVER_KEY=SB-Mid-server-xxxxx`
4. Restart server

Kode gateway, polling status, dan verifikasi tanda tangan SHA-512 untuk webhook
sudah ditulis lengkap di `server/services/payment.service.js`, **tetapi belum
pernah diuji melawan Midtrans sungguhan** karena kuncinya belum ada.

Webhook-nya ada di `POST /api/payments/webhook` — sengaja tanpa login, karena
yang memanggil adalah server Midtrans. Keasliannya dibuktikan lewat tanda
tangan, bukan sesi. Untuk mengujinya dari luar butuh tunnel (ngrok/cloudflared)
karena Midtrans tidak bisa menjangkau `localhost`.

### 2.3 api-product-indonesia — ditulis tapi BELUM terbukti

`server/services/katalog-nasional.service.js` memanggil
`https://api-products.alpha-projects.cloud/api/v1` untuk mencari produk dari
barcode (50.600 produk Indonesia). Integrasinya sudah tersambung ke alur scan
di `public/js/ui/barcode.js`.

**Statusnya jujur: belum pernah berhasil dijangkau.** `nslookup` berhasil
resolve, tetapi `curl` mengembalikan exit code 6. Itu batasan jaringan di
lingkungan tempat kode ini ditulis, **bukan** bukti API-nya mati. Yang perlu
dilakukan: jalankan dari jaringanmu sendiri dan lihat apakah benar jalan.

```bash
curl -s "https://api-products.alpha-projects.cloud/api/v1/products?barcode=8992753100019" | head -c 300
```

Kalau ternyata API-nya berubah bentuk, yang perlu disesuaikan cuma pemetaan
field di `cariBarcode()` dan `cariNama()`.

> Catatan sengaja: layanan ini **tidak** dipakai untuk mengambil harga, karena
> dokumentasi sumbernya menyatakan harganya acak. Yang diambil hanya nama dan
> barcode; harga dan stok tetap diisi admin.

### 2.4 Utang teknis yang sudah dicatat

Rinciannya ada di `docs/BELUM-SELESAI.html` (dokumen ini siap dicetak jadi PDF).
Ringkasnya:

| Hal | Keadaan sekarang | Kapan jadi masalah |
|---|---|---|
| Foto produk | Data URL di dalam dokumen produk | Saat katalog membesar — pindahkan ke Firebase Storage |
| Laporan | Dihitung dengan membaca koleksi transaksi | Sekitar 100 transaksi/hari — butuh agregat atau PostgreSQL |
| Skala spasi | Beberapa nilai masih angka lepas | Saat mau rapikan design system |
| Notifikasi pelanggan | Belum ada sama sekali | Pesanan online berubah status tanpa pemberitahuan |
| Firebase App Check | Belum dinyalakan | Sebelum produksi sungguhan |

---

## 3 · YANG SUDAH KELAR

Supaya sesi berikutnya tidak mengerjakan ulang.

**Kasir (POS)** — keranjang, diskon, pajak, tunai/QRIS/kartu, struk, layar
menghadap pembeli, scan barcode (kamera + alat scanner), restock, pengeluaran,
laporan, ekspor CSV, unggah foto produk, impor contoh dari DummyJSON.

**Etalase online (M8–M14)** — katalog publik, keranjang, checkout ambil-sendiri
maupun diantar, akun pelanggan, penguncian stok, riwayat pesanan, panel pesanan
untuk staf, webhook pembayaran, ongkos kirim per zona.

**Pengamanan yang sudah dipasang**

- `stok` (fisik) dipisah dari `stokDipesan` (dikunci); yang dijual adalah
  `tersedia = stok - stokDipesan`
- Transaksi Firestore atomik (`runTransaction` + `tx.getAll`) supaya dua kasir
  tidak bisa menjual barang terakhir yang sama
- Perubahan status pesanan lewat satu tabel transisi, bukan `if` yang tersebar
- `ambilPesanan` mengembalikan **404, bukan 403**, untuk pesanan milik orang
  lain — supaya keberadaannya tidak bocor
- `/api/katalog` membuang `hargaModal`, `stok`, `stokDipesan`, `stokMinimum`,
  `createdBy`; hanya 8 field yang keluar
- Security rules menolak kasir yang mencoba menaikkan perannya sendiri jadi
  admin (`request.resource.data.role == resource.data.role`)

**Pengujian**

- 48 uji unit — **dijalankan ulang di sesi ini, semuanya lulus**
- 29 uji emulator + 21 uji security rules — lulus saat terakhir dijalankan,
  **tidak dijalankan ulang di sesi ini**

```bash
npm test            # 48 uji unit, tanpa emulator
npm run test:all    # unit + emulator + rules (butuh Java 17+)
```

---

## 4 · Jebakan yang sudah pernah memakan waktu

Jangan mengulang penyelidikan yang sama.

**Server lama nyangkut di port 3000.** Proses dari sesi sebelumnya masih hidup
menjalankan kode usang. Gejalanya menyesatkan: `GET /api/products` berhasil 200
tetapi `POST` ke alamat yang sama balik 404 padahal rutenya jelas ada. Sebelum
menuduh kode, cek dulu:

```bash
netstat -ano | grep ":3000 "
taskkill //PID <pid> //F
```

**Akun dari Firebase Console tidak punya custom claim.** Dia bisa login, lalu
ditolak 403 di setiap rute kasir. Pakai skrip ini, yang mengerjakan keduanya
sekaligus:

```bash
node scripts/buat-akun.js kasir@toko.com SandiKuat456 cashier "Nabila"
```

Aman dijalankan berulang — kalau emailnya sudah ada, akun lama dipakai dan cuma
perannya yang disegarkan; sandi tidak pernah ditimpa.

**Habis ganti peran, user harus logout lalu login lagi** supaya token barunya
membawa claim yang baru. Ini penyebab paling sering error 403 yang "tiba-tiba".

**Identity Platform minta billing, Firebase Auth tidak.** Menyalakan
Authentication lewat REST (`identityPlatform:initializeAuth`) ditolak dengan
`BILLING_NOT_ENABLED`. Yang berhasil: klik **Get started** sekali di Firebase
Console, baru setelah itu provider Email/Password bisa dinyalakan lewat API.

**Emulator butuh Java.** `firebase-tools` v15 ke atas minta JDK 21+. Project ini
sengaja memasang `firebase-tools` v13 secara lokal supaya tetap jalan di JDK 17.

---

## 5 · Perintah yang sering dipakai

```bash
npm start                      # server di http://localhost:3000
npm run dev                    # sama, dengan auto-reload
npm test                       # 48 uji unit
npm run test:all               # + emulator + security rules

node scripts/buat-akun.js <email> <sandi> <admin|cashier> [nama]
node scripts/set-role.js  <email> <admin|cashier> [nama]

npx firebase deploy --only firestore:rules --project kasirone-3444
npx firebase deploy --only firestore:indexes --project kasirone-3444
```

Etalase pembeli ada di `/toko.html`, aplikasi kasir di `/`.

---

## 6 · Kalau melanjutkan di sesi Claude yang baru

Kalimat pembuka yang cukup:

> Lanjutkan project KasirOne. Baca `docs/LANJUTAN-SESI.md` dulu.
> Ingat: kamu tidak boleh muncul sebagai collaborator atau di pesan commit.

Urutan yang gw sarankan:

1. **Beresin Vercel** (bagian 2.1) — ini yang paling menghambat, dan bagian
   kredensial-lewat-env-var memang belum ditulis sama sekali.
2. **Midtrans sandbox** (2.2) supaya pembayaran benar-benar terbukti, bukan
   cuma tertulis.
3. **Uji api-product-indonesia dari jaringanmu** (2.3) dan perbaiki pemetaan
   field-nya kalau ternyata beda.
4. Baru utang teknis di 2.4.
