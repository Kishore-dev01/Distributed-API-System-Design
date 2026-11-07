const express = require("express");
const morgan = require("morgan");
const { Pool } = require("pg");
const { Kafka } = require("kafkajs");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 3002);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || "order-service",
  brokers: [process.env.KAFKA_BROKER || "localhost:9092"]
});

const producer = kafka.producer();

app.use(express.json());
app.use(morgan("combined"));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      item VARCHAR(150) NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

app.get("/health", (_req, res) => {
  res.json({ service: "order-service", status: "ok" });
});

app.post("/orders", async (req, res) => {
  const { user_id, item, amount } = req.body;
  if (!user_id || !item || typeof amount !== "number") {
    return res.status(400).json({ message: "user_id, item, and numeric amount are required" });
  }

  try {
    const result = await pool.query(
      "INSERT INTO orders(user_id, item, amount) VALUES($1, $2, $3) RETURNING id, user_id, item, amount, created_at",
      [user_id, item, amount]
    );

    const order = result.rows[0];

    await producer.send({
      topic: "order.created",
      messages: [
        {
          key: String(order.id),
          value: JSON.stringify(order)
        }
      ]
    });

    return res.status(201).json(order);
  } catch (error) {
    return res.status(500).json({ message: "failed to create order", detail: error.message });
  }
});

app.get("/orders/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    return res.status(400).json({ message: "invalid order id" });
  }

  try {
    const result = await pool.query(
      "SELECT id, user_id, item, amount, created_at FROM orders WHERE id = $1",
      [id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: "order not found" });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "failed to fetch order", detail: error.message });
  }
});

async function start() {
  try {
    await initDb();
    await producer.connect();

    app.listen(port, () => {
      console.log(`order-service listening on ${port}`);
    });
  } catch (error) {
    console.error("Failed to start order-service", error);
    process.exit(1);
  }
}

start();
