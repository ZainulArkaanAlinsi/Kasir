#!/usr/bin/env node
/**
 * Membuat ikon aplikasi (PNG) untuk layar utama ponsel.
 *
 * Ditulis sendiri alih-alih menambah pustaka gambar: yang dibutuhkan hanya
 * kotak bersudut bulat dengan huruf K di tengahnya, dan menarik pustaka
 * pengolah gambar untuk itu jelas berlebihan. Dengan skrip ini ikonnya juga
 * bisa dibuat ulang kapan saja bila warnanya berubah — bukan berupa berkas
 * biner yang asal-usulnya tidak diketahui siapa pun.
 *
 * Jalankan: node scripts/buat-ikon.js
 */
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TUJUAN = path.join(__dirname, "../public/icons");

/** Palet KasirOne. */
const TERAKOTA = [209, 129, 102, 255];
const CHARCOAL = [54, 64, 66, 255];
const PUTIH = [255, 255, 255, 255];

/** CRC32, dibutuhkan setiap chunk PNG. */
const TABEL_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABEL_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Membungkus data menjadi satu chunk PNG lengkap dengan panjang dan CRC. */
function chunk(jenis, data) {
  const panjang = Buffer.alloc(4);
  panjang.writeUInt32BE(data.length);
  const isi = Buffer.concat([Buffer.from(jenis, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(isi));
  return Buffer.concat([panjang, isi, crc]);
}

/**
 * Menyusun PNG RGBA dari buffer piksel mentah.
 * @param {number} sisi lebar = tinggi
 * @param {Buffer} piksel panjangnya sisi*sisi*4
 */
function susunPng(sisi, piksel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(sisi, 0);
  ihdr.writeUInt32BE(sisi, 4);
  ihdr[8] = 8;    // kedalaman bit
  ihdr[9] = 6;    // RGBA
  // 10-12: kompresi, filter, interlace — semuanya 0

  // Tiap baris diawali satu bita penanda filter (0 = tanpa filter).
  const baris = Buffer.alloc(sisi * (sisi * 4 + 1));
  for (let y = 0; y < sisi; y++) {
    baris[y * (sisi * 4 + 1)] = 0;
    piksel.copy(baris, y * (sisi * 4 + 1) + 1, y * sisi * 4, (y + 1) * sisi * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(baris, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/**
 * Menggambar ikon: kotak terakota bersudut bulat, bergaris charcoal, huruf K
 * putih di tengah.
 *
 * @param {number} sisi ukuran sisi dalam piksel
 * @param {boolean} penuh true = tanpa margin, untuk ikon maskable dan iOS
 *        yang sudutnya dipangkas sendiri oleh sistem operasi
 */
function gambarIkon(sisi, penuh) {
  const px = Buffer.alloc(sisi * sisi * 4);   // transparan
  const tepi = penuh ? 0 : Math.round(sisi * 0.08);
  const kotak = sisi - tepi * 2;
  const radius = Math.round(kotak * 0.22);
  const garis = Math.max(2, Math.round(sisi * 0.012));

  const taruh = (x, y, warna) => {
    if (x < 0 || y < 0 || x >= sisi || y >= sisi) return;
    const i = (y * sisi + x) * 4;
    px[i] = warna[0]; px[i + 1] = warna[1]; px[i + 2] = warna[2]; px[i + 3] = warna[3];
  };

  /** Apakah titik ada di dalam kotak bersudut bulat yang menyusut `susut` px? */
  const didalam = (x, y, susut) => {
    const kiri = tepi + susut, atas = tepi + susut;
    const kanan = tepi + kotak - 1 - susut, bawah = tepi + kotak - 1 - susut;
    if (x < kiri || x > kanan || y < atas || y > bawah) return false;
    const r = Math.max(0, radius - susut);
    const dx = x < kiri + r ? kiri + r - x : x > kanan - r ? x - (kanan - r) : 0;
    const dy = y < atas + r ? atas + r - y : y > bawah - r ? y - (bawah - r) : 0;
    return dx * dx + dy * dy <= r * r;
  };

  for (let y = 0; y < sisi; y++) {
    for (let x = 0; x < sisi; x++) {
      if (!didalam(x, y, 0)) continue;
      taruh(x, y, didalam(x, y, garis) ? TERAKOTA : CHARCOAL);
    }
  }

  // Huruf K: satu tiang tegak dan dua kaki miring yang bertemu di tengah
  // tiang. Digambar sebagai bidang padat supaya tetap tegas terbaca pada
  // ukuran 48 piksel di layar ponsel.
  const tinggi = Math.round(kotak * 0.44);
  const atasK = Math.round(tepi + (kotak - tinggi) / 2);
  const bawahK = atasK + tinggi;
  const tengahK = Math.round((atasK + bawahK) / 2);
  const tebal = Math.max(3, Math.round(kotak * 0.085));
  const tiangX = Math.round(tepi + kotak * 0.34);

  for (let y = atasK; y <= bawahK; y++) {
    for (let t = 0; t < tebal; t++) taruh(tiangX + t, y, PUTIH);

    const jarak = Math.abs(y - tengahK);
    const kakiX = tiangX + tebal + Math.round(jarak * 1.05);
    for (let t = 0; t < tebal; t++) {
      if (kakiX + t < tepi + kotak - garis * 2) taruh(kakiX + t, y, PUTIH);
    }
  }

  return susunPng(sisi, px);
}

fs.mkdirSync(TUJUAN, { recursive: true });

const berkas = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true]
];

for (const [nama, sisi, penuh] of berkas) {
  const tujuan = path.join(TUJUAN, nama);
  fs.writeFileSync(tujuan, gambarIkon(sisi, penuh));
  console.log(`  ${nama.padEnd(24)} ${sisi}x${sisi}  ${fs.statSync(tujuan).size} bita`);
}

console.log(`\nIkon dibuat di ${path.relative(process.cwd(), TUJUAN)}`);
