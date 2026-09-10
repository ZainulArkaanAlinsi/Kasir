/**
 * State aplikasi terpusat.
 *
 * Semua modul UI membaca dan menulis lewat sini, bukan lewat variabel global
 * yang tersebar. Perubahan state memicu listener sehingga UI tidak perlu
 * saling memanggil render satu sama lain (mengurangi kopling antar modul).
 */

/** @type {{
 *   user: object|null, role: string|null, mode: "demo"|"live",
 *   products: Array<object>, cart: Array<object>, transactions: Array<object>,
 *   report: object|null, activeCategory: string, activePage: string,
 *   paymentMethod: string, lastTransaction: object|null, loading: boolean
 * }} */
const state = {
  user: null,
  role: null,
  mode: "demo",
  products: [],
  cart: [],
  transactions: [],
  report: null,
  activeCategory: "Semua",
  activePage: "dashboard",
  paymentMethod: "cash",
  cartDiscount: 0,
  lastTransaction: null,
  loading: false
};

/** @type {Map<string, Set<Function>>} */
const listeners = new Map();

/**
 * Berlangganan perubahan satu bagian state.
 * @param {string} key bagian state, mis. "products" atau "cart"
 * @param {Function} handler
 * @returns {Function} fungsi untuk berhenti berlangganan
 */
export function subscribe(key, handler) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(handler);
  return () => listeners.get(key).delete(handler);
}

/** @param {string} key @returns {*} */
export const get = (key) => state[key];

/** @returns {object} salinan dangkal seluruh state (untuk debugging) */
export const snapshot = () => ({ ...state });

/**
 * Mengubah state dan memberi tahu pelanggan bagian tersebut.
 * @param {string} key
 * @param {*} value
 */
export function set(key, value) {
  state[key] = value;
  listeners.get(key)?.forEach((fn) => fn(value, key));
}

/** Mengubah beberapa bagian sekaligus. @param {object} patch */
export function patch(patchObject) {
  for (const [key, value] of Object.entries(patchObject)) set(key, value);
}

/** Mereset state yang bersifat per-sesi saat logout. */
export function resetSession() {
  patch({
    user: null, role: null, products: [], cart: [], transactions: [],
    report: null, lastTransaction: null, activePage: "dashboard", cartDiscount: 0
  });
}
