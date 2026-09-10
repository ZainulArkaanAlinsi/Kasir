/**
 * Halaman Restock & Pengeluaran (M5).
 *
 * Restock sengaja satu aksi: menambah stok DAN mencatat biayanya sekaligus.
 * Kalau dipisah, sangat mudah stok bertambah tapi pengeluarannya lupa
 * dicatat — dan laporan laba langsung menipu.
 */
import { $, showToast, showApiError, closeModal, openModal, withBusy } from "./shell.js";
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

/** Membuka modal restock, opsional dengan produk terpilih. */
export function bukaRestock(productId) {
  isiPilihanProduk();
  if (productId && $("restockProduct")) $("restockProduct").value = productId;
  openModal("restockModal");
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
  } catch (error) {
    showApiError(error);
  }
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
        closeModal("restockModal");
        event.target.reset();
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
