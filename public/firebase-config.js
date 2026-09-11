// Konfigurasi Web App dari Firebase Console.
// Firebase Web API key BUKAN password: ia memang dikirim ke setiap pengunjung
// dan aman berada di frontend. Yang menjaga data adalah Security Rules dan
// verifikasi token di server, bukan kerahasiaan kunci ini.
// Private key service account TIDAK BOLEH ada di berkas ini.
export const firebaseConfig = {
  apiKey: "AIzaSyCx-xKvpp-FYYNMFZl0DS8LTMd_rz10UrQ",
  authDomain: "kasirone-3444.firebaseapp.com",
  projectId: "kasirone-3444",
  storageBucket: "kasirone-3444.firebasestorage.app",
  messagingSenderId: "208893220085",
  appId: "1:208893220085:web:d04c9f909027984d05e1bc"
};

export const firebaseConfigured =
  !Object.values(firebaseConfig).some(value =>
    String(value).startsWith("GANTI_")
  );
