# KasirOne — Referensi API

Semua endpoint diawali `/api`. Kecuali `/api/health`, seluruhnya memerlukan
header `Authorization: Bearer <Firebase ID Token>` dan profil pengguna dengan
role `admin` atau `cashier`.

Respons sukses selalu berbentuk `{ "data": ... }`.
Respons gagal selalu berbentuk `{ "error": "pesan", "code": "KODE", "details"?: {...} }`.

## Aturan keamanan yang berlaku di semua endpoint

- Harga, total, dan stok **tidak pernah** diambil dari body request. Server
  membacanya ulang dari Firestore.
- Rate limit 300 request / 15 menit per IP.
- Body maksimal 100 KB.
- Pesan error internal tidak pernah diteruskan ke klien.

---

## Umum

| Method | Path | Role | Keterangan |
|---|---|---|---|
| GET | `/api/health` | publik | Cek server & status Firebase Admin |
| GET | `/api/me` | staf | Profil + role pengguna yang sedang login |
| POST | `/api/audit` | staf | Mencatat aksi ke `auditLogs` |

## Produk

| Method | Path | Role | Body |
|---|---|---|---|
| GET | `/api/products` | staf | — |
| GET | `/api/products/sku/:sku` | staf | — (dipakai scan barcode) |
| POST | `/api/products` | admin | `{name, sku, category, hargaModal, hargaJual, stok, stokMinimum}` |
| PATCH | `/api/products/:id` | admin | field mana pun di atas (parsial) |
| DELETE | `/api/products/:id` | admin | — (soft delete: `aktif:false`) |

Validasi: `hargaJual >= hargaModal`, `sku` unik, semua angka bilangan bulat >= 0.

**Kode error:** `DUPLICATE_SKU`, `PRICE_BELOW_COST`, `NOT_FOUND`

## Transaksi

| Method | Path | Role | Body |
|---|---|---|---|
| POST | `/api/transactions` | staf | lihat di bawah |
| GET | `/api/transactions?from=&to=&cashierUid=&limit=` | staf | — |

```jsonc
// POST /api/transactions
{
  "items": [{ "productId": "abc123", "qty": 2 }],  // HANYA id + qty
  "paymentMethod": "cash",                          // cash | card | qris
  "cashReceived": 50000,                            // wajib bila cash
  "discount": 0,
  "qrisReference": "INV-88213"                      // opsional, bila qris
}
```

Diproses dalam satu Firestore transaction: cek stok, kurangi stok, simpan
transaksi, dan tulis audit log — semuanya berhasil bersama atau gagal bersama.

**Kode error:** `EMPTY_CART`, `DUPLICATE_ITEM`, `INSUFFICIENT_STOCK` (disertai
`details.kurang[]`), `INSUFFICIENT_CASH`, `PRODUCT_INACTIVE`, `NOT_FOUND`

## Pengeluaran & Restock

| Method | Path | Role | Body |
|---|---|---|---|
| POST | `/api/expenses` | admin | `{type:"operasional"\|"lainnya", amount, note}` |
| POST | `/api/expenses/restock` | admin | `{productId, qty, hargaModalBaru?, note?}` |
| GET | `/api/expenses?from=&to=&limit=` | admin | — |

Restock bersifat atomik: stok bertambah **dan** pengeluaran tercatat sekaligus.
Nominal dihitung server (`hargaModal x qty`), bukan dikirim browser.

## Laporan

| Method | Path | Role |
|---|---|---|
| GET | `/api/reports?period=week` | admin |
| GET | `/api/reports?from=2026-09-01&to=2026-09-30` | admin |

`period`: `today` \| `week` (7 hari) \| `month` (30 hari). Nilai tak dikenal
diperlakukan sebagai `week`. Rentang kustom maksimal 366 hari.

```jsonc
// Respons
{
  "pemasukan": 1250000, "pengeluaran": 400000,
  "labaKotor": 310000, "labaBersih": -90000,
  "jumlahTransaksi": 48, "rataRataTransaksi": 26041, "totalItemTerjual": 132,
  "perMetodeBayar": { "cash": { "jumlah": 30, "total": 800000 } },
  "produkTerjual": [
    { "name": "Top Kopi Aren", "qty": 40, "omzet": 260000, "laba": 68000 },
    { "name": "Indomie Goreng", "qty": 23, "omzet": 80500, "laba": 16100 }
  ],
  "grafikHarian": [{ "label": "Sen", "tanggal": "2026-09-04", "total": 120000 }]
}
```

---

## Pesanan online

| Method | Path | Role | Keterangan |
|---|---|---|---|
| GET | `/api/orders/opsi-pengiriman` | staf & pelanggan | Cara ambil dan tarif ongkir |
| POST | `/api/orders` | pelanggan | Membuat pesanan, mengunci stok |
| GET | `/api/orders` | staf (semua) / pelanggan (miliknya) | Daftar pesanan |
| GET | `/api/orders/:id` | staf / pemilik | Detail satu pesanan |
| PATCH | `/api/orders/:id/status` | staf / pemilik (batal saja) | Memindahkan status |
| POST | `/api/orders/bersihkan-kedaluwarsa` | admin | Melepas kunci pesanan lewat waktu |

```jsonc
// POST /api/orders
{
  "items": [{ "productId": "abc123", "qty": 2 }],
  "telepon": "08123456789",
  "pengiriman": {
    "cara": "delivery",              // "pickup" | "delivery"
    "zona": "dalam_kota",            // hanya untuk delivery
    "alamat": "Jl. Melati No. 12…",  // wajib untuk delivery, min 10 karakter
    "catatan": "Titip ke satpam"
  }
}
```

**Status dan perpindahan yang sah.** Perpindahan di luar tabel ini ditolak
dengan `INVALID_TRANSITION`, sehingga pesanan tidak bisa ditandai selesai
tanpa pernah dibayar.

| Dari | Boleh menjadi |
|---|---|
| `menunggu_bayar` | `dibayar`, `batal`, `kedaluwarsa` |
| `dibayar` | `disiapkan`, `batal` |
| `disiapkan` | `siap_diambil`, `dikirim`, `batal` |
| `siap_diambil` | `selesai`, `batal` |
| `dikirim` | `selesai` |
| `selesai` / `batal` / `kedaluwarsa` | — (akhir) |

**Pengaruh ke stok:** memesan menaikkan `stokDipesan`; `batal` dan
`kedaluwarsa` menurunkannya kembali; `selesai` menurunkan `stok` sekaligus
`stokDipesan`.

**Kode error:** `INSUFFICIENT_STOCK`, `INVALID_TRANSITION`,
`CANCEL_NOT_ALLOWED`, `NOT_FOUND`
