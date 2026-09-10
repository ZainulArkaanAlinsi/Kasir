// Isi dengan konfigurasi Web App dari Firebase Console.
// Firebase Web API key bukan password/secret. Jangan masukkan service account private key di sini.
export const firebaseConfig = {
  apiKey: "GANTI_DENGAN_API_KEY",
  authDomain: "GANTI_DENGAN_PROJECT_ID.firebaseapp.com",
  projectId: "GANTI_DENGAN_PROJECT_ID",
  storageBucket: "GANTI_DENGAN_STORAGE_BUCKET",
  messagingSenderId: "GANTI_DENGAN_MESSAGING_SENDER_ID",
  appId: "GANTI_DENGAN_APP_ID"
};

export const firebaseConfigured =
  !Object.values(firebaseConfig).some(value =>
    String(value).startsWith("GANTI_")
  );