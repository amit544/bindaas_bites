const express = require("express");
const router = express.Router();
const pool = require("../db");
const auth = require("../middleware/auth");

/* =========================
   GET ORDER HISTORY
========================= */

function formatIST(dateStr) {
  return new Date(dateStr).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}


router.get("/history", auth, async (req, res) => {
  const result = await pool.query(
    `
    SELECT
      o.id               AS order_id,
      o.status           AS status,
      o.total_amount     AS total_amount,
      o.created_at       AS created_at,
      o.payment_status   AS payment_status,   -- ✅ ADD
      o.payment_mode     AS payment_mode,  
      m.name             AS item_name,
      oi.quantity        AS quantity,
      m.price            AS price
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN menu_items m ON m.id = oi.menu_item_id
    WHERE o.created_by = $1
    ORDER BY o.created_at asc;
    `,
    [req.user.userId]
  );

  res.json(result.rows);
});


/* =========================
   GET SINGLE ORDER (EDIT)
========================= */
router.get("/:id", auth, async (req, res) => {
  const result = await pool.query(
    `
    SELECT
      m.id AS item_id,
      m.name,
      m.price,
      oi.quantity
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN menu_items m ON m.id = oi.menu_item_id
    WHERE o.id = $1 AND o.created_by = $2
    `,
    [req.params.id, req.user.userId]
  );

  res.json(result.rows);
});

/* =========================
   CREATE ORDER
========================= */
router.post("/", auth, async (req, res) => {
  const { items } = req.body;
  let total = 0;

  for (let i of items) {
    const p = await pool.query(
      "SELECT price FROM menu_items WHERE id=$1",
      [i.id]
    );
    total += p.rows[0].price * i.qty;
  }

  const order = await pool.query(
    `
    INSERT INTO orders (total_amount, status, created_by, updated_by)
    VALUES ($1, 'PENDING', $2, $2)
    RETURNING id
    `,
    [total, req.user.userId]
  );

  for (let i of items) {
    await pool.query(
      `
      INSERT INTO order_items (order_id, menu_item_id, quantity)
      VALUES ($1, $2, $3)
      `,
      [order.rows[0].id, i.id, i.qty]
    );
  }

  res.json({ orderId: order.rows[0].id });
});

/* =========================
   UPDATE ORDER (EDIT)
========================= */
router.put("/:id", auth, async (req, res) => {
  const { items } = req.body;
  const orderId = req.params.id;

  const order = await pool.query(
    "SELECT status FROM orders WHERE id=$1 AND created_by=$2",
    [orderId, req.user.userId]
  );

  if (!order.rowCount || order.rows[0].status !== "PENDING") {
    return res.status(400).json({ message: "Order not editable" });
  }

  await pool.query("DELETE FROM order_items WHERE order_id=$1", [orderId]);

  let total = 0;

  for (let i of items) {
    const p = await pool.query(
      "SELECT price FROM menu_items WHERE id=$1",
      [i.id]
    );
    total += p.rows[0].price * i.qty;

    await pool.query(
      `
      INSERT INTO order_items (order_id, menu_item_id, quantity)
      VALUES ($1, $2, $3)
      `,
      [orderId, i.id, i.qty]
    );
  }

  await pool.query(
    `
    UPDATE orders
    SET total_amount=$1, updated_by=$2
    WHERE id=$3
    `,
    [total, req.user.userId, orderId]
  );

  res.json({ message: "Order updated" });
});

/* =========================
   CANCEL ORDER
========================= */
router.delete("/:id", auth, async (req, res) => {
  const order = await pool.query(
    "SELECT status FROM orders WHERE id=$1 AND created_by=$2",
    [req.params.id, req.user.userId]
  );

  if (!order.rowCount || order.rows[0].status !== "PENDING") {
    return res.status(400).json({ message: "Order cannot be cancelled" });
  }

  await pool.query(
    `
    UPDATE orders
    SET status='CANCELLED', updated_by=$1
    WHERE id=$2
    `,
    [req.user.userId, req.params.id]
  );

  res.json({ message: "Order cancelled" });
});
router.put("/:id/pay", auth, async (req, res) => {
  const { mode } = req.body; // CASH or ONLINE

  if (!["CASH", "ONLINE"].includes(mode)) {
    return res.status(400).json({ message: "Invalid payment mode" });
  }

  await pool.query(
    `
    UPDATE orders
    SET payment_status = 'PAID',
        payment_mode = $1,
        updated_by = $2
    WHERE id = $3
    `,
    [mode, req.user.userId, req.params.id]
  );

  res.json({ message: "Payment marked as paid" });
});
router.put("/:id/deliver", auth, async (req, res) => {
  await pool.query(
    `
    UPDATE orders
    SET status = 'DELIVERED',
        delivered_at = NOW(),
        updated_by = $1
    WHERE id = $2
    `,
    [req.user.userId, req.params.id]
  );

  res.json({ message: "Order delivered" });
});


module.exports = router;
