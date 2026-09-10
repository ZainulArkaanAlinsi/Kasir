import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig, firebaseConfigured } from "./firebase-config.js";

let auth = null;
let db = null;
let currentUser = null;
let demoMode = false;

if (firebaseConfigured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

let products = [
  {id:"p1",name:"Indomie Goreng",sku:"SKU-001",category:"Makanan",price:3500,stock:42,icon:"🍜"},
  {id:"p2",name:"Teh Botol Sosro",sku:"SKU-002",category:"Minuman",price:4500,stock:28,icon:"🧃"},
  {id:"p3",name:"Aqua 600ml",sku:"SKU-003",category:"Minuman",price:4000,stock:18,icon:"💧"},
  {id:"p4",name:"Roti Cokelat",sku:"SKU-004",category:"Makanan",price:8500,stock:12,icon:"🍞"},
  {id:"p5",name:"Chitato Original",sku:"SKU-005",category:"Snack",price:11500,stock:8,icon:"🥔"},
  {id:"p6",name:"SilverQueen",sku:"SKU-006",category:"Snack",price:13000,stock:25,icon:"🍫"},
  {id:"p7",name:"Susu UHT",sku:"SKU-007",category:"Minuman",price:7500,stock:14,icon:"🥛"},
  {id:"p8",name:"Tissue Soft",sku:"SKU-008",category:"Rumah",price:9500,stock:5,icon:"🧻"},
  {id:"p9",name:"Sabun Cair",sku:"SKU-009",category:"Rumah",price:14000,stock:17,icon:"🧴"}
];

let cart = [];
let transactions = JSON.parse(localStorage.getItem("kasir_transactions") || "[]");
let activeCategory = "Semua";
let selectedPayment = "cash";
let lastTransaction = null;

const TAX_RATE = 0.11;
const PRODUCTS_KEY = "kasir_products";

const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n);
const showToast = message => {
  const el=$("toast"); el.textContent=message; el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"),2600);
};

function seedDemoTransactions(){
  if(transactions.length) return;
  transactions=[
    {id:"TRX-240901-001",date:new Date().toISOString(),cashier:"Kasir Demo",method:"QRIS",total:78500,items:5},
    {id:"TRX-240901-002",date:new Date(Date.now()-3600000).toISOString(),cashier:"Kasir Demo",method:"Tunai",total:42500,items:3},
    {id:"TRX-240901-003",date:new Date(Date.now()-7200000).toISOString(),cashier:"Kasir Demo",method:"Kartu",total:112000,items:7}
  ];
  localStorage.setItem("kasir_transactions",JSON.stringify(transactions));
}
seedDemoTransactions();

function loadProducts(){
  try{
    const saved=JSON.parse(localStorage.getItem(PRODUCTS_KEY)||"null");
    if(Array.isArray(saved)&&saved.length)products=saved;
  }catch{ /* data rusak, pakai daftar bawaan */ }
}

function persistProducts(){
  localStorage.setItem(PRODUCTS_KEY,JSON.stringify(products));
}

loadProducts();

function renderProducts(){
  const query=($("productSearch")?.value||"").toLowerCase();
  const list=products.filter(p=>
    (activeCategory==="Semua"||p.category===activeCategory) &&
    (p.name.toLowerCase().includes(query)||p.sku.toLowerCase().includes(query))
  );
  $("productGrid").innerHTML=list.map(p=>`
    <article class="product-card">
      <div>
        <div class="product-icon">${p.icon}</div>
        <h4>${escapeHtml(p.name)}</h4>
        <p>${escapeHtml(p.category)} · Stok ${p.stock}</p>
      </div>
      <div class="product-bottom">
        <span class="product-price">${money(p.price)}</span>
        <button class="add-btn" data-add="${p.id}" ${p.stock<1?"disabled":""}>+</button>
      </div>
    </article>
  `).join("");

  document.querySelectorAll("[data-add]").forEach(btn=>btn.addEventListener("click",()=>addToCart(btn.dataset.add)));
}

