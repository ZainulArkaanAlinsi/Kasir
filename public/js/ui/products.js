/**
 * Tampilan produk: grid di halaman Kasir, kartu + tabel di halaman Produk.
 * Hanya urusan render + input; seluruh penyimpanan lewat lapisan API.
 *
 * Semua angka di sini berasal dari katalog yang dimuat dari server
 * (`listProducts`) — tidak ada daftar contoh yang ditanam di kode.
 */
import { get, set } from "../state.js";
import { $, showToast, showApiError, closeModal, openModal, withBusy } from "./shell.js";
import { money, angka, escapeHtml } from "../format.js";
import { stockStatus, stokTersedia, STOK_MINIMUM_DEFAULT } from "../shared/product.js";
import { getApi } from "../api/index.js";
import { addToCart, changeQty } from "./cart.js";
import { bacaGambar } from "./image-upload.js";
import { tileBg, initials, dotClass, badgeClass } from "./tile.js";

/** Foto yang sedang dipilih di form produk (data URL), null bila belum ada. */
let fotoTerpilih = null;

/** Filter status yang sedang aktif di halaman Produk. */
let filterProduk = "Semua";

/**
 * Menggambar isi ubin produk: foto asli bila ada, monogram bila belum.
 * Monogram dipilih alih-alih emoji karena emoji terbaca sebagai ilustrasi,
 * sedangkan kartu ini seharusnya memajang barang sungguhan.
 *
 * @param {object} p produk
 * @returns {string} HTML
 */
function mediaProduk(p) {
  if (p.imageUrl) {
    return `<img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.name)}" loading="lazy">`;
  }
  return `<div class="monogram">${escapeHtml(initials(p.name))}</div>`;
}

/** Menggambar tombol filter kategori dari data produk yang ada. */
export function renderCategories() {
  const container = $("categoryRow");
  if (!container) return;

  const kategori = ["Semua", ...new Set(get("products").map((p) => p.category).filter(Boolean))];
  const aktif = get("activeCategory");

  container.innerHTML = kategori.map((c) => `
    <button class="category-btn ${c === aktif ? "active" : ""}" data-category="${escapeHtml(c)}">
      ${escapeHtml(c)}
    </button>`).join("");

  container.querySelectorAll("[data-category]").forEach((btn) => {
    btn.onclick = () => {
      set("activeCategory", btn.dataset.category);
      renderCategories();
      renderProductGrid();
    };
  });
}

/** Produk yang lolos pencarian & kategori pada halaman Kasir. */
function produkTerlihat() {
  const query = ($("productSearch")?.value || "").toLowerCase().trim();
  const kategori = get("activeCategory");

  return get("products").filter((p) => {
    const cocokKategori = kategori === "Semua" || p.category === kategori;
    const cocokCari = !query
      || p.name?.toLowerCase().includes(query)
      || p.sku?.toLowerCase().includes(query);
    return cocokKategori && cocokCari;
  });
}

/**
 * Grid produk yang bisa diklik untuk masuk keranjang.
 *
 * Produk yang sudah ada di keranjang memperlihatkan stepper −/+ langsung
 * di kartunya. Tanpa itu kasir harus membuka panel keranjang cuma untuk
 * menambah satu bungkus lagi.
 */
