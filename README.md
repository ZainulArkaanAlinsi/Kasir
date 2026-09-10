# KasirOne — Sistem Kasir & Inventory Toko

Aplikasi kasir (POS) untuk toko retail kecil–menengah: transaksi cepat dengan
scan barcode, manajemen stok dan harga modal, pencatatan pengeluaran, serta
laporan pemasukan vs pengeluaran per periode.

**Stack:** HTML + CSS + JavaScript ES Modules (tanpa framework) · Node.js ·
Express 5 · Firebase Authentication · Cloud Firestore

---

## 1. Prinsip utama: browser tidak dipercaya

Ini keputusan arsitektur terpenting di proyek ini, dan mempengaruhi hampir
semua kode di bawah.

> Harga, total, diskon, dan stok **tidak pernah** diambil dari data yang
> dikirim browser. Browser hanya boleh mengirim `productId` dan `qty`.

Kasir mengirim daftar barang, lalu **server** membaca harga dari Firestore,
menghitung ulang totalnya, memeriksa stok, dan mengurangi stok — semuanya
di dalam satu Firestore transaction. Firestore Security Rules menolak semua
penulisan langsung dari browser ke koleksi `products`, `transactions`,
`expenses`, dan `auditLogs`.

Akibat praktisnya: kasir yang membuka DevTools dan mengubah harga di layar
tetap akan ditagih harga sebenarnya, dan dua kasir yang checkout barang
terakhir secara bersamaan tidak bisa membuat stok menjadi minus.

---

## 2. Menjalankan

```bash
npm install
npm run dev          # http://localhost:3000
```

### Mode Demo (tanpa Firebase)

Klik **"Demo tanpa login"**. Aplikasi berjalan penuh dengan data di
`localStorage` browser — cocok untuk mencoba alur kasir, scan barcode, dan
laporan tanpa menyiapkan apa pun.

Mode demo memakai aturan validasi yang **sama** dengan server (harga dibaca
dari data tersimpan, stok dicek sebelum dikurangi), sehingga perilakunya
tidak menyesatkan. Datanya disimpan dengan prefiks `kasirone_demo_` dan tidak
pernah bercampur dengan data Firestore.

### Mode Produksi (dengan Firebase)

