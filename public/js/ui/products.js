/**
 * Tampilan produk: grid di halaman Kasir dan tabel di halaman Produk.
 * Hanya urusan render + input; seluruh penyimpanan lewat lapisan API.
 */
import { get, set } from "../state.js";
import { $, showToast, showApiError, closeModal, openModal, withBusy } from "./shell.js";
import { money, angka, escapeHtml } from "../format.js";
import { stockStatus } from "../shared/product.js";
import { getApi } from "../api/index.js";
import { addToCart } from "./cart.js";
import { bacaGambar } from "./image-upload.js";

/** Foto yang sedang dipilih di form produk (data URL), null bila belum ada. */
let fotoTerpilih = null;

/**
 * Menggambar media kartu produk: foto asli bila ada, monogram bila belum.
 * Monogram dipilih alih-alih emoji karena emoji terbaca sebagai ilustrasi,
 * sedangkan kartu ini seharusnya memajang barang sungguhan.
 *
 * @param {object} p produk
 * @returns {string} HTML
 */
function mediaProduk(p) {
  const inisial = escapeHtml((p.name ?? "?").trim().charAt(0).toUpperCase());
  if (p.imageUrl) {
    return `<img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.name)}" loading="lazy">`;
  }
  return `<div class="monogram">${inisial}</div>`;
}

/** Kelas badge sesuai status stok. */
const kelasBadge = (tone) => (tone === "aman" ? "" : tone === "habis" ? "out-badge" : "low-badge");

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

/** Grid produk yang bisa diklik untuk masuk keranjang. */
export function renderProductGrid() {
  const container = $("productGrid");
  if (!container) return;

  const query = ($("productSearch")?.value || "").toLowerCase().trim();
  const kategori = get("activeCategory");

  const list = get("products").filter((p) => {
    const cocokKategori = kategori === "Semua" || p.category === kategori;
    const cocokCari = !query
      || p.name?.toLowerCase().includes(query)
      || p.sku?.toLowerCase().includes(query);
    return cocokKategori && cocokCari;
  });

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-cart" style="grid-column:1/-1">Tidak ada produk yang cocok.</div>`;
    return;
  }

  container.innerHTML = list.map((p) => {
    const status = stockStatus(p);
    const habis = status.tone === "habis";
    return `
      <article class="product-card ${habis ? "is-out" : ""}">
        <div class="product-media">
          ${mediaProduk(p)}
          <span class="badge stock-chip ${kelasBadge(status.tone)}">${status.label}</span>
        </div>
        <div class="product-body">
          <h4>${escapeHtml(p.name)}</h4>
          <p class="product-meta">${escapeHtml(p.category ?? "-")} &middot; Stok ${angka(p.stok)}</p>
          <div class="product-bottom">
            <span class="product-price">${money(p.hargaJual)}</span>
            <button class="add-btn" data-add="${escapeHtml(p.id)}" ${habis ? "disabled" : ""}
                    aria-label="Tambah ${escapeHtml(p.name)}">+</button>
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
}

/** Tabel produk lengkap dengan modal & margin — halaman Produk. */
export function renderProductTable() {
  const body = $("productTable");
  if (!body) return;

  const list = get("products");
  if (list.length === 0) {
    body.innerHTML = `<tr><td colspan="8">Belum ada produk. Klik "Tambah produk" untuk mulai.</td></tr>`;
    return;
  }

  body.innerHTML = list.map((p) => {
    const status = stockStatus(p);
    const margin = (Number(p.hargaJual) || 0) - (Number(p.hargaModal) || 0);
    const inisial = escapeHtml((p.name ?? "?").trim().charAt(0).toUpperCase());
    const thumb = p.imageUrl
      ? `<img class="cell-thumb" src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy">`
      : `<div class="cell-thumb">${inisial}</div>`;

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
        <td>${angka(p.stok)} <small>/ min ${angka(p.stokMinimum ?? 5)}</small></td>
        <td>
          <span class="badge ${kelasBadge(status.tone)}">${status.label}</span>
          <button class="text-btn admin-only" data-restock="${escapeHtml(p.id)}">Restock</button>
        </td>
      </tr>`;
  }).join("");
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
