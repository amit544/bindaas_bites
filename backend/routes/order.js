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
      TO_CHAR(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
      o.payment_status   AS payment_status,
      o.payment_mode     AS payment_mode,
      o.cash_amount      AS cash_amount,
      o.online_amount    AS online_amount,
      o.remarks          AS remarks,
      o.daily_order_no   AS daily_order_no,
      m.name             AS item_name,
      oi.quantity        AS quantity,
      m.price            AS price,
      oi.id              AS order_item_id,
      oi.is_delivered    AS item_delivered
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN menu_items m ON m.id = oi.menu_item_id
    WHERE o.created_by = $1
     AND (o.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date
          = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
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
  // Get order details including remarks
  const orderResult = await pool.query(
    "SELECT remarks FROM orders WHERE id = $1 AND created_by = $2",
    [req.params.id, req.user.userId]
  );

  const itemsResult = await pool.query(
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

  res.json({
    items: itemsResult.rows,
    remarks: orderResult.rows[0]?.remarks || null
  });
});

/* =========================
   CREATE ORDER
========================= */
router.post("/", auth, async (req, res) => {
  const { items, remarks } = req.body;
  let total = 0;

  for (let i of items) {
    const p = await pool.query(
      "SELECT price FROM menu_items WHERE id=$1",
      [i.id]
    );
    total += p.rows[0].price * i.qty;
  }

  // Get daily order number (count of today's orders + 1)
  const dailyCountResult = await pool.query(`
    SELECT COUNT(*) + 1 AS daily_no
    FROM orders
    WHERE (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date
          = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
  `);
  const dailyOrderNo = dailyCountResult.rows[0].daily_no;

  const order = await pool.query(
    `
    INSERT INTO orders (total_amount, status, created_by, updated_by, remarks, daily_order_no)
    VALUES ($1, 'PENDING', $2, $2, $3, $4)
    RETURNING id
    `,
    [total, req.user.userId, remarks || null, dailyOrderNo]
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

  res.json({ orderId: order.rows[0].id, dailyOrderNo });
});

/* =========================
   UPDATE ORDER (EDIT)
========================= */
router.put("/:id", auth, async (req, res) => {
  const { items, remarks } = req.body;
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
    SET total_amount=$1, updated_by=$2, remarks=$3
    WHERE id=$4
    `,
    [total, req.user.userId, remarks || null, orderId]
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

/* =========================
   SPLIT PAYMENT (CASH + ONLINE)
========================= */
router.put("/:id/pay-split", auth, async (req, res) => {
  const { cashAmount, onlineAmount } = req.body;

  if (cashAmount === undefined || onlineAmount === undefined) {
    return res.status(400).json({ message: "Cash and online amounts required" });
  }

  if (cashAmount < 0 || onlineAmount < 0) {
    return res.status(400).json({ message: "Amounts cannot be negative" });
  }

  await pool.query(
    `
    UPDATE orders
    SET payment_status = 'PAID',
        payment_mode = 'SPLIT',
        cash_amount = $1,
        online_amount = $2,
        updated_by = $3
    WHERE id = $4
    `,
    [cashAmount, onlineAmount, req.user.userId, req.params.id]
  );

  res.json({ message: "Split payment recorded" });
});
/* =========================
   MARK INDIVIDUAL ITEM AS DELIVERED
========================= */
router.put("/:orderId/item/:itemId/deliver", auth, async (req, res) => {
  const { orderId, itemId } = req.params;

  // Verify the order belongs to the user
  const orderCheck = await pool.query(
    "SELECT id FROM orders WHERE id = $1 AND created_by = $2",
    [orderId, req.user.userId]
  );

  if (!orderCheck.rowCount) {
    return res.status(404).json({ message: "Order not found" });
  }

  // Verify the item belongs to the order
  const itemCheck = await pool.query(
    "SELECT id FROM order_items WHERE id = $1 AND order_id = $2",
    [itemId, orderId]
  );

  if (!itemCheck.rowCount) {
    return res.status(404).json({ message: "Item not found in this order" });
  }

  // Mark the item as delivered
  await pool.query(
    `
    UPDATE order_items
    SET is_delivered = TRUE
    WHERE id = $1 AND order_id = $2
    `,
    [itemId, orderId]
  );

  // Check if all items in the order are now delivered
  const allItemsResult = await pool.query(
    `
    SELECT COUNT(*) as total, SUM(CASE WHEN is_delivered = TRUE THEN 1 ELSE 0 END) as delivered
    FROM order_items
    WHERE order_id = $1
    `,
    [orderId]
  );

  const { total, delivered } = allItemsResult.rows[0];
  const allDelivered = parseInt(total) === parseInt(delivered);

  // If all items are delivered, automatically mark the order as delivered
  if (allDelivered) {
    await pool.query(
      `
      UPDATE orders
      SET status = 'DELIVERED',
          delivered_at = NOW(),
          updated_by = $1
      WHERE id = $2
      `,
      [req.user.userId, orderId]
    );
  }

  res.json({ 
    message: "Item marked as delivered",
    allItemsDelivered: allDelivered,
    orderAutoDelivered: allDelivered
  });
});

router.put("/:id/deliver", auth, async (req, res) => {
  // Mark all items as delivered first
  await pool.query(
    `
    UPDATE order_items
    SET is_delivered = TRUE
    WHERE order_id = $1
    `,
    [req.params.id]
  );

  // Then mark the order as delivered
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

/* =========================
   UPDATE REMARKS
========================= */
router.put("/:id/remarks", auth, async (req, res) => {
  const { remarks } = req.body;

  const order = await pool.query(
    "SELECT status FROM orders WHERE id=$1 AND created_by=$2",
    [req.params.id, req.user.userId]
  );

  if (!order.rowCount) {
    return res.status(404).json({ message: "Order not found" });
  }

  await pool.query(
    `
    UPDATE orders
    SET remarks = $1,
        updated_by = $2
    WHERE id = $3
    `,
    [remarks || null, req.user.userId, req.params.id]
  );

  res.json({ message: "Remarks updated" });
});

/* =========================
   TOP-UP ORDER (ADD EXTRA AMOUNT)
========================= */
router.put("/:id/topup", auth, async (req, res) => {
  const { amount } = req.body;

  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ message: "Invalid top-up amount" });
  }

  const order = await pool.query(
    "SELECT status, total_amount FROM orders WHERE id=$1 AND created_by=$2",
    [req.params.id, req.user.userId]
  );

  if (!order.rowCount || order.rows[0].status !== "PENDING") {
    return res.status(400).json({ message: "Order cannot be modified" });
  }

  const newTotal = Number(order.rows[0].total_amount) + Number(amount);

  await pool.query(
    `
    UPDATE orders
    SET total_amount = $1,
        updated_by = $2
    WHERE id = $3
    `,
    [newTotal, req.user.userId, req.params.id]
  );

  res.json({ message: "Top-up added", newTotal });
});


module.exports = router;