1. Buat project di [Firebase Console](https://console.firebase.google.com).
2. Daftarkan Web App, salin konfigurasinya ke `public/firebase-config.js`.
3. Aktifkan **Authentication → Email/Password**.
4. Buat **Cloud Firestore**.
5. Deploy security rules: `npx firebase deploy --only firestore:rules`
6. Unduh service account (Project Settings → Service accounts) dan simpan
   sebagai `serviceAccountKey.json` di root project.
7. Salin `.env.example` menjadi `.env`.
8. Buat akun kasir lewat Firebase Authentication, lalu buat dokumen
   `users/{UID}`:

```json
{ "role": "cashier", "displayName": "Nabila" }
```

Untuk admin, isi `"role": "admin"`.

> `serviceAccountKey.json` **tidak boleh** masuk ke Git. Sudah tercantum di
> `.gitignore`. Firebase Web API key di `firebase-config.js` bukan rahasia
> dan aman berada di frontend.

### Role

| Role | Bisa |
|---|---|
| `cashier` | Transaksi, scan barcode, lihat produk & riwayat transaksi |
| `admin` | Semua di atas + kelola produk, restock, pengeluaran, laporan laba |

Role dibaca dari custom claim pada ID token; bila belum ada, sistem membaca
dokumen `users/{uid}` sebagai cadangan agar akun lama tetap bisa masuk.

---

## 3. Fitur

- **Scan barcode** — mendukung scanner USB (mode *keyboard wedge*: mengetik
  cepat lalu Enter) tanpa driver apa pun. Barcode yang tidak terdaftar
  memunculkan notifikasi, bukan gagal diam-diam.
- **Transaksi atomik** — stok dan transaksi tersimpan bersama atau tidak
  sama sekali. Sudah diuji dengan 12 checkout serentak.
- **Pembayaran** Tunai (dengan kembalian), Kartu, dan QRIS (kode statis toko
  + nomor referensi manual).
- **Harga modal & margin** per produk, jadi laba bisa dihitung.
- **Stok minimum per produk** — ambang "menipis" ditentukan per barang,
  bukan satu angka untuk semua.
- **Restock satu aksi** — menambah stok sekaligus mencatat pengeluarannya.
- **Laporan periodik** — pemasukan, pengeluaran, laba kotor & bersih,
  rincian metode bayar, dan jumlah unit terjual per produk
  (mis. *Top Kopi Aren 40 pcs, Indomie Goreng 23 pcs*).
- **Riwayat transaksi** dengan filter tanggal dan struk yang bisa dicetak.

---

## 4. Struktur

```text
kasir-modern/
├── public/
│   ├── index.html
│   ├── style.css
│   ├── firebase-config.js
│   └── js/
│       ├── main.js              entry point, navigasi & perakitan
│       ├── state.js             state terpusat + langganan perubahan
│       ├── auth.js              login, mode demo, logout
│       ├── format.js            format rupiah/tanggal + escape HTML
│       ├── firebase.js          init Firebase sisi klien (auth saja)
│       ├── shared/              dipakai bersama browser & server
│       │   ├── money.js         computeTotals, kembalian, laba
│       │   └── product.js       ambang stok menipis
│       ├── api/
│       │   ├── index.js         pemilih implementasi
│       │   ├── live.api.js      ke backend sungguhan
│       │   └── demo.api.js      localStorage, aturan sama
│       └── ui/                  cart, products, checkout, dashboard,
│                                reports, restock, transactions, barcode
├── server/
│   ├── server.js                wiring saja, tanpa logika bisnis
│   ├── lib/                     errors.js, validate.js
│   ├── middleware/              auth.js, errorHandler.js
│   ├── routes/                  products, transactions, expenses, reports
│   └── services/                logika bisnis (bisa dipindah ke Cloud Function)
├── test/                        money, report, transaksi (emulator), rules
├── docs/API.md                  referensi endpoint
├── firestore.rules
└── firestore.indexes.json
```

**Modul `shared/` adalah kunci.** Server dan browser mengimpor file yang sama
untuk menghitung uang. Sebelumnya logika total ditulis dua kali dan sempat
menyimpang — total di layar memperhitungkan diskon, total yang ditagih tidak.

---

## 5. Skema Firestore

### `users/{uid}`
`displayName`, `role` (`admin`|`cashier`), `email`, `createdAt`

### `products/{id}`
`name`, `sku` (dipakai sebagai barcode, unik), `category`, `hargaJual`,
`hargaModal`, `stok`, `stokMinimum`, `icon`, `aktif`, `createdAt`, `updatedAt`

### `transactions/{id}`
`receiptNumber`, `cashierUid`, `cashierName`, `paymentMethod`, `cashReceived`,
`change`, `qrisReference`, `subtotal`, `discount`, `tax`, `total`, `itemCount`,
`createdAt`, dan `lines[]` berisi
`{productId, name, sku, hargaJual, hargaModal, qty}`.

`lines[]` menyimpan **snapshot** harga jual dan harga modal saat transaksi
terjadi. Kalau harga produk diubah bulan depan, laporan laba bulan ini tetap
akurat.

### `expenses/{id}`
`type` (`restock`|`operasional`|`lainnya`), `productId`, `productName`, `qty`,
`hargaModal`, `amount`, `note`, `createdBy`, `createdAt`

### `auditLogs/{id}`
`uid`, `email`, `action`, `metadata`, `createdAt` — hanya bisa dibaca admin,
tidak bisa diubah atau dihapus siapa pun.

---

## 6. Testing

```bash
npm test              # unit murni, tanpa dependensi eksternal
npm run test:emulator # transaksi atomik + race condition (butuh Java)
npm run test:rules    # Security Rules (butuh Java)
npm run test:all
```

Yang diuji secara khusus:

- Diskon dipotong sebelum pajak, dan total tidak pernah negatif.
- Harga yang dikirim browser diabaikan; server memakai harga database.
- 12 checkout serentak atas stok 10 → tepat 10 berhasil, stok berakhir 0.
- Transaksi dua produk yang salah satunya kurang → **seluruhnya** dibatalkan.
- Kasir tidak bisa menulis ke `products`/`transactions` dari browser.
- Kasir tidak bisa menaikkan `role` dirinya sendiri menjadi `admin`.

> Emulator Firebase membutuhkan Java. `firebase-tools` v15+ mensyaratkan
> JDK 21+; project ini memasang `firebase-tools` v13 secara lokal agar tetap
> jalan dengan JDK 17.

---

## 7. Deployment

`.env` yang dibutuhkan:

```env
PORT=3000
NODE_ENV=production
CLIENT_ORIGIN=https://domain-anda.com
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
```

Sebelum rilis pertama:

- [ ] `git log --all -- serviceAccountKey.json` harus kosong
- [ ] Security Rules sudah dideploy dan diuji di emulator
- [ ] `CLIENT_ORIGIN` sesuai domain produksi (kalau tidak, CORS akan menolak)
- [ ] Firebase App Check diaktifkan
- [ ] Indeks komposit dibuat: `npx firebase deploy --only firestore:indexes`

Logika bisnis sengaja diletakkan di `server/services/` dan tidak bergantung
pada Express, sehingga bisa dipindah ke Cloud Functions nanti tanpa mengubah
isinya — cukup mengganti lapisan pemanggilnya.

---

## 8. Belum dikerjakan

- Payment gateway QRIS otomatis (Midtrans/Xendit). MVP memakai QRIS statis
  toko + konfirmasi manual oleh kasir.
- Scan barcode lewat kamera ponsel (saat ini scanner USB dan input manual).
- Cetak struk ke thermal printer (saat ini memakai cetak bawaan browser).
- Multi-cabang, App Check, dan sistem poin pelanggan.
