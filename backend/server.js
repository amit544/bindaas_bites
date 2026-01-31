const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const { Server } = require("socket.io");

// Set default JWT secret for local testing
process.env.JWT_SECRET = process.env.JWT_SECRET || "local_test_secret_key_12345";

const pool = require("./db");
const auth = require("./middleware/auth");
const authRoutes = require("./routes/auth");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());

/* RESET ALL ORDERS - Must be BEFORE router middleware */
app.delete("/orders/reset-all", auth, async (req, res) => {
  const { password } = req.body;
  
  // Verify password
  if (password !== "warning") {
    return res.status(403).json({ success: false, message: "Invalid password" });
  }
  
  // Only admins can reset
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Only admins can reset orders" });
  }
  
  try {
    // Delete all order items first (foreign key constraint)
    await pool.query("DELETE FROM order_items");
    
    // Delete all orders
    await pool.query("DELETE FROM orders");
    
    console.log(`⚠️ All orders reset by user: ${req.user.name} (ID: ${req.user.userId})`);
    
    res.json({ success: true, message: "All orders deleted. Next order will be #1" });
  } catch (err) {
    console.error("Reset error:", err);
    res.status(500).json({ success: false, message: "Failed to reset orders" });
  }
});

app.use("/order", require("./routes/order"));
app.use(express.static(path.join(__dirname, "../frontend")));
app.use("/orders", require("./routes/order"));

app.get("/", (_, res) =>
  res.sendFile(path.join(__dirname, "../frontend/login.html"))
);
//const redisClient = require("./redis");
app.use("/auth", authRoutes);

/* MENU */
app.get("/menu", async (_, res) => {
    //   const cached = await redisClient.get("menu_cache");
    // if (cached) {
    //   console.log("⚡ Served from Redis");
    //   return res.json(JSON.parse(cached));
    // }

    // // 2. Otherwise query DB
    // console.log("🐘 Served from DB");
  const r = await pool.query(
    "SELECT * FROM menu_items WHERE is_available=true"
  );
  // await redisClient.setEx("menu_cache", 3600, JSON.stringify(r.rows));
  res.json(r.rows);

});


/* PLACE ORDER */
app.post("/order", auth, async (req, res) => {
  const { items, remarks } = req.body;
  let total = 0;
console.log("user detais",req.user.userId);
  // 1️⃣ Calculate total
  for (let i of items) {
    const p = await pool.query(
      "SELECT price FROM menu_items WHERE id = $1",
      [i.id]
    );

    if (p.rowCount === 0) {
      return res.status(400).json({ message: "Invalid menu item" });
    }

    total += p.rows[0].price * i.qty;
  }

  // 2️⃣ Get daily order number (count of today's orders + 1)
  const dailyCountResult = await pool.query(`
    SELECT COUNT(*) + 1 AS daily_no
    FROM orders
    WHERE (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date
          = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
  `);
  const dailyOrderNo = dailyCountResult.rows[0].daily_no;

  // 3️⃣ Create order WITH created_by, remarks, daily_order_no
  const order = await pool.query(
    `
    INSERT INTO orders (total_amount, status, created_by, updated_by, remarks, daily_order_no)
    VALUES ($1, 'PENDING', $2, $2, $3, $4)
    RETURNING id
    `,
    [total, req.user.userId, remarks || null, dailyOrderNo]
  );

  const orderId = order.rows[0].id;

  // 4️⃣ Insert order items
  for (let i of items) {
    await pool.query(
      `
      INSERT INTO order_items (order_id, menu_item_id, quantity)
      VALUES ($1, $2, $3)
      `,
      [orderId, i.id, i.qty]
    );
  }

  // 5️⃣ Notify (Socket)
  io.emit("new-order", { orderId, dailyOrderNo });

  res.json({ orderId, dailyOrderNo });
});


/* CHEF */
app.get("/orders", auth, async (_, res) => {
  const r = await pool.query(`
    SELECT o.id, m.name, oi.quantity,
    TO_CHAR(o.order_at,'HH12:MI AM') time
    FROM orders o
    JOIN order_items oi ON o.id=oi.order_id
    JOIN menu_items m ON m.id=oi.menu_item_id
    WHERE o.status='PENDING'
    ORDER BY o.id DESC
  `);
  res.json(r.rows);
});