export function renderProductGrid() {
  const container = $("productGrid");
  if (!container) return;

  const list = produkTerlihat();
  const keranjang = get("cart");

  const hitung = $("visibleCount");
  if (hitung) hitung.textContent = `${angka(list.length)} item`;

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-cart" style="grid-column:1/-1">Tidak ada produk yang cocok.</div>`;
    return;
  }

  container.innerHTML = list.map((p, i) => {
    const status = stockStatus(p);
    const habis = status.tone === "habis";
    const qty = keranjang.find((item) => item.productId === p.id)?.qty ?? 0;
    const label = habis ? "Habis" : `Stok ${angka(stokTersedia(p))}`;

    const aksi = qty > 0
      ? `<span class="stepper">
           <button type="button" data-dec="${escapeHtml(p.id)}" aria-label="Kurangi ${escapeHtml(p.name)}">&minus;</button>
           <span>${angka(qty)}</span>
           <button type="button" class="plus" data-add="${escapeHtml(p.id)}" aria-label="Tambah ${escapeHtml(p.name)}">+</button>
         </span>`
      : `<button class="add-btn" data-add="${escapeHtml(p.id)}" ${habis ? "disabled" : ""}
                 aria-label="Tambah ${escapeHtml(p.name)}">+</button>`;

    return `
      <article class="product-card ${habis ? "is-out" : ""}" style="animation-delay:${Math.min(i, 8) * 0.03}s">
        <div class="product-media" style="background:${tileBg(p.category)}">
          ${mediaProduk(p)}
          <span class="stock-chip"><i class="${dotClass(status.tone)}"></i>${label}</span>
          ${qty > 0 ? `<span class="qty-flag">${angka(qty)}</span>` : ""}
        </div>
        <div class="product-body">
          <h4>${escapeHtml(p.name)}</h4>
          <p class="product-meta admin-only">modal ${money(p.hargaModal)}</p>
          <div class="product-bottom">
            <span class="product-price">${money(p.hargaJual)}</span>
            ${aksi}
          </div>
        </div>
      </article>`;
  }).join("");

  container.querySelectorAll("[data-add]").forEach((btn) => {
    btn.onclick = () => {
      const product = get("products").find((p) => p.id === btn.dataset.add);
      if (product) addToCart(product);
    };
  });
  container.querySelectorAll("[data-dec]").forEach((btn) => {
    btn.onclick = () => changeQty(btn.dataset.dec, -1);
  });
}

/** Persentase isi gauge stok: penuh = tiga kali ambang minimum. */
function persenStok(p) {
  const minimum = Number(p.stokMinimum ?? STOK_MINIMUM_DEFAULT) || 1;
  const persen = Math.round((stokTersedia(p) / (minimum * 3)) * 100);
  return Math.max(0, Math.min(100, persen));
}

/** Margin dalam persen terhadap harga jual. */
function persenMargin(p) {
  const jual = Number(p.hargaJual) || 0;
  if (jual <= 0) return "0%";
  return `${Math.round(((jual - (Number(p.hargaModal) || 0)) / jual) * 100)}%`;
}

/** Tombol filter status pada halaman Produk, lengkap dengan jumlahnya. */
function renderProdukFilters(list) {
  const container = $("produkFilterRow");
  if (!container) return;

  const jumlah = {
    Semua: list.length,
    Menipis: list.filter((p) => stockStatus(p).tone === "menipis").length,
    Habis: list.filter((p) => stockStatus(p).tone === "habis").length
  };

  container.innerHTML = Object.entries(jumlah).map(([label, n]) => `
    <button class="category-btn ${label === filterProduk ? "active" : ""}" data-filter="${label}">
      ${label} · ${angka(n)}
    </button>`).join("");

  container.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.onclick = () => {
      filterProduk = btn.dataset.filter;
      renderProductTable();
    };
  });
}

/**
 * Kartu produk untuk layar sempit: modal, harga jual, margin, dan
 * indikator stok dalam satu blok — tabel delapan kolom tidak terbaca di
 * layar selebar telapak tangan.
 *
 * @param {Array<object>} list
 */
