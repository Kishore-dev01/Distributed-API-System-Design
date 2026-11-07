const express = require("express");
const morgan = require("morgan");
const Minio = require("minio");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 3003);

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || "localhost",
  port: Number(process.env.MINIO_PORT || 9000),
  useSSL: String(process.env.MINIO_USE_SSL || "false") === "true",
  accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
  secretKey: process.env.MINIO_SECRET_KEY || "minioadmin"
});

const bucket = process.env.MINIO_BUCKET || "app-assets";

app.use(express.json());
app.use(morgan("combined"));

async function ensureBucket() {
  const exists = await minioClient.bucketExists(bucket);
  if (!exists) {
    await minioClient.makeBucket(bucket, "us-east-1");
  }
}

app.get("/health", (_req, res) => {
  res.json({ service: "storage-service", status: "ok", bucket });
});

app.post("/storage/presign-upload", async (req, res) => {
  const { objectName, contentType } = req.body;
  if (!objectName || !contentType) {
    return res.status(400).json({ message: "objectName and contentType are required" });
  }

  try {
    const expiresInSeconds = 15 * 60;

    const putUrl = await minioClient.presignedPutObject(bucket, objectName, expiresInSeconds);
    const getUrl = await minioClient.presignedGetObject(bucket, objectName, expiresInSeconds);

    return res.json({
      bucket,
      objectName,
      contentType,
      expiresInSeconds,
      putUrl,
      getUrl
    });
  } catch (error) {
    return res.status(500).json({ message: "failed to create presigned URLs", detail: error.message });
  }
});

ensureBucket()
  .then(() => {
    app.listen(port, () => {
      console.log(`storage-service listening on ${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start storage-service", error);
    process.exit(1);
  });
