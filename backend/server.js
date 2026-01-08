const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const { Server } = require("socket.io");

const pool = require("./db");
const auth = require("./middleware/auth");
const authRoutes = require("./routes/auth");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());

app.use("/order", require("./routes/order"));
app.use(express.static(path.join(__dirname, "../frontend")));
app.use("/orders", require("./routes/order"));

app.get("/", (_, res) =>
  res.sendFile(path.join(__dirname, "../frontend/login.html"))
);

app.use("/auth", authRoutes);

/* MENU */
app.get("/menu", async (_, res) => {
  const r = await pool.query(
    "SELECT * FROM menu_items WHERE is_available=true"
  );
  res.json(r.rows);
});


/* PLACE ORDER */
app.post("/order", auth, async (req, res) => {
  const { items } = req.body;
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

  // 2️⃣ Create order WITH created_by
  const order = await pool.query(
    `
    INSERT INTO orders (total_amount, status, created_by, updated_by)
    VALUES ($1, 'PENDING', $2, $2)
    RETURNING id
    `,
    [total, req.user.userId]
  );

  const orderId = order.rows[0].id;

  // 3️⃣ Insert order items
  for (let i of items) {
    await pool.query(
      `
      INSERT INTO order_items (order_id, menu_item_id, quantity)
      VALUES ($1, $2, $3)
      `,
      [orderId, i.id, i.qty]
    );
  }

  // 4️⃣ Notify (Socket)
  io.emit("new-order", { orderId });

  res.json({ orderId });
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

  const { items } = req.body;
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
    "UPDATE orders SET total_amount=$1 WHERE id=$2",
    [total, req.params.id]
  );

  res.json({ message: "Order updated", total });
});

server.listen(process.env.PORT || 3000);
