const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  console.log(username,"username");
  const userRes = await pool.query(
    "SELECT * FROM users WHERE name=$1",
    [username]
  );
   console.log("password",userRes.rows[0]);
  if (!userRes.rows.length)
    return res.status(401).json({ message: "Invalid credentials" });

  const user = userRes.rows[0];
  console.log(password);
  const ok = await bcrypt.compare(password, user.password);
  console.log("is correct",ok);

  (async () => {
  const hash = await bcrypt.hash("amit", 10);
  console.log(hash);
})();
  (async () => {
  console.log(await bcrypt.compare("amit", "$2b$10$Z6Yzv5R2Wz4ZyU0X9mJvFevY6E4z7z2Wq6M3hF5Kx2Y9xQpF0K8iW"));
  console.log(await bcrypt.compare("amit ", "$2b$10$Z6Yzv5R2Wz4ZyU0X9mJvFevY6E4z7z2Wq6M3hF5Kx2Y9xQpF0K8iW"));
})();
  if (!ok) return res.status(401).json({ message: "Invalid credentials" });

  const token = jwt.sign(
    { userId: user.id, name: user.name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, role: user.role }
  });
});

module.exports = router;
