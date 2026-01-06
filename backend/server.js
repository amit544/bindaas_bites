const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const { Server } = require("socket.io");

const pool = require("./db");
//const authMiddleware = require("./middleware/auth");
const authRoutes = require("./routes/auth");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// ==============================
// MIDDLEWARE
// ==============================
app.use(cors());
app.use(express.json());

// ==============================
// STATIC FRONTEND
// ==============================
app.use(express.static(path.join(__dirname, "../frontend")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/menu.html"));
});

// ==============================
// AUTH ROUTES
// ==============================
app.use("/auth", authRoutes);

// ==============================
// MENU ROUTES
// ==============================
app.get("/menu", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM menu_items WHERE is_available=true ORDER BY category"
  );
  res.json(result.rows);
});

// (Optional admin menu add)
app.post("/menu", authMiddleware, async (req, res) => {
  const { name, price, category } = req.body;

  await pool.query(
    "INSERT INTO menu_items(name, price, category) VALUES($1,$2,$3)",
    [name, price, category]
  );

  res.json({ message: "Menu item added" });
});

// ==============================
// ORDER ROUTES (PROTECTED)
// ==============================
app.post("/order", authMiddleware, async (req, res) => {
  const { items } = req.body;
  const { userId, name } = req.user;

  if (!items || items.length === 0) {
    return res.status(400).json({ message: "No items in order" });
  }

  try {
    let total = 0;

    for (let i of items) {
      const priceRes = await pool.query(
        "SELECT price FROM menu_items WHERE id=$1",
        [i.id]
      );
      total += priceRes.rows[0].price * i.qty;
    }

    const orderRes = await pool.query(
      "INSERT INTO orders(total_amount, user_id, user_name) VALUES($1,$2,$3) RETURNING id, order_at",
      [total, userId, name]
    );

    const orderId = orderRes.rows[0].id;

    for (let i of items) {
      await pool.query(
        "INSERT INTO order_items(order_id, menu_item_id, quantity) VALUES($1,$2,$3)",
        [orderId, i.id, i.qty]
      );
    }

    io.emit("new-order", orderId);

    res.json({
      message: "Order placed successfully",
      orderId,
      orderTime: orderRes.rows[0].order_at
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Order failed" });
  }
});

// ==============================
// CHEF ROUTES (PROTECTED)
// ==============================
app.get("/orders", authMiddleware, async (req, res) => {
  const result = await pool.query(`
    SELECT
      o.id,
      o.status,
      TO_CHAR(o.order_at, 'HH12:MI AM') AS time,
      m.name,
      oi.quantity
    FROM orders o
    JOIN order_items oi ON o.id = oi.order_id
    JOIN menu_items m ON m.id = oi.menu_item_id
    WHERE o.status != 'DELIVERED'
    ORDER BY o.order_at DESC
  `);

  res.json(result.rows);
});

app.put("/order/:id/deliver", authMiddleware, async (req, res) => {
  await pool.query(
    "UPDATE orders SET status='DELIVERED' WHERE id=$1",
    [req.params.id]
  );
  res.json({ message: "Order delivered" });
});

// ==============================
// ORDER HISTORY
// ==============================
app.get("/orders/history", authMiddleware, async (req, res) => {
  const result = await pool.query(`
    SELECT
      o.id AS order_id,
      o.status,
      o.total_amount,
      o.user_name,
      TO_CHAR(o.order_at, 'DD Mon YYYY') AS order_date,
      TO_CHAR(o.order_at, 'HH12:MI AM') AS order_time,
      m.name AS item_name,
      oi.quantity
    FROM orders o
    JOIN order_items oi ON o.id = oi.order_id
    JOIN menu_items m ON m.id = oi.menu_item_id
    ORDER BY o.id DESC
  `);

  res.json(result.rows);
});

// ==============================
// DB CHECK
// ==============================
async function checkDB() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Database connected successfully");
  } catch (err) {
    console.error("❌ Database connection failed");
    console.error(err.message);
    process.exit(1);
  }
}

checkDB();

// ==============================
// START SERVER
// ==============================
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
