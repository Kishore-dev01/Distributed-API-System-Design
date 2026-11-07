const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const axios = require("axios");
const Redis = require("ioredis");
const { rateLimit } = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 8080);
const gatewayId = process.env.GATEWAY_ID || `gateway-${port}`;

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_MAX || 100),
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args)
  })
});

app.use(helmet());
app.use(cors());
morgan.token("gateway-id", () => gatewayId);
app.use(morgan(':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" gateway=:gateway-id'));
app.use(express.json());
app.use(limiter);

app.use((_req, res, next) => {
  res.setHeader("x-gateway-id", gatewayId);
  next();
});

const openapiSpecification = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Distributed API Gateway",
      version: "1.0.0",
      description: "Gateway endpoints for user, order, and storage services"
    },
    servers: [
      {
        url: "http://localhost"
      }
    ],
    paths: {
      "/health": {
        get: {
          summary: "Gateway health check",
          responses: {
            200: {
              description: "Gateway is healthy"
            }
          }
        }
      },
      "/api/users": {
        post: {
          summary: "Create user",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    email: { type: "string", format: "email" }
                  },
                  required: ["name", "email"]
                }
              }
            }
          },
          responses: {
            200: { description: "User created" }
          }
        }
      },
      "/api/users/{id}": {
        get: {
          summary: "Get user by id",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            200: { description: "User returned" }
          }
        }
      },
      "/api/orders": {
        post: {
          summary: "Create order",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    user_id: { type: "number" },
                    item: { type: "string" },
                    amount: { type: "number" }
                  },
                  required: ["user_id", "item", "amount"]
                }
              }
            }
          },
          responses: {
            200: { description: "Order created" }
          }
        }
      },
      "/api/orders/{id}": {
        get: {
          summary: "Get order by id",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            200: { description: "Order returned" }
          }
        }
      },
      "/api/storage/presign-upload": {
        post: {
          summary: "Generate presigned upload URL",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    objectName: { type: "string" },
                    contentType: { type: "string" }
                  },
                  required: ["objectName", "contentType"]
                }
              }
            }
          },
          responses: {
            200: { description: "Presigned upload returned" }
          }
        }
      }
    }
  },
  apis: []
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpecification));
app.get("/docs.json", (_req, res) => {
  res.json(openapiSpecification);
});

const userServiceUrls = (process.env.USER_SERVICE_URLS || "http://localhost:3001")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

const orderServiceUrls = (process.env.ORDER_SERVICE_URLS || "http://localhost:3002")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

const storageServiceUrls = (process.env.STORAGE_SERVICE_URLS || "http://localhost:3003")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

const counters = {
  user: 0,
  order: 0,
  storage: 0
};

function pickNext(urls, key) {
  if (!urls.length) {
    throw new Error(`No upstream URLs configured for ${key}`);
  }
  const index = counters[key] % urls.length;
  counters[key] += 1;
  return urls[index];
}

async function forward(req, res, urls, key) {
  try {
    const baseUrl = pickNext(urls, key);
    const targetPath = req.originalUrl.replace(/^\/api/, "");
    const response = await axios({
      method: req.method,
      url: `${baseUrl}${targetPath}`,
      data: req.body,
      headers: {
        "Content-Type": "application/json",
        "x-request-id": req.headers["x-request-id"] || ""
      },
      validateStatus: () => true,
      timeout: 5000
    });

    res.status(response.status).json(response.data);
  } catch (error) {
    res.status(502).json({
      message: "Bad gateway",
      detail: error.message
    });
  }
}

app.get("/health", (_req, res) => {
  res.json({
    service: "api-gateway",
    status: "ok"
  });
});

app.use("/api/users", (req, res) => forward(req, res, userServiceUrls, "user"));
app.use("/api/orders", (req, res) => forward(req, res, orderServiceUrls, "order"));
app.use("/api/storage", (req, res) => forward(req, res, storageServiceUrls, "storage"));

app.listen(port, () => {
  // Console logging is intentionally simple for container logs.
  console.log(`API Gateway listening on port ${port} (${gatewayId})`);
});
