/**
 * Autentikasi & pemilihan mode.
 *
 * Dua mode dipisahkan tegas:
 *  - "live" : login Firebase sungguhan, semua data lewat backend.
 *  - "demo" : tanpa Firebase, data di localStorage, khusus mencoba UI.
 * Pemisahan ini penting agar data percobaan tidak pernah tercampur dengan
 * data toko sungguhan.
 */
import { auth, firebaseConfigured, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "./firebase.js";
import { initApi } from "./api/index.js";
import { patch, resetSession, get } from "./state.js";
import { $, showToast, withBusy } from "./ui/shell.js";

/** @type {(() => void)|null} dipanggil setelah sesi siap */
let onReady = null;

/** @param {() => void} handler */
export const setOnReady = (handler) => { onReady = handler; };

/** Menyiapkan tampilan setelah pengguna masuk. */
function masukAplikasi({ mode, user, role, nama }) {
  patch({ mode, user, role });

  if ($("userName")) $("userName").textContent = nama;
  if ($("userRole")) $("userRole").textContent = mode === "demo" ? "Mode Demo" : (role === "admin" ? "Admin" : "Kasir");
  if ($("avatarInitial")) $("avatarInitial").textContent = (nama?.[0] ?? "K").toUpperCase();

  // Menu khusus admin disembunyikan untuk kasir (pertahanan berlapis;
  // server tetap menolak walau elemen ini dimunculkan lewat DevTools).
  document.body.dataset.role = role;

  $("loginView")?.classList.add("hidden");
  $("appView")?.classList.remove("hidden");
  onReady?.();
}

/** Memasang seluruh event autentikasi. */
export function bindAuth() {
  $("loginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tombol = event.target.querySelector('button[type="submit"]');

    if (!firebaseConfigured || !auth) {
      showToast("Firebase belum dikonfigurasi. Gunakan Mode Demo.", "error");
      return;
    }

    await withBusy(tombol, async () => {
      try {
        await signInWithEmailAndPassword(auth, $("loginEmail").value.trim(), $("loginPassword").value);
        // Sisanya ditangani onAuthStateChanged di bawah.
      } catch {
        // Pesan sengaja tidak membedakan "email salah" vs "password salah",
        // agar tidak membocorkan email mana yang terdaftar.
        showToast("Email atau kata sandi salah.", "error");
      }
    });
  });

  $("demoLogin")?.addEventListener("click", () => {
    initApi({ mode: "demo" });
    masukAplikasi({ mode: "demo", user: { uid: "demo-user" }, role: "admin", nama: "Nabila (Demo)" });
    showToast("Mode demo aktif. Data hanya tersimpan di browser ini.", "info");
  });

  $("logoutBtn")?.addEventListener("click", async () => {
    if (get("mode") === "demo") { location.reload(); return; }
    if (auth) await signOut(auth);
    resetSession();
    location.reload();
  });

  if (auth) {
    onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      const api = initApi({ mode: "live", getToken: () => user.getIdToken() });
      try {
        const profil = await api.me();
        masukAplikasi({
          mode: "live",
          user,
          role: profil.role,
          nama: profil.name || user.email?.split("@")[0] || "Kasir"
        });
      } catch (error) {
        showToast(error?.message || "Gagal memuat profil pengguna.", "error");
        await signOut(auth);
      }
    });
  }
}
