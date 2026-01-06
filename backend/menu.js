// ==============================
// STATE
// ==============================
let menuData = [];
let cart = {};
let total = 0;

// ==============================
// LOAD MENU
// ==============================
fetch("http://localhost:3000/menu")
  .then(res => res.json())
  .then(data => {
    menuData = data;
    renderMenu(menuData); // show all by default
  })
  .catch(err => console.error("Menu load failed", err));

// ==============================
// RENDER MENU
// ==============================
function renderMenu(data) {
  const menuDiv = document.getElementById("menu");
  let html = "";

  data.forEach(item => {
    html += `
      <div class="col-md-4 mb-3">
        <div class="card menu-card p-3">
          <h5>${item.name}</h5>
          <p class="text-muted">${item.category}</p>
          <h6>₹${item.price}</h6>

          <div class="d-flex align-items-center mt-2">
            <button class="btn btn-outline-danger qty-btn"
              onclick="decrease(${item.id}, ${item.price})">−</button>

            <span class="mx-2" id="qty-${item.id}">
              ${cart[item.id]?.qty || 0}
            </span>

            <button class="btn btn-outline-success qty-btn"
              onclick="increase(${item.id}, ${item.price}, '${item.name.replace(/'/g, "\\'")}')">+</button>
          </div>
        </div>
      </div>
    `;
  });

  menuDiv.innerHTML =
    html || "<p class='text-center text-muted'>No items found</p>";
}

// ==============================
// SEARCH
// ==============================
function searchMenu() {
  const keyword = document.getElementById("search").value.toLowerCase().trim();

  if (!keyword) {
    renderMenu(menuData);
    return;
  }

  const filtered = menuData.filter(item =>
    item.name.toLowerCase().includes(keyword) ||
    item.category.toLowerCase().includes(keyword)
  );

  renderMenu(filtered);
}

// ==============================
// CART
// ==============================
function increase(id, price, name) {
  if (!cart[id]) {
    cart[id] = { id, name, price, qty: 0 };
  }
  cart[id].qty++;
  total += price;
  updateUI(id);
}

function decrease(id, price) {
  if (!cart[id]) return;

  cart[id].qty--;
  total -= price;

  if (cart[id].qty <= 0) delete cart[id];
  updateUI(id);
}

// ==============================
// UI UPDATE
// ==============================
function updateUI(id) {
  const qtyEl = document.getElementById(`qty-${id}`);
  if (qtyEl) qtyEl.innerText = cart[id]?.qty || 0;

  document.getElementById("total").innerText = total;
  renderCart();
}

function renderCart() {
  let html = "";
  Object.values(cart).forEach(i => {
    html += `<div>${i.name} x ${i.qty}</div>`;
  });

  document.getElementById("cartItems").innerHTML =
    html || "<small>No items selected</small>";
}

// ==============================
// PLACE ORDER
// ==============================
function placeOrder() {
  const items = Object.values(cart).map(i => ({
    id: i.id,
    qty: i.qty
  }));

  if (!items.length) {
    alert("Please select items");
    return;
  }

  fetch("http://localhost:3000/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items })
  })
    .then(res => res.json())
    .then(data => {
      alert(`✅ Order #${data.orderId || ""} placed successfully`);
      location.reload();
    })
    .catch(() => alert("❌ Order failed"));
}
