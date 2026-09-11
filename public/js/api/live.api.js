/**
 * Implementasi API yang berbicara dengan backend sungguhan.
 *
 * Seluruh penulisan data uang/stok lewat sini — tidak ada satu pun modul UI
 * yang boleh menulis langsung ke Firestore.
 */

/**
 * @param {() => Promise<string>} getToken pengambil ID token Firebase
 * @returns {object} objek API
 */
export function createLiveApi(getToken) {
  /**
   * @param {string} path
   * @param {RequestInit} [options]
   * @returns {Promise<*>} isi field `data` dari respons
   * @throws {Error & {code?:string, details?:object}}
   */
  async function request(path, options = {}) {
    const token = await getToken();
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {})
      }
    });

    let payload = null;
    try { payload = await response.json(); } catch { /* respons kosong */ }

    if (!response.ok) {
      const error = new Error(payload?.error || `Permintaan gagal (${response.status}).`);
      error.code = payload?.code;
      error.details = payload?.details;
      error.status = response.status;
      throw error;
    }
    return payload?.data ?? payload;
  }

  const qs = (params) => {
    const clean = Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "");
    return clean.length ? `?${new URLSearchParams(clean)}` : "";
  };

  return {
    mode: "live",

    me: () => request("/me"),

    listProducts: () => request("/products"),
    findBySku: (sku) => request(`/products/sku/${encodeURIComponent(sku)}`),
    createProduct: (data) => request("/products", { method: "POST", body: JSON.stringify(data) }),
    updateProduct: (id, data) => request(`/products/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deactivateProduct: (id) => request(`/products/${id}`, { method: "DELETE" }),

    createTransaction: (payload) => request("/transactions", { method: "POST", body: JSON.stringify(payload) }),
    listTransactions: (filter) => request(`/transactions${qs(filter)}`),

    createExpense: (data) => request("/expenses", { method: "POST", body: JSON.stringify(data) }),
    restock: (data) => request("/expenses/restock", { method: "POST", body: JSON.stringify(data) }),
    listExpenses: (filter) => request(`/expenses${qs(filter)}`),

    getReport: (params) => request(`/reports${qs(params)}`),

    paymentStatus: () => request("/payments/status"),
    createQris: (payload) => request("/payments/qris", { method: "POST", body: JSON.stringify(payload) }),
    qrisStatus: (orderId) => request(`/payments/qris/${encodeURIComponent(orderId)}/status`),

    /**
     * Katalog publik. Sengaja TIDAK lewat request(), karena request()
     * selalu melampirkan token; etalase harus bisa dibuka pengunjung yang
     * belum punya akun sama sekali.
     */
    listKatalog: async () => {
      const r = await fetch("/api/katalog");
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(body?.error || "Gagal memuat katalog."), { code: body?.code });
      return body.data ?? [];
    },

    opsiPengiriman: () => request("/orders/opsi-pengiriman"),
    buatPesanan: (payload) => request("/orders", { method: "POST", body: JSON.stringify(payload) }),
    daftarPesanan: (filter) => request(`/orders${qs(filter)}`),
    ambilPesanan: (id) => request(`/orders/${encodeURIComponent(id)}`),
    ubahStatusPesanan: (id, status, extra = {}) =>
      request(`/orders/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status, ...extra }) }),
    bersihkanKedaluwarsa: () => request("/orders/bersihkan-kedaluwarsa", { method: "POST" })
  };
}
