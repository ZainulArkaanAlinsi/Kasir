/**
 * Inisialisasi Firebase sisi klien.
 *
 * Klien hanya dipakai untuk AUTENTIKASI. Pembacaan dan penulisan data
 * bisnis lewat backend, bukan lewat SDK Firestore di browser — itu
 * keputusan arsitektur yang menutup celah manipulasi harga/stok.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { firebaseConfig, firebaseConfigured } from "../firebase-config.js";

/** @type {import("firebase/auth").Auth|null} */
export let auth = null;

if (firebaseConfigured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
}

export { firebaseConfigured, signInWithEmailAndPassword, onAuthStateChanged, signOut };
