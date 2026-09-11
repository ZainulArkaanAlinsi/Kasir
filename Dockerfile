# ============================================================================
# KasirOne — image produksi untuk Cloud Run
# ----------------------------------------------------------------------------
# Dua tahap. Tahap pertama memasang seluruh dependensi termasuk yang hanya
# dipakai saat pengujian; tahap kedua menyalin hasilnya lalu membuang yang
# tidak dibutuhkan saat berjalan. Tanpa pemisahan ini, firebase-tools dan
# pustaka uji ikut terbawa ke server produksi — ratusan megabyte yang tidak
# pernah dieksekusi, tapi tetap harus diunduh setiap kali deploy.
# ============================================================================

FROM node:20-alpine AS deps
WORKDIR /app

# package.json dan lock disalin lebih dulu, terpisah dari kode. Selama kedua
# berkas ini tidak berubah, Docker memakai ulang lapisan npm ci dari cache
# dan deploy berikutnya jauh lebih cepat.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ── Tahap jalan ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Cloud Run memberi tahu port lewat variabel PORT; nilai ini hanya cadangan.
ENV PORT=8080

# Berjalan sebagai pengguna biasa, bukan root. Bila suatu saat ada celah yang
# memungkinkan eksekusi perintah, kerusakannya terbatas pada berkas aplikasi.
RUN addgroup -S kasir && adduser -S kasir -G kasir

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=kasir:kasir package.json ./
COPY --chown=kasir:kasir server ./server
COPY --chown=kasir:kasir public ./public

USER kasir
EXPOSE 8080

# Cloud Run memakai endpoint ini untuk tahu kontainer sudah siap melayani.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
