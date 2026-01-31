const { createClient } = require("redis");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const redisClient = createClient({
  url: process.env.REDIS_URL
});

redisClient.on("connect", () => {
  console.log("✅ Redis connected");
});

redisClient.on("error", (err) => {
  console.error("❌ Redis error:", err);
});

(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error("Redis connection failed", err);
  }
})();

module.exports = redisClient;
