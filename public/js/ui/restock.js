/**
 * Halaman Restock & Pengeluaran (M5).
 *
 * Restock sengaja satu aksi: menambah stok DAN mencatat biayanya sekaligus.
 * Kalau dipisah, sangat mudah stok bertambah tapi pengeluarannya lupa
 * dicatat — dan laporan laba langsung menipu.
 */
import { $, showToast, showApiError, withBusy } from "./shell.js";
import { money, angka, escapeHtml, tanggal } from "../format.js";
import { get } from "../state.js";
import { getApi } from "../api/index.js";
import { refreshProducts } from "./products.js";

/** Mengisi dropdown produk pada form restock. */
export function isiPilihanProduk() {
  const select = $("restockProduct");
  if (!select) return;
  select.innerHTML = get("products")
    .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (stok ${angka(p.stok)})</option>`)
    .join("");
}

/**
 * Menyiapkan form restock untuk satu produk.
 *
 * Dulu fungsi ini memanggil openModal("restockModal") — padahal tidak ada
 * elemen dengan id itu di halaman, sehingga tombol "Restock" pada daftar
 * produk diam saja setiap kali ditekan. Formnya memang hidup di halaman
 * Restock & Biaya, jadi yang benar adalah mengisi form tersebut lalu
 * menaruh kursor di kolom jumlah; perpindahan halamannya diurus pemanggil.
 *
 * @param {string} [productId] produk yang ingin direstock
 */
export function bukaRestock(productId) {
  isiPilihanProduk();
  if (productId && $("restockProduct")) $("restockProduct").value = productId;
  $("restockQty")?.focus();
}

/** Memuat & menggambar tabel pengeluaran. */
export async function refreshExpenses() {
  const body = $("expenseTable");
  if (!body) return;

  try {
    const list = await getApi().listExpenses({ limit: 200 });
    const total = list.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    if ($("expenseTotal")) $("expenseTotal").textContent = money(total);

    body.innerHTML = list.length
      ? list.map((e) => `
        <tr>
          <td>${escapeHtml(tanggal(e.createdAt))}</td>
          <td><span class="badge ${e.type === "restock" ? "" : "low-badge"}">${escapeHtml(e.type)}</span></td>
          <td>${escapeHtml(e.productName ?? "-")}</td>
          <td>${e.qty ? angka(e.qty) : "-"}</td>
          <td>${money(e.amount)}</td>
          <td>${escapeHtml(e.note ?? "")}</td>
        </tr>`).join("")
      : `<tr><td colspan="6">Belum ada pengeluaran tercatat.</td></tr>`;

    renderExpenseList(list);
  } catch (error) {
    showApiError(error);
  }
}

/**
 * Pengeluaran sebagai kartu untuk layar sempit.
 *
 * Restock ditandai terakota dan biaya operasional slate, supaya sekali
 * lihat ketahuan uang toko habis untuk menambah barang atau untuk hal
 * lain — dua hal yang keputusannya sangat berbeda.
 *
 * @param {Array<object>} list
 */
function renderExpenseList(list) {
  const container = $("expenseList");
  if (!container) return;

  if (!list.length) {
    container.innerHTML = `<div class="empty-cart">Belum ada pengeluaran tercatat.</div>`;
    return;
  }

  container.innerHTML = list.slice(0, 40).map((e, i) => {
    const jenis = e.type === "restock" ? "restock" : e.type === "operasional" ? "operasional" : "lainnya";
    const rincian = e.productName
      ? `${escapeHtml(e.productName)}${e.qty ? ` ×${angka(e.qty)}` : ""} · modal`
      : escapeHtml(e.note || "tanpa catatan");

    return `
      <div class="expense-row" style="animation-delay:${Math.min(i, 10) * 0.04}s">
        <span class="expense-ico ${jenis}">${escapeHtml(jenis.charAt(0).toUpperCase())}</span>
        <div>
          <strong>${escapeHtml(e.type ?? "-")}</strong>
          <span>${rincian} · ${escapeHtml(tanggal(e.createdAt))}</span>
        </div>
        <b>&minus;${money(e.amount)}</b>
      </div>`;
  }).join("");
}

/** Memasang form restock dan form pengeluaran operasional. */
export function bindExpenseForms() {
  $("restockForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tombol = event.target.querySelector('button[type="submit"]');
    const qty = Number($("restockQty").value);

    if (!Number.isInteger(qty) || qty < 1) {
      showToast("Jumlah restock harus bilangan bulat minimal 1.", "error");
      return;
    }

    const hargaModalBaru = $("restockModal_price").value.trim();
    await withBusy(tombol, async () => {
      try {
        const hasil = await getApi().restock({
          productId: $("restockProduct").value,
          qty,
          hargaModalBaru: hargaModalBaru === "" ? null : Number(hargaModalBaru),
          note: $("restockNote").value.trim()
        });
        event.target.reset();
        isiPilihanProduk();   // reset() mengosongkan <select>, isi ulang pilihannya
        showToast(`Stok ${hasil.productName} kini ${angka(hasil.stokBaru)}. Biaya ${money(hasil.amount)} tercatat.`, "success");
        await refreshProducts();
        await refreshExpenses();
      } catch (error) {
        showApiError(error);
      }
    });
  });

  $("expenseForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tombol = event.target.querySelector('button[type="submit"]');
    const amount = Number($("expenseAmount").value);

    if (!Number.isInteger(amount) || amount < 1) {
      showToast("Nominal pengeluaran harus bilangan bulat minimal 1.", "error");
      return;
    }

    await withBusy(tombol, async () => {
      try {
        await getApi().createExpense({
          type: $("expenseType").value,
          amount,
          note: $("expenseNote").value.trim()
        });
        event.target.reset();
        showToast("Pengeluaran tercatat.", "success");
        await refreshExpenses();
      } catch (error) {
        showApiError(error);
      }
    });
  });
}
