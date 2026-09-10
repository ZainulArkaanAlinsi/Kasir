/**
 * Pemilih implementasi API.
 *
 * Modul UI cukup memanggil `getApi()` dan tidak perlu tahu apakah data
 * datang dari server sungguhan atau dari localStorage mode demo. Inilah
 * yang membuat halaman kasir bisa diuji tanpa project Firebase sama sekali.
 */
import { createLiveApi } from "./live.api.js";
import { createDemoApi } from "./demo.api.js";

let current = null;

/**
 * @param {{mode:"demo"|"live", getToken?:() => Promise<string>}} options
 * @returns {object} objek API aktif
 */
export function initApi({ mode, getToken }) {
  current = mode === "live" ? createLiveApi(getToken) : createDemoApi();
  return current;
}

/**
 * @returns {object} API aktif
 * @throws {Error} bila dipanggil sebelum initApi
 */
export function getApi() {
  if (!current) throw new Error("API belum diinisialisasi. Panggil initApi() dulu.");
  return current;
}
