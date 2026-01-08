/* =========================
   AUTH CHECK
========================= */
const token = localStorage.getItem("token");
if (!token) location.href = "/login.html";

/* =========================
   DOM ELEMENTS
========================= */
const menuEl = document.getElementById("menu");
const cartItemsEl = document.getElementById("cartItems");
const totalEl = document.getElementById("total");

/* =========================
   USER NAME
========================= */
const userName = localStorage.getItem("userName");
document.getElementById("userName").innerText = userName || "User";

/* =========================
   STATE
========================= */
let cart = {};
let menuData = [];
const editOrderId = localStorage.getItem("editOrderId");

/* =========================
   FETCH MENU
========================= */
fetch("/menu", {
  headers: { Authorization: "Bearer " + token }
})
  .then(r => r.json())
  .then(d => {
    menuData = d;
    renderMenu(menuData);
    renderCart();

    // 🔑 LOAD OLD ORDER IF EDIT MODE
    if (editOrderId) {
      loadOrderForEdit();
    }
  });

/* =========================
   LOAD ORDER FOR EDIT
========================= */
function loadOrderForEdit() {
  fetch(`/order/${editOrderId}`, {
    headers: { Authorization: "Bearer " + token }
  })
    .then(r => r.json())
    .then(items => {
      cart = {};

      items.forEach(i => {
        cart[i.item_id] = {
          id: i.item_id,
          name: i.name,
          price: i.price,
          qty: i.quantity
        };
      });

      renderMenu(menuData);
      renderCart();
    });
}

/* =========================
   RENDER MENU
========================= */
function renderMenu(items) {
  menuEl.innerHTML = "";

  items.forEach(i => {
    const qty = cart[i.id]?.qty || 0;
    const selectedClass = qty > 0 ? "selected" : "";

    menuEl.innerHTML += `
      <div class="col-12 col-md-6">
        <div class="card menu-card p-3 ${selectedClass}">
          <h5>${i.name}</h5>
          <h6 class="text-muted">₹${i.price}</h6>

          <div class="d-flex align-items-center mt-2">
            <button class="btn btn-outline-secondary qty-btn"
              onclick="updateQty(${i.id}, -1)">−</button>

            <span class="mx-3 qty-text">${qty}</span>

            <button class="btn btn-outline-secondary qty-btn"
              onclick="updateQty(${i.id}, 1)">+</button>
          </div>
        </div>
      </div>
    `;
  });
}


/* =========================
   UPDATE QTY
========================= */
function updateQty(id, change) {
  const item = menuData.find(i => i.id === id);
  if (!item) return;

  if (!cart[id]) {
    cart[id] = {
      id: item.id,
      name: item.name,
      price: item.price,
      qty: 0
    };
  }

  cart[id].qty += change;

  if (cart[id].qty <= 0) {
    delete cart[id];
  }

  renderMenu(menuData);
  renderCart();
}

/* =========================
   RENDER CART
========================= */
function renderCart() {
  cartItemsEl.innerHTML = "";
  let total = 0;

  Object.values(cart).forEach(i => {
    total += i.qty * i.price;
    cartItemsEl.innerHTML += `<div>${i.name} × ${i.qty}</div>`;
  });

  if (total === 0) {
    cartItemsEl.innerHTML = "<small>No items selected</small>";
  }

  totalEl.innerText = total;
}

/* =========================
   SEARCH
========================= */
function searchMenu() {
  const q = document.getElementById("search").value.toLowerCase();
  const filtered = menuData.filter(i =>
    i.name.toLowerCase().includes(q)
  );
  renderMenu(filtered);
}

/* =========================
   PLACE / UPDATE ORDER
========================= */
function placeOrder() {
  if (Object.keys(cart).length === 0) {
    alert("Cart is empty");
    return;
  }

  const payload = {
    items: Object.values(cart).map(i => ({
      id: i.id,
      qty: i.qty
    }))
  };

  const url = editOrderId ? `/order/${editOrderId}` : "/order";
  const method = editOrderId ? "PUT" : "POST";

  fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token
    },
    body: JSON.stringify(payload)
  })
    .then(res => {
      if (!res.ok) throw new Error("Order failed");
      return res.json();
    })
    .then(() => {
      localStorage.removeItem("editOrderId");
      location.href = "/order.html";
    })
    .catch(() => alert("Failed to save order"));
}

/* =========================
   LOGOUT
========================= */
function logout() {
  localStorage.clear();
  location.href = "/login.html";
}
