import express, { type Express } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkEnabled } from "./lib/auth";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// The Clerk frontend API proxy must see the raw request body.
if (process.env.CLERK_SECRET_KEY) {
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
}
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use(express.json({ limit: "128kb" }));
app.use(express.urlencoded({ extended: true, limit: "128kb" }));
if (clerkEnabled) {
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
}

app.use("/api", router);

// In production the API server also hosts the built resident portal so the
// whole application runs as a single Railway service behind one domain.
const webDistDir =
  process.env.WEB_DIST_DIR ??
  path.resolve(process.cwd(), "artifacts/salama-park-portal/dist/public");

if (existsSync(webDistDir)) {
  app.use(express.static(webDistDir, { index: false, maxAge: "1h" }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(webDistDir, "index.html"));
  });
}

export default app;
