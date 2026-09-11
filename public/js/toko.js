/**
 * Etalase publik (M10).
 *
 * Halaman ini dibuka orang yang belum tentu punya akun, jadi alurnya dibalik
 * dari aplikasi kasir: katalog bisa dilihat tanpa login, dan login baru
 * diminta tepat sebelum pesanan dikirim. Meminta login lebih awal akan
 * mengusir pengunjung sebelum ia sempat melihat barangnya.
 *
 * Keranjang disimpan di localStorage dengan prefiks tersendiri supaya tidak
 * pernah tercampur dengan data kasir di perangkat yang sama.
 */
import { computeTotals } from "./shared/money.js";
import { money, angka, escapeHtml, tanggal } from "./format.js";
import { initApi, getApi } from "./api/index.js";
import { auth, firebaseConfigured, onAuthStateChanged } from "./firebase.js";

const KUNCI_KERANJANG = "kasirone_toko_cart";

const $ = (id) => document.getElementById(id);
const $$ = (s) => document.querySelectorAll(s);

/** @type {{katalog:Array<object>, keranjang:Array<{productId:string,qty:number}>, kategori:string, cara:string, tarif:object, pesananTerakhir:object|null}} */
const state = {
  katalog: [],
  keranjang: [],
  kategori: "Semua",
  cara: "pickup",
  tarif: { pickup: 0, dalam_kota: 10000, luar_kota: 25000 },
  pesananTerakhir: null
};

let toastTimer = null;

