const express = require("express");
const morgan = require("morgan");
const { Pool } = require("pg");
const Redis = require("ioredis");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 3001);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

app.use(express.json());
app.use(morgan("combined"));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(200) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

app.get("/health", (_req, res) => {
  res.json({
    service: process.env.SERVICE_INSTANCE || "user-service",
    status: "ok"
  });
});

app.post("/users", async (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({ message: "name and email are required" });
  }

  try {
    const result = await pool.query(
      "INSERT INTO users(name, email) VALUES($1, $2) RETURNING id, name, email, created_at",
      [name, email]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ message: "email already exists" });
    }
    return res.status(500).json({ message: "failed to create user", detail: error.message });
  }
});

app.get("/users/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    return res.status(400).json({ message: "invalid user id" });
  }

  const cacheKey = `user:${id}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json({ source: "cache", user: JSON.parse(cached) });
    }

    const result = await pool.query(
      "SELECT id, name, email, created_at FROM users WHERE id = $1",
      [id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: "user not found" });
    }

    const user = result.rows[0];
    await redis.set(cacheKey, JSON.stringify(user), "EX", 60);

    return res.json({ source: "db", user });
  } catch (error) {
    return res.status(500).json({ message: "failed to fetch user", detail: error.message });
  }
});

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`${process.env.SERVICE_INSTANCE || "user-service"} listening on ${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize user-service", error);
    process.exit(1);
  });
