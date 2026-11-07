const { Kafka } = require("kafkajs");
require("dotenv").config();

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || "event-consumer",
  brokers: [process.env.KAFKA_BROKER || "localhost:9092"]
});

const consumer = kafka.consumer({
  groupId: process.env.KAFKA_GROUP_ID || "order-events-consumer"
});

async function start() {
  await consumer.connect();
  await consumer.subscribe({ topic: "order.created", fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const key = message.key ? message.key.toString() : "";
      const value = message.value ? message.value.toString() : "";
      console.log(`[event-consumer] topic=${topic} partition=${partition} key=${key} value=${value}`);
    }
  });

  console.log("event-consumer started and listening for order.created events");
}

start().catch((error) => {
  console.error("Failed to start event-consumer", error);
  process.exit(1);
});