app.put("/order/:id/deliver", auth, async (req, res) => {
  await pool.query(
    "UPDATE orders SET status='DELIVERED' WHERE id=$1",
    [req.params.id]
  );
  res.json({ success: true });
});

/* UPDATE REMARKS */
app.put("/order/:id/remarks", auth, async (req, res) => {
  const { remarks } = req.body;

  await pool.query(
    `UPDATE orders SET remarks = $1, updated_by = $2 WHERE id = $3`,
    [remarks || null, req.user.userId, req.params.id]
  );

  res.json({ message: "Remarks updated" });
});

/* TOP-UP ORDER */
app.put("/order/:id/topup", auth, async (req, res) => {
  const { amount } = req.body;

  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ message: "Invalid top-up amount" });
  }

  const order = await pool.query(
    "SELECT total_amount FROM orders WHERE id=$1",
    [req.params.id]
  );

  if (!order.rowCount) {
    return res.status(404).json({ message: "Order not found" });
  }

  const newTotal = Number(order.rows[0].total_amount) + Number(amount);

  await pool.query(
    `UPDATE orders SET total_amount = $1, updated_by = $2 WHERE id = $3`,
    [newTotal, req.user.userId, req.params.id]
  );

  res.json({ message: "Top-up added", newTotal });
});

/* MARK AS PAID */
app.put("/order/:id/pay", auth, async (req, res) => {
  const { mode } = req.body;

  if (!["CASH", "ONLINE"].includes(mode)) {
    return res.status(400).json({ message: "Invalid payment mode" });
  }

  await pool.query(
    `UPDATE orders SET payment_status = 'PAID', payment_mode = $1, updated_by = $2 WHERE id = $3`,
    [mode, req.user.userId, req.params.id]
  );

  res.json({ message: "Payment marked as paid" });
});

/* SPLIT PAYMENT (CASH + ONLINE) */
app.put("/order/:id/pay-split", auth, async (req, res) => {
  const { cashAmount, onlineAmount } = req.body;

  if (cashAmount === undefined || onlineAmount === undefined) {
    return res.status(400).json({ message: "Cash and online amounts required" });
  }

  if (cashAmount < 0 || onlineAmount < 0) {
    return res.status(400).json({ message: "Amounts cannot be negative" });
  }

  await pool.query(
    `UPDATE orders SET payment_status = 'PAID', payment_mode = 'SPLIT', cash_amount = $1, online_amount = $2, updated_by = $3 WHERE id = $4`,
    [cashAmount, onlineAmount, req.user.userId, req.params.id]
  );

  res.json({ message: "Split payment recorded" });
});

/* BILL – GET ORDER */
app.get("/order/:id", auth, async (req, res) => {
  const r = await pool.query(`
    SELECT o.status,m.id item_id,m.name,m.price,oi.quantity
    FROM orders o
    JOIN order_items oi ON o.id=oi.order_id
    JOIN menu_items m ON m.id=oi.menu_item_id
    WHERE o.id=$1
  `, [req.params.id]);

  if (!r.rows.length || r.rows[0].status !== "PENDING")
    return res.status(400).json({ message: "Cannot edit order" });

  res.json(r.rows);
});

/* BILL – UPDATE ORDER */
app.put("/order/:id", auth, async (req, res) => {
  console.log("role",req.user.role);
  if (!["bill","admin"].includes(req.user.role))
    return res.sendStatus(403);

  const { items, remarks } = req.body;
  await pool.query("DELETE FROM order_items WHERE order_id=$1", [req.params.id]);

  let total = 0;
  for (let i of items) {
    const p = await pool.query(
      "SELECT price FROM menu_items WHERE id=$1",
      [i.id]
    );
    total += p.rows[0].price * i.qty;

    await pool.query(
      "INSERT INTO order_items(order_id,menu_item_id,quantity) VALUES($1,$2,$3)",
      [req.params.id, i.id, i.qty]
    );
  }

  await pool.query(
    "UPDATE orders SET total_amount=$1, remarks=$2 WHERE id=$3",
    [total, remarks || null, req.params.id]
  );

  res.json({ message: "Order updated", total });
});

server.listen(process.env.PORT || 3000);