/** @param {string} pesan @param {"info"|"error"|"success"} [nada] */
function toast(pesan, nada = "info") {
  const el = $("toast");
  if (!el) return;
  el.textContent = pesan;
  el.dataset.tone = nada;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

const bukaModal = (id) => $(id)?.classList.remove("hidden");
const tutupModal = (id) => $(id)?.classList.add("hidden");

// ── Keranjang ────────────────────────────────────────────────────────────

function muatKeranjang() {
  try {
    const isi = JSON.parse(localStorage.getItem(KUNCI_KERANJANG) || "[]");
    state.keranjang = Array.isArray(isi) ? isi : [];
  } catch {
    state.keranjang = [];
  }
}

function simpanKeranjang() {
  try {
    localStorage.setItem(KUNCI_KERANJANG, JSON.stringify(state.keranjang));
  } catch {
    // Peramban bisa menolak menyimpan (mode privat). Keranjang tetap hidup
    // di memori selama halaman terbuka; tidak perlu menghentikan belanja.
  }
}

/** Menggabungkan baris keranjang dengan data katalog terkini. */
function barisKeranjang() {
  return state.keranjang
    .map((item) => {
      const produk = state.katalog.find((p) => p.id === item.productId);
      if (!produk) return null;
      return { ...produk, qty: item.qty, hargaJual: produk.hargaJual };
    })
    .filter(Boolean);
}

/** Angka keranjang, termasuk ongkir sesuai cara pengambilan yang dipilih. */
function hitungTotal() {
  const baris = barisKeranjang();
  const dasar = computeTotals(baris);
  const ongkir = state.cara === "delivery"
    ? (state.tarif[$("zonaKirim")?.value || "dalam_kota"] ?? state.tarif.dalam_kota)
    : 0;
  return { ...dasar, ongkir, total: dasar.total + ongkir };
}

/**
 * Menambah barang ke keranjang, dibatasi stok yang benar-benar tersedia.
 * @param {string} productId
 */
function tambah(productId) {
  const produk = state.katalog.find((p) => p.id === productId);
  if (!produk || produk.habis) return;

  const ada = state.keranjang.find((i) => i.productId === productId);
  const qtyBaru = (ada?.qty ?? 0) + 1;

  if (qtyBaru > produk.tersedia) {
    toast(`Stok ${produk.name} tinggal ${produk.tersedia}.`, "error");
    return;
  }

  if (ada) ada.qty = qtyBaru;
  else state.keranjang.push({ productId, qty: 1 });

  simpanKeranjang();
  gambarKeranjang();
  toast(`${produk.name} masuk keranjang.`, "success");
}

/** @param {string} productId @param {number} delta */
function ubahQty(productId, delta) {
  const item = state.keranjang.find((i) => i.productId === productId);
  if (!item) return;

  const produk = state.katalog.find((p) => p.id === productId);
  const qtyBaru = item.qty + delta;

  if (qtyBaru <= 0) {
    state.keranjang = state.keranjang.filter((i) => i.productId !== productId);
  } else if (produk && qtyBaru > produk.tersedia) {
    toast(`Stok ${produk.name} tinggal ${produk.tersedia}.`, "error");
    return;
  } else {
    item.qty = qtyBaru;
  }

  simpanKeranjang();
  gambarKeranjang();
}

// ── Render ───────────────────────────────────────────────────────────────

/** Gambar media produk: foto asli bila ada, monogram bila belum. */
function media(p) {
  const inisial = escapeHtml((p.name ?? "?").trim().charAt(0).toUpperCase());
  return p.imageUrl
    ? `<img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.name)}" loading="lazy">`
    : `<div class="monogram">${inisial}</div>`;
}

function gambarKategori() {
  const wadah = $("barisKategori");
  if (!wadah) return;

  const daftar = ["Semua", ...new Set(state.katalog.map((p) => p.category).filter(Boolean))];
  wadah.innerHTML = daftar.map((k) => `
    <button class="category-btn ${k === state.kategori ? "active" : ""}" data-kategori="${escapeHtml(k)}">
      ${escapeHtml(k)}
    </button>`).join("");

  wadah.querySelectorAll("[data-kategori]").forEach((b) => {
    b.onclick = () => {
      state.kategori = b.dataset.kategori;
      gambarKategori();
      gambarKatalog();
    };
  });
}

function gambarKatalog() {
  const grid = $("gridKatalog");
  if (!grid) return;

  const cari = ($("cariProduk")?.value || "").toLowerCase().trim();
  const list = state.katalog.filter((p) => {
    const cocokKategori = state.kategori === "Semua" || p.category === state.kategori;
    const cocokCari = !cari || p.name?.toLowerCase().includes(cari) || p.sku?.toLowerCase().includes(cari);
    return cocokKategori && cocokCari;
  });

  if (list.length === 0) {
    grid.innerHTML = `<p class="muted" style="grid-column:1/-1;padding:40px 0;text-align:center">Tidak ada barang yang cocok.</p>`;
    return;
  }

  grid.innerHTML = list.map((p) => `
    <article class="toko-kartu ${p.habis ? "habis" : ""}">
      <div class="toko-media">
        ${media(p)}
        ${p.habis
          ? `<span class="badge out-badge chip">Habis</span>`
          : p.tersedia <= 5 ? `<span class="badge low-badge chip">Sisa ${angka(p.tersedia)}</span>` : ""}
      </div>
      <div class="toko-isi">
        <h3>${escapeHtml(p.name)}</h3>
        <p class="kategori">${escapeHtml(p.category ?? "Umum")}</p>
        <div class="toko-bawah">
          <span class="toko-harga">${money(p.hargaJual)}</span>
          <button class="add-btn" data-tambah="${escapeHtml(p.id)}" ${p.habis ? "disabled" : ""}
                  aria-label="Tambah ${escapeHtml(p.name)}">+</button>
        </div>
      </div>
    </article>`).join("");

  grid.querySelectorAll("[data-tambah]").forEach((b) => {
    b.onclick = () => tambah(b.dataset.tambah);
  });
}

function gambarKeranjang() {
  const baris = barisKeranjang();
  const jumlah = baris.reduce((s, i) => s + i.qty, 0);

  if ($("hitungKeranjang")) $("hitungKeranjang").textContent = String(jumlah);
  if ($("ringkasKeranjang")) $("ringkasKeranjang").textContent = `${jumlah} item`;

  const wadah = $("isiKeranjang");
  if (wadah) {
    wadah.innerHTML = baris.length
      ? baris.map((i) => `
        <div class="cart-item">
          <div class="cart-item-top">
            <div><strong>${escapeHtml(i.name)}</strong><br><small>${money(i.hargaJual)} &times; ${i.qty}</small></div>
            <b>${money(i.hargaJual * i.qty)}</b>
          </div>
          <div class="qty-row">
            <button class="qty-btn" data-kurang="${escapeHtml(i.id)}" aria-label="Kurangi">&minus;</button>
            <span>${i.qty}</span>
            <button class="qty-btn" data-tambah-qty="${escapeHtml(i.id)}" aria-label="Tambah">+</button>
          </div>
        </div>`).join("")
      : `<div class="empty-cart">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><use href="#i-bag"/></svg>
           <div>Keranjang masih kosong.</div>
         </div>`;

    wadah.querySelectorAll("[data-kurang]").forEach((b) => { b.onclick = () => ubahQty(b.dataset.kurang, -1); });
    wadah.querySelectorAll("[data-tambah-qty]").forEach((b) => { b.onclick = () => ubahQty(b.dataset.tambahQty, 1); });
  }

  const t = hitungTotal();
  if ($("subtotalKeranjang")) $("subtotalKeranjang").textContent = money(t.subtotal);
  if ($("pajakKeranjang")) $("pajakKeranjang").textContent = money(t.tax);
  if ($("ongkirKeranjang")) $("ongkirKeranjang").textContent = money(t.ongkir);
  if ($("totalKeranjang")) $("totalKeranjang").textContent = money(t.total);
  if ($("totalCheckout")) $("totalCheckout").textContent = money(t.total);
  if ($("lanjutCheckout")) $("lanjutCheckout").disabled = baris.length === 0;
}

// ── Pemesanan ────────────────────────────────────────────────────────────

async function kirimPesanan(tombol) {
  const baris = barisKeranjang();
  if (baris.length === 0) return;

  const telepon = $("teleponPemesan")?.value.trim() || "";
  if (telepon.length < 8) {
    toast("Nomor WhatsApp diperlukan agar toko bisa menghubungi Anda.", "error");
    return;
  }

  const pengiriman = { cara: state.cara, catatan: $("catatanPesanan")?.value.trim() || "" };
  if (state.cara === "delivery") {
    const alamat = $("alamatKirim")?.value.trim() || "";
    if (alamat.length < 10) {
      toast("Alamat pengiriman perlu ditulis lebih lengkap.", "error");
      return;
    }
    pengiriman.alamat = alamat;
    pengiriman.zona = $("zonaKirim")?.value || "dalam_kota";
  }

  tombol.disabled = true;
  try {
    const pesanan = await getApi().buatPesanan({
      items: state.keranjang.map(({ productId, qty }) => ({ productId, qty })),
      telepon,
      pengiriman
    });

    state.pesananTerakhir = pesanan;
    state.keranjang = [];
    simpanKeranjang();
    gambarKeranjang();

    tutupModal("modalCheckout");
    tutupKeranjangPanel();
    tampilkanBerhasil(pesanan);

    // Stok berubah setelah dikunci, jadi katalog disegarkan agar pembeli
    // berikutnya melihat sisa yang benar.
    await muatKatalog();
  } catch (error) {
    toast(error?.message || "Pesanan gagal dibuat.", "error");
  } finally {
    tombol.disabled = false;
  }
}

function tampilkanBerhasil(pesanan) {
  if ($("teksBerhasil")) {
    $("teksBerhasil").textContent = `${pesanan.orderNumber} · ${money(pesanan.total)}`;
  }

  const item = (pesanan.lines ?? []).map((l) => `
    <div class="receipt-line"><span>${escapeHtml(l.name)} &times;${l.qty}</span><span>${money(l.hargaJual * l.qty)}</span></div>`).join("");

  const kirim = pesanan.pengiriman ?? {};
  if ($("rincianPesanan")) {
    $("rincianPesanan").innerHTML = `
      <strong>${escapeHtml(pesanan.orderNumber)}</strong><br>
      ${escapeHtml(kirim.cara === "delivery" ? "Diantar" : "Ambil di toko")}
      ${kirim.alamat ? `<br>${escapeHtml(kirim.alamat)}` : ""}
      <hr>${item}<hr>
      <div class="receipt-line"><span>Subtotal</span><span>${money(pesanan.subtotal)}</span></div>
      <div class="receipt-line"><span>Pajak</span><span>${money(pesanan.tax)}</span></div>
      <div class="receipt-line"><span>Ongkir</span><span>${money(pesanan.ongkir)}</span></div>
      <div class="receipt-line"><strong>Total</strong><strong>${money(pesanan.total)}</strong></div>`;
  }
  bukaModal("modalBerhasil");
}

async function tampilkanPesananSaya() {
  const wadah = $("daftarPesananSaya");
  if (!wadah) return;

  try {
    const daftar = await getApi().daftarPesanan({ limit: 20 });
    const LABEL = {
      menunggu_bayar: "Menunggu bayar", dibayar: "Sudah dibayar", disiapkan: "Sedang disiapkan",
      siap_diambil: "Siap diambil", dikirim: "Dalam pengiriman", selesai: "Selesai",
      batal: "Dibatalkan", kedaluwarsa: "Kedaluwarsa"
    };

    wadah.innerHTML = daftar.length
      ? daftar.map((o) => `
        <div class="pesanan-baris">
          <div>
            <strong>${escapeHtml(o.orderNumber ?? o.id)}</strong>
            <span>${escapeHtml(tanggal(o.createdAt))} &middot; ${escapeHtml(o.pengiriman?.cara === "delivery" ? "Diantar" : "Ambil di toko")}</span>
          </div>
          <div style="text-align:right">
            <b>${money(o.total)}</b>
            <span class="badge ${["batal", "kedaluwarsa"].includes(o.status) ? "out-badge" : o.status === "menunggu_bayar" ? "low-badge" : ""}" style="margin-top:4px">
              ${escapeHtml(LABEL[o.status] ?? o.status)}
            </span>
          </div>
        </div>`).join("")
      : `<p class="muted">Belum ada pesanan.</p>`;

    bukaModal("modalPesananSaya");
  } catch (error) {
    toast(error?.message || "Gagal memuat pesanan.", "error");
  }
}

// ── Panel keranjang ──────────────────────────────────────────────────────

function bukaKeranjangPanel() {
  $("panelKeranjang")?.classList.remove("hidden");
  $("tirai")?.classList.remove("hidden");
}

function tutupKeranjangPanel() {
  $("panelKeranjang")?.classList.add("hidden");
  $("tirai")?.classList.add("hidden");
}

// ── Pemuatan awal ────────────────────────────────────────────────────────

async function muatKatalog() {
  try {
    state.katalog = await getApi().listKatalog();
    gambarKategori();
    gambarKatalog();
    gambarKeranjang();
  } catch (error) {
    const grid = $("gridKatalog");
    if (grid) {
      grid.innerHTML = `<p class="muted" style="grid-column:1/-1;padding:40px 0;text-align:center">
        ${escapeHtml(error?.message || "Katalog gagal dimuat.")}</p>`;
    }
  }
}

async function muatTarif() {
  try {
    const opsi = await getApi().opsiPengiriman();
    state.tarif = { pickup: 0, ...opsi.tarif };
    const teks = money(state.tarif.dalam_kota);
    if ($("tarifDalamKota")) $("tarifDalamKota").textContent = teks;
    if ($("tarifAntar")) $("tarifAntar").textContent = teks;
  } catch {
    // Tarif bawaan sudah cukup masuk akal; kegagalan di sini tidak boleh
    // menghentikan pengunjung melihat barang.
  }
}

function pasangEvent() {
  $("cariProduk")?.addEventListener("input", gambarKatalog);
  $("bukaKeranjang")?.addEventListener("click", bukaKeranjangPanel);
  $("tutupKeranjang")?.addEventListener("click", tutupKeranjangPanel);
  $("tirai")?.addEventListener("click", tutupKeranjangPanel);

  $("lanjutCheckout")?.addEventListener("click", () => {
    gambarKeranjang();
    bukaModal("modalCheckout");
  });

  $$("[data-cara]").forEach((b) => {
    b.addEventListener("click", () => {
      $$("[data-cara]").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      state.cara = b.dataset.cara;
      $("areaAlamat")?.classList.toggle("hidden", state.cara !== "delivery");
      gambarKeranjang();
    });
  });

  $("zonaKirim")?.addEventListener("change", gambarKeranjang);
  $("kirimPesanan")?.addEventListener("click", (e) => kirimPesanan(e.currentTarget));

  $("belanjaLagi")?.addEventListener("click", () => tutupModal("modalBerhasil"));
  $("lihatPesanan")?.addEventListener("click", async () => {
    tutupModal("modalBerhasil");
    await tampilkanPesananSaya();
  });

  $$("[data-close]").forEach((b) => b.addEventListener("click", () => tutupModal(b.dataset.close)));

  // Nav bawah ponsel. Tiap tab memicu aksi yang sudah ada, bukan halaman
  // terpisah — etalase ini satu layar dengan beberapa lapisan.
  $$("[data-tab]").forEach((b) => {
    b.addEventListener("click", async () => {
      const tab = b.dataset.tab;
      $$("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));

      if (tab === "keranjang") { bukaKeranjangPanel(); return; }
      if (tab === "pesanan") { await tampilkanPesananSaya(); return; }
      if (tab === "cari") { $("cariProduk")?.focus(); $("cariProduk")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    $$(".modal:not(.hidden)").forEach((m) => m.classList.add("hidden"));
    tutupKeranjangPanel();
  });
}

/**
 * Menyalakan etalase.
 *
 * Mode ditentukan oleh ada tidaknya konfigurasi Firebase. Tanpa Firebase,
 * etalase memakai data demo yang sama dengan aplikasi kasir sehingga alurnya
 * tetap bisa dicoba dari ujung ke ujung.
 */
async function mulai() {
  muatKeranjang();
  pasangEvent();

  if (firebaseConfigured && auth) {
    initApi({ mode: "live", getToken: async () => auth.currentUser?.getIdToken() ?? "" });
    onAuthStateChanged(auth, (user) => {
      if ($("akunLabel")) {
        $("akunLabel").innerHTML = `<i></i> ${user ? escapeHtml(user.email?.split("@")[0] ?? "Akun saya") : "Pengunjung"}`;
      }
    });
  } else {
    initApi({ mode: "demo" });
    if ($("akunLabel")) $("akunLabel").innerHTML = `<i></i> Mode demo`;
  }

  await muatTarif();
  await muatKatalog();
}

mulai();
