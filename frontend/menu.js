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

// Track most recently added item (for better ordering)
let lastAddedId = null;

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
    .then(data => {
      cart = {};

      // Handle both old format (array) and new format (object with items & remarks)
      const items = Array.isArray(data) ? data : data.items;
      const remarks = Array.isArray(data) ? null : data.remarks;

      items.forEach(i => {
        cart[i.item_id] = {
          id: i.item_id,
          name: i.name,
          price: i.price,
          qty: i.quantity
        };
      });

      // Load remarks into input
      if (remarks) {
        document.getElementById("remarks").value = remarks;
      }

      renderMenu(menuData);
      renderCart();
    });
}

/* =========================
   RENDER MENU (SMART SORTING)
========================= */
function renderMenu(items) {
  menuEl.innerHTML = "";

  // 🔥 Sort logic:
  // 1. Recently added on top
  // 2. Other selected items next
  // 3. Unselected items below
  const sortedItems = [...items].sort((a, b) => {
    if (a.id === lastAddedId) return -1;
    if (b.id === lastAddedId) return 1;

    const aSelected = cart[a.id]?.qty > 0 ? 1 : 0;
    const bSelected = cart[b.id]?.qty > 0 ? 1 : 0;

    return bSelected - aSelected;
  });

  sortedItems.forEach(i => {
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
  } else {
    // 🔥 Mark this as most recently added/updated
    lastAddedId = id;
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
   SEARCH (exact matches first, then partial)
========================= */
function searchMenu() {
  const q = document.getElementById("search").value.toLowerCase().trim();
  
  if (!q) {
    renderMenu(menuData);
    return;
  }

  // Filter items that match
  const filtered = menuData.filter(i =>
    i.name.toLowerCase().includes(q)
  );

  // Sort: exact start match first, then contains match
  filtered.sort((a, b) => {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    
    const aStartsWith = aName.startsWith(q);
    const bStartsWith = bName.startsWith(q);
    
    const aExact = aName === q;
    const bExact = bName === q;
    
    // Exact match comes first
    if (aExact && !bExact) return -1;
    if (bExact && !aExact) return 1;
    
    // Starts with comes second
    if (aStartsWith && !bStartsWith) return -1;
    if (bStartsWith && !aStartsWith) return 1;
    
    // Then by name length (shorter = more relevant)
    return aName.length - bName.length;
  });

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

  const remarks = document.getElementById("remarks").value.trim();

  const payload = {
    items: Object.values(cart).map(i => ({
      id: i.id,
      qty: i.qty
    })),
    remarks: remarks || null
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
