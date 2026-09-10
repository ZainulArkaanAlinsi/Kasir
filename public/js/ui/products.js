/**
 * Tampilan produk: grid di halaman Kasir dan tabel di halaman Produk.
 * Hanya urusan render + input; seluruh penyimpanan lewat lapisan API.
 */
import { get, set } from "../state.js";
import { $, showToast, showApiError, closeModal, withBusy } from "./shell.js";
import { money, angka, escapeHtml } from "../format.js";
import { stockStatus } from "../shared/product.js";
import { getApi } from "../api/index.js";
import { addToCart } from "./cart.js";

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
    container.innerHTML = `<div class="empty-cart">Tidak ada produk yang cocok.</div>`;
    return;
  }

  container.innerHTML = list.map((p) => {
    const status = stockStatus(p);
    const habis = status.tone === "habis";
    return `
      <div class="product-card">
        <div class="product-icon">${escapeHtml(p.icon ?? "\u{1F4E6}")}</div>
        <div>
          <h4>${escapeHtml(p.name)}</h4>
          <p>${escapeHtml(p.category ?? "-")} &middot; Stok ${angka(p.stok)}
            <span class="badge ${status.tone === "aman" ? "" : "low-badge"}">${status.label}</span>
          </p>
        </div>
        <div class="product-bottom">
          <span class="product-price">${money(p.hargaJual)}</span>
          <button class="add-btn" data-add="${escapeHtml(p.id)}" ${habis ? "disabled" : ""}
                  aria-label="Tambah ${escapeHtml(p.name)}">+</button>
        </div>
      </div>`;
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
    body.innerHTML = `<tr><td colspan="8">Belum ada produk.</td></tr>`;
    return;
  }

  body.innerHTML = list.map((p) => {
    const status = stockStatus(p);
    const margin = (Number(p.hargaJual) || 0) - (Number(p.hargaModal) || 0);
    return `
      <tr>
        <td><strong>${escapeHtml(`${p.icon ?? ""} ${p.name}`)}</strong></td>
        <td>${escapeHtml(p.sku ?? "-")}</td>
        <td>${escapeHtml(p.category ?? "-")}</td>
        <td>${money(p.hargaModal)}</td>
        <td>${money(p.hargaJual)}</td>
        <td class="${margin > 0 ? "positive" : "warning-text"}">${money(margin)}</td>
        <td>${angka(p.stok)} <small class="muted">/ min ${angka(p.stokMinimum ?? 5)}</small></td>
        <td>
          <span class="badge ${status.tone === "aman" ? "" : "low-badge"}">${status.label}</span>
          <button class="text-btn" data-restock="${escapeHtml(p.id)}">Restock</button>
        </td>
      </tr>`;
  }).join("");
}

/** Memuat ulang daftar produk dari API dan menggambar seluruh tampilan terkait. */
export async function refreshProducts() {
  try {
    set("products", await getApi().listProducts());
    renderCategories();
    renderProductGrid();
    renderProductTable();
  } catch (error) {
    showApiError(error);
  }
}

/**
 * Memasang form tambah produk.
 * Validasi angka dilakukan di sini agar pengguna dapat umpan balik cepat,
 * tetapi server tetap memvalidasi ulang — input browser tidak dipercaya.
 */
export function bindProductForm() {
  const form = $("productForm");
  if (!form) return;

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
      stokMinimum: Number($("newMinStock").value || 5)
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
        form.reset();
        closeModal("productModal");
        showToast("Produk berhasil ditambahkan.", "success");
        await refreshProducts();
      } catch (error) {
        showApiError(error);
      }
    });
  });
}
