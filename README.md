# KasirOne — Modern POS

Project kasir untuk VS Code menggunakan:
- HTML
- CSS
- JavaScript ES Modules
- Node.js
- Express
- Firebase Authentication
- Cloud Firestore
- Firebase Security Rules

## 1. Persiapan

Install Node.js lalu buka folder ini di VS Code.

Jalankan:

```bash
npm install
```

Salin `.env.example` menjadi `.env`.

Lalu jalankan:

```bash
npm run dev
```

Buka:

`http://localhost:3000`

## 2. Mode demo

Klik **Demo tanpa login** untuk mencoba UI dan alur transaksi tanpa Firebase.

Data demo transaksi disimpan di localStorage browser.

## 3. Firebase

Di Firebase Console:
1. Buat project baru.
2. Register Web App.
3. Aktifkan Authentication > Email/Password.
4. Buat Cloud Firestore.
5. Masukkan konfigurasi Web App ke `public/firebase-config.js`.
6. Buat akun kasir lewat Firebase Authentication.
7. Buat dokumen `users/{UID}` dengan contoh:

```json
{
  "role": "cashier",
  "displayName": "Kasir 1"
}
```

Untuk admin:

```json
{
  "role": "admin",
  "displayName": "Admin"
}
```

Deploy/test Security Rules dari `firestore.rules`.

## 4. Firebase Admin untuk backend

Backend Express mempunyai endpoint terlindungi `/api/me` dan `/api/audit`.

Download service account dari Firebase/Google Cloud hanya untuk server.
Simpan sebagai:

`serviceAccountKey.json`

Kemudian `.env`:

```env
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
```

JANGAN commit file tersebut ke GitHub. Sudah dimasukkan ke `.gitignore`.

## 5. Catatan keamanan

- Firebase Web API key bukan password.
- Jangan menaruh service-account private key di frontend.
- Security Rules tetap wajib dipasang.
- Backend memverifikasi Firebase ID token.
- API memakai Helmet, CORS, rate limiting, body-size limit dan validasi dasar.
- Untuk produksi, transaksi dan perubahan stok harus divalidasi/atomic di backend atau Cloud Functions.
- Jangan percaya harga, total, diskon, atau stok yang dikirim browser.
- QRIS pada project ini masih DEMO UI, bukan pembayaran QRIS sungguhan.

## 6. Struktur

```text
kasir-modern/
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── firebase-config.js
├── server/
│   └── server.js
├── firestore.rules
├── firebase.json
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## 7. Pengembangan berikutnya

Untuk versi produksi:
- Firebase App Check
- Cloud Functions untuk transaksi atomik
- Role claims
- Stock reservation
- Payment gateway QRIS resmi
- Barcode scanner
- PDF/thermal receipt
- Backup/export
- Audit log lebih lengkap
- Emulator Suite untuk pengujian Security Rules