function renderCategories(){
  const categories=["Semua",...new Set(products.map(p=>p.category))];
  $("categoryRow").innerHTML=categories.map(c=>`<button class="category-btn ${c===activeCategory?"active":""}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("");
  document.querySelectorAll("[data-category]").forEach(btn=>btn.addEventListener("click",()=>{
    activeCategory=btn.dataset.category;renderCategories();renderProducts();
  }));
}

function addToCart(id){
  const product=products.find(p=>p.id===id); if(!product)return;
  const existing=cart.find(i=>i.id===id);
  if(existing){
    if(existing.qty>=product.stock)return showToast("Stok tidak mencukupi.");
    existing.qty++;
  } else cart.push({...product,qty:1});
  renderCart();
}

function renderCart(){
  const count=cart.reduce((s,i)=>s+i.qty,0);
  $("cartCount").textContent=`${count} item`;
  $("cartItems").innerHTML=cart.length?cart.map(i=>`
    <div class="cart-item">
      <div class="cart-item-top"><strong>${escapeHtml(i.name)}</strong><b>${money(i.price*i.qty)}</b></div>
      <small>${money(i.price)} / item</small>
      <div class="qty-row">
        <button class="qty-btn" data-minus="${i.id}">−</button><span>${i.qty}</span><button class="qty-btn" data-plus="${i.id}">+</button>
      </div>
    </div>`).join(""):`<div class="empty-cart">Keranjang masih kosong.<br>Tambahkan produk untuk mulai.</div>`;
  document.querySelectorAll("[data-minus]").forEach(b=>b.onclick=()=>changeQty(b.dataset.minus,-1));
  document.querySelectorAll("[data-plus]").forEach(b=>b.onclick=()=>changeQty(b.dataset.plus,1));

  const {subtotal,discount,tax,total}=computeTotals();
  $("subtotal").textContent=money(subtotal);
  $("discount").textContent=money(discount);
  $("tax").textContent=money(tax);
  $("grandTotal").textContent=money(total);
  $("checkoutBtn").disabled=!cart.length;
}

function changeQty(id,delta){
  const item=cart.find(i=>i.id===id);if(!item)return;
  const product=products.find(p=>p.id===id);
  item.qty+=delta;
  if(item.qty<=0)cart=cart.filter(i=>i.id!==id);
  else if(product&&item.qty>product.stock){item.qty=product.stock;showToast("Stok tidak mencukupi.");}
  renderCart();
}

// Satu-satunya sumber kebenaran untuk perhitungan uang.
// Sebelumnya renderCart() dan totalCart() menghitung sendiri-sendiri dan
// totalCart() mengabaikan diskon, jadi angka di layar bisa beda dengan yang ditagih.
function computeTotals(){
  const subtotal=cart.reduce((s,i)=>s+i.price*i.qty,0);
  const discount=0;
  const taxable=Math.max(0,subtotal-discount);
  const tax=Math.round(taxable*TAX_RATE);
  return {subtotal,discount,tax,total:taxable+tax};
}

function totalCart(){
  return computeTotals().total;
}

function openModal(id){$(id).classList.remove("hidden")}
function closeModal(id){$(id).classList.add("hidden")}

function renderDashboard(){
  const revenue=transactions.reduce((s,t)=>s+t.total,0);
  const itemCount=transactions.reduce((s,t)=>s+t.items,0);
  $("statSales").textContent=money(revenue);
  $("statTransactions").textContent=transactions.length;
  $("statItems").textContent=itemCount;
  $("statLowStock").textContent=products.filter(p=>p.stock<=8).length;
  $("reportRevenue").textContent=money(revenue);
  $("reportCount").textContent=transactions.length;
  $("reportAverage").textContent=money(transactions.length?Math.round(revenue/transactions.length):0);

  const bars=[38,55,46,78,62,91,70];
  $("barChart").innerHTML=bars.map((h,i)=>`<div class="bar" style="height:${h}%"><span>${["Sen","Sel","Rab","Kam","Jum","Sab","Min"][i]}</span></div>`).join("");

  $("recentTransactions").innerHTML=transactions.slice(0,5).map(t=>`
    <div class="activity"><div><strong>${t.id}</strong><span>${new Date(t.date).toLocaleString("id-ID")}</span></div><b>${money(t.total)}</b></div>
  `).join("");
}

function renderTables(){
  $("productTable").innerHTML=products.map(p=>`
    <tr><td><strong>${escapeHtml(p.icon+" "+p.name)}</strong></td><td>${p.sku}</td><td>${escapeHtml(p.category)}</td><td>${money(p.price)}</td><td>${p.stock}</td><td><span class="badge ${p.stock<=8?"low-badge":""}">${p.stock<=8?"Menipis":"Aman"}</span></td></tr>
  `).join("");
  $("transactionTable").innerHTML=transactions.map(t=>`
    <tr><td><strong>${t.id}</strong></td><td>${new Date(t.date).toLocaleString("id-ID")}</td><td>${escapeHtml(t.cashier)}</td><td>${t.method}</td><td>${money(t.total)}</td><td><span class="badge">Berhasil</span></td></tr>
  `).join("");
}

function setPage(page){
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active-page"));
  $(`${page}Page`).classList.add("active-page");
  document.querySelectorAll(".nav-item").forEach(n=>n.classList.toggle("active",n.dataset.page===page));
  const titles={dashboard:"Dashboard",kasir:"Kasir",produk:"Produk",transaksi:"Transaksi",laporan:"Laporan",pengaturan:"Pengaturan"};
  $("pageTitle").textContent=titles[page]||"Dashboard";
  $("pageEyebrow").textContent=page==="dashboard"?"OVERVIEW":page.toUpperCase();
}

function loginDemo(){
  demoMode=true; currentUser={email:"demo@kasir.local",uid:"demo",displayName:"Kasir Demo"};
  $("userName").textContent="Kasir Demo";$("userRole").textContent="Cashier";
  $("loginView").classList.add("hidden");$("appView").classList.remove("hidden");
  showToast("Mode demo aktif.");
  initializeUI();
}

async function handleLogin(e){
  e.preventDefault();
  if(!auth){ return showToast("Firebase belum dikonfigurasi. Gunakan mode demo."); }
  try{
    const email=$("loginEmail").value.trim();
    const password=$("loginPassword").value;
    await signInWithEmailAndPassword(auth,email,password);
  }catch(error){showToast("Login gagal. Periksa email dan password.");console.error(error);}
}

async function handleLogout(){
  if(demoMode){location.reload();return;}
  if(auth)await signOut(auth);
}

async function saveTransaction(){
  const {subtotal,discount,tax,total}=computeTotals();
  const method=selectedPayment==="cash"?"Tunai":selectedPayment==="qris"?"QRIS":"Kartu";
  const trx={
    id:`TRX-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${String(Date.now()).slice(-4)}`,
    date:new Date().toISOString(),cashier:currentUser?.email||"Kasir Demo",method,
    subtotal,discount,tax,total,
    items:cart.reduce((s,i)=>s+i.qty,0),
    lines:cart.map(i=>({id:i.id,name:i.name,price:i.price,qty:i.qty}))
  };

  // Kurangi stok sesuai item yang terjual, lalu simpan.
  for(const line of cart){
    const product=products.find(p=>p.id===line.id);
    if(product)product.stock=Math.max(0,product.stock-line.qty);
  }
  persistProducts();

  transactions.unshift(trx);
  localStorage.setItem("kasir_transactions",JSON.stringify(transactions));

  if(db && currentUser && !demoMode){
    try{
      await addDoc(collection(db,"transactions"),{
        ...trx,
        createdAt:serverTimestamp(),
        cashierUid:currentUser.uid
      });
      await callAudit("CREATE_TRANSACTION",{transactionId:trx.id,total});
    }catch(error){
      console.error("Firestore save failed",error);
      showToast("Transaksi lokal tersimpan; Firestore gagal.");
    }
  }
  return trx;
}

async function callAudit(action,metadata={}){
  if(!auth||!currentUser||demoMode)return;
  const token=await currentUser.getIdToken();
  await fetch("/api/audit",{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
    body:JSON.stringify({action,metadata})
  });
}

async function confirmPayment(){
  if(!cart.length)return;
  if(selectedPayment==="cash"){
    const received=Number($("cashReceived").value||0);
    if(received<totalCart())return showToast("Uang yang diterima belum cukup.");
  }
  const trx=await saveTransaction();
  lastTransaction=trx;
  cart=[];
  renderCart();renderDashboard();renderTables();
  closeModal("paymentModal");
  $("successText").textContent=`${trx.id} · ${trx.method} · ${money(trx.total)}`;
  $("receiptPreview").innerHTML=`
    <strong>KasirOne Store</strong><br>
    ${trx.id}<br>
    ${new Date(trx.date).toLocaleString("id-ID")}<br>
    -----------------------------<br>
    ${trx.items} item<br>
    Total: <strong>${money(trx.total)}</strong><br>
    Pembayaran: ${trx.method}
  `;
  openModal("successModal");
}

function initializeUI(){
  renderCategories();renderProducts();renderCart();renderDashboard();renderTables();
}

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

$("loginForm").addEventListener("submit",handleLogin);
$("demoLogin").addEventListener("click",loginDemo);
$("logoutBtn").addEventListener("click",handleLogout);
$("productSearch").addEventListener("input",renderProducts);
$("clearCart").addEventListener("click",()=>{cart=[];renderCart()});
$("checkoutBtn").addEventListener("click",()=>{if(cart.length){$("paymentTotal").textContent=money(totalCart());openModal("paymentModal")}});
$("cashReceived").addEventListener("input",()=>{$("changeAmount").textContent=money(Math.max(0,Number($("cashReceived").value||0)-totalCart()))});
$("confirmPayment").addEventListener("click",confirmPayment);
$("addProductBtn").addEventListener("click",()=>openModal("productModal"));
$("topNewSale").addEventListener("click",()=>setPage("kasir"));
$("newTransaction").addEventListener("click",()=>{closeModal("successModal");setPage("kasir")});
$("printReceipt").addEventListener("click",()=>window.print());

document.querySelectorAll(".nav-item").forEach(btn=>btn.addEventListener("click",()=>setPage(btn.dataset.page)));
document.querySelectorAll("[data-go]").forEach(btn=>btn.addEventListener("click",()=>setPage(btn.dataset.go)));
document.querySelectorAll("[data-close]").forEach(btn=>btn.addEventListener("click",()=>closeModal(btn.dataset.close)));
document.querySelectorAll(".payment-method").forEach(btn=>btn.addEventListener("click",()=>{
  selectedPayment=btn.dataset.method;
  document.querySelectorAll(".payment-method").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  $("cashArea").classList.toggle("hidden",selectedPayment!=="cash");
  $("qrisArea").classList.toggle("hidden",selectedPayment!=="qris");
  $("cardArea").classList.toggle("hidden",selectedPayment!=="card");
}));

$("productForm").addEventListener("submit",e=>{
  e.preventDefault();
  const p={id:`p${Date.now()}`,name:$("newName").value.trim(),sku:$("newSku").value.trim(),category:$("newCategory").value.trim(),price:Number($("newPrice").value),stock:Number($("newStock").value),icon:"📦"};
  products.unshift(p);persistProducts();closeModal("productModal");e.target.reset();renderCategories();renderProducts();renderTables();renderDashboard();showToast("Produk berhasil ditambahkan.");
});

document.addEventListener("keydown",e=>{if(e.key==="Escape"){document.querySelectorAll(".modal:not(.hidden)").forEach(m=>m.classList.add("hidden"))}});

if(auth){
  onAuthStateChanged(auth,user=>{
    if(user){
      demoMode=false;currentUser=user;
      $("userName").textContent=user.email?.split("@")[0]||"Kasir";
      $("userRole").textContent="Authenticated";
      $("loginView").classList.add("hidden");$("appView").classList.remove("hidden");
      initializeUI();
    }
  });
}
