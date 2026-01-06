const express = require("express");
const http = require("http");
const cors = require("cors");
const pool = require("./db");

const app = express();
const server = http.createServer(app);

const io = require("socket.io")(server, {
  cors: { origin: "*" }
});

const express = require("express");
const path = require("path");

// ✅ Serve frontend folder
app.use(express.static(path.join(__dirname, "../frontend")));

// ✅ Default route → menu.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/menu.html"));
});


app.use(cors());
app.use(express.json());

/* -------- MENU -------- */
app.post("/menu", async (req, res) => {
  const { name, price } = req.body;
  await pool.query(
    "INSERT INTO menu_items(name, price) VALUES($1,$2)",
    [name, price]
  );
  res.json({ message: "Menu added" });
});

app.get("/menu", async (req, res) => {
  const data = await pool.query("SELECT * FROM menu_items WHERE is_available=true");
  res.json(data.rows);
});

/* -------- ORDER -------- */
app.post("/order", async (req, res) => {
  const { items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ message: "No items in order" });
  }

  try {
    let total = 0;

    // calculate total from DB prices (SECURE)
    for (let i of items) {
      const priceRes = await pool.query(
        "SELECT price FROM menu_items WHERE id=$1",
        [i.id]
      );
      total += priceRes.rows[0].price * i.qty;
    }

    // 1️⃣ create order
    const orderRes = await pool.query(
      "INSERT INTO orders(total_amount) VALUES($1) RETURNING id, order_at",
      [total]
    );

    const orderId = orderRes.rows[0].id;

    // 2️⃣ insert order items
    for (let i of items) {
      await pool.query(
        "INSERT INTO order_items(order_id, menu_item_id, quantity) VALUES($1,$2,$3)",
        [orderId, i.id, i.qty]
      );
    }

    // notify chef (real-time)
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


/* -------- CHEF -------- */
app.get("/orders", async (req, res) => {
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


app.put("/order/:id/deliver", async (req, res) => {
  await pool.query(
    "UPDATE orders SET status='DELIVERED' WHERE id=$1",
    [req.params.id]
  );
  res.json({ message: "Order delivered" });
});

async function checkDB() {
  try {
    const res = await pool.query("SELECT 1");
    console.log("✅ Database connected successfully");
  } catch (err) {
    console.error("❌ Database connection failed");
    console.error(err.message);
    process.exit(1); // stop server if DB not connected
  }
}
app.get("/menu", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM menu_items WHERE is_available=true ORDER BY category"
  );
  res.json(result.rows);
});

app.get("/orders/history", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        o.id AS order_id,
        o.status,
        o.total_amount,
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch orders" });
  }
});


checkDB();
server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