function renderManageList(list) {
  const container = $("manageList");
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-cart">Belum ada produk pada filter ini.</div>`;
    return;
  }

  container.innerHTML = list.map((p, i) => {
    const status = stockStatus(p);
    const foto = p.imageUrl
      ? `<img src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy">`
      : escapeHtml(initials(p.name));

    return `
      <article class="manage-card" style="animation-delay:${Math.min(i, 8) * 0.03}s">
        <div class="manage-top">
          <span class="manage-tile" style="background:${tileBg(p.category)}">${foto}</span>
          <div class="manage-id">
            <strong>${escapeHtml(p.name)}</strong>
            <span>SKU ${escapeHtml(p.sku ?? "-")} · ${escapeHtml(p.category ?? "-")}</span>
          </div>
          <button class="icon-btn admin-only" data-restock="${escapeHtml(p.id)}" title="Restock" aria-label="Restock ${escapeHtml(p.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><use href="#i-refresh"/></svg>
          </button>
        </div>

        <div class="manage-figures">
          <span class="admin-only"><b>MODAL</b><strong>${money(p.hargaModal)}</strong></span>
          <span><b>JUAL</b><strong>${money(p.hargaJual)}</strong></span>
          <span class="margin admin-only"><b>MARGIN</b><strong>${persenMargin(p)}</strong></span>
        </div>

        <div class="manage-foot">
          <span class="gauge"><i class="${status.tone}" style="width:${persenStok(p)}%"></i></span>
          <span class="badge ${badgeClass(status.tone)}">${status.label}</span>
          <span class="stok-text">${angka(stokTersedia(p))} / min ${angka(p.stokMinimum ?? STOK_MINIMUM_DEFAULT)}</span>
        </div>
      </article>`;
  }).join("");
}

/** Tabel produk lengkap dengan modal & margin — halaman Produk (desktop). */
export function renderProductTable() {
  const semua = get("products");

  const list = semua.filter((p) => {
    const tone = stockStatus(p).tone;
    if (filterProduk === "Menipis") return tone === "menipis";
    if (filterProduk === "Habis") return tone === "habis";
    return true;
  });

  renderProdukFilters(semua);
  renderManageList(list);
  renderNilaiStok(semua);

  const body = $("productTable");
  if (!body) return;

  if (list.length === 0) {
    body.innerHTML = `<tr><td colspan="8">Belum ada produk pada filter ini.</td></tr>`;
    return;
  }

  body.innerHTML = list.map((p) => {
    const status = stockStatus(p);
    const margin = (Number(p.hargaJual) || 0) - (Number(p.hargaModal) || 0);
    const thumb = p.imageUrl
      ? `<img class="cell-thumb" src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy">`
      : `<div class="cell-thumb" style="background:${tileBg(p.category)};color:#fff">${escapeHtml(initials(p.name))}</div>`;

    return `
      <tr>
        <td>
          <div class="cell-product">
            ${thumb}
            <strong>${escapeHtml(p.name)}</strong>
          </div>
        </td>
        <td>${escapeHtml(p.sku ?? "-")}</td>
        <td>${escapeHtml(p.category ?? "-")}</td>
        <td class="admin-only">${money(p.hargaModal)}</td>
        <td>${money(p.hargaJual)}</td>
        <td class="admin-only ${margin > 0 ? "positive" : "warning-text"}">${money(margin)}</td>
        <td>${angka(stokTersedia(p))} <small>/ min ${angka(p.stokMinimum ?? STOK_MINIMUM_DEFAULT)}</small></td>
        <td>
          <span class="badge ${badgeClass(status.tone)}">${status.label}</span>
          <button class="text-btn admin-only" data-restock="${escapeHtml(p.id)}">Restock</button>
        </td>
      </tr>`;
  }).join("");
}

/**
 * Nilai stok = Σ (harga modal × stok fisik).
 * Inilah uang toko yang sedang "tidur" di rak — angka yang paling sering
 * ditanyakan pemilik saat menghitung modal berjalan.
 *
 * @param {Array<object>} list
 */
function renderNilaiStok(list) {
  const el = $("nilaiStok");
  if (el) {
    const total = list.reduce((sum, p) => sum + (Number(p.hargaModal) || 0) * (Number(p.stok) || 0), 0);
    el.textContent = money(total);
  }

  const sub = $("katalogSub");
  if (sub) sub.textContent = `Katalog · ${angka(list.length)} produk`;
}

/** Memuat ulang daftar produk dari API dan menggambar seluruh tampilan terkait. */
export async function refreshProducts() {
  try {
    const list = await getApi().listProducts();
    set("products", list);
    if ($("navProductCount")) $("navProductCount").textContent = angka(list.length);
    renderCategories();
    renderProductGrid();
    renderProductTable();
  } catch (error) {
    showApiError(error);
  }
}

/** Mengosongkan form produk beserta pratinjau foto. */
function resetProductForm() {
  $("productForm")?.reset();
  fotoTerpilih = null;

  const drop = $("imageDrop");
  if (!drop) return;
  drop.querySelector("img")?.remove();
  drop.querySelector(".replace-hint")?.remove();
  const teks = $("imageDropText");
  if (teks) teks.style.display = "";
}

/** Membuka modal tambah produk dalam keadaan bersih. */
export function bukaFormProduk() {
  resetProductForm();
  openModal("productModal");
}

/** Memasang area unggah foto: klik, seret-lepas, dan pratinjau. */
function bindImageDrop() {
  const drop = $("imageDrop");
  const input = $("productImage");
  if (!drop || !input) return;

  function tampilkanPratinjau(dataUrl) {
    drop.querySelector("img")?.remove();
    drop.querySelector(".replace-hint")?.remove();

    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = "Pratinjau foto produk";

    const hint = document.createElement("span");
    hint.className = "replace-hint";
    hint.textContent = "Klik untuk ganti foto";

    drop.append(img, hint);
    const teks = $("imageDropText");
    if (teks) teks.style.display = "none";
  }

  async function proses(file) {
    try {
      fotoTerpilih = await bacaGambar(file);
      tampilkanPratinjau(fotoTerpilih);
    } catch (error) {
      fotoTerpilih = null;
      showToast(error.message, "error");
    }
  }

  input.addEventListener("change", () => {
    if (input.files?.[0]) proses(input.files[0]);
  });

  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove("dragging");
  }));
  drop.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) proses(file);
  });
}

/**
 * Memasang form tambah produk.
 * Validasi angka dilakukan di sini agar pengguna dapat umpan balik cepat,
 * tetapi server tetap memvalidasi ulang — input browser tidak dipercaya.
 */
export function bindProductForm() {
  const form = $("productForm");
  if (!form) return;
  bindImageDrop();

  // Hasil pencarian katalog nasional: buka formulir dengan nama dan barcode
  // sudah terisi. Admin tinggal melengkapi harga dan stok.
  document.addEventListener("kasirone:produk-baru-dari-scan", (e) => {
    const { sku, name } = e.detail ?? {};
    if (!sku) return;
    bukaFormProduk();
    if ($("newSku")) $("newSku").value = sku;
    if ($("newName")) $("newName").value = name ?? "";
    $("newPrice")?.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tombol = form.querySelector('button[type="submit"]');

    const payload = {
      name: $("newName").value.trim(),
      sku: $("newSku").value.trim(),
      category: $("newCategory").value.trim(),
      hargaModal: Number($("newModal").value),
      hargaJual: Number($("newPrice").value),
      stok: Number($("newStock").value),
      stokMinimum: Number($("newMinStock").value || 5),
      imageUrl: fotoTerpilih
    };

    if (!payload.name || !payload.sku) {
      showToast("Nama dan SKU/barcode wajib diisi.", "error");
      return;
    }
    if (payload.hargaJual < payload.hargaModal) {
      showToast("Harga jual tidak boleh lebih kecil dari harga modal.", "error");
      return;
    }

    await withBusy(tombol, async () => {
      try {
        await getApi().createProduct(payload);
        resetProductForm();
        closeModal("productModal");
        showToast(`${payload.name} berhasil ditambahkan.`, "success");
        await refreshProducts();
      } catch (error) {
        showApiError(error);
      }
    });
  });
}
