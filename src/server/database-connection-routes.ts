import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireServiceAccess } from "./api-access-control.js";
import { checkExternalDatabaseConnection, isExternalDatabase, saveExternalDatabaseConnection, testExternalDatabaseUrl } from "./database-connections.js";
import { db, nowIso } from "./db.js";
import { services } from "./schema.js";

const connectionSchema = z.object({ url: z.string().trim().min(1).max(4096) });

export function registerDatabaseConnectionRoutes(app: Hono) {
  app.post("/api/services/:serviceId/database/connection/check", async (c) => {
    const service = db.select().from(services).where(eq(services.id, c.req.param("serviceId"))).get();
    if (!service || !isExternalDatabase(service.id)) return c.json({ error: "Existing database connection not found." }, 404);
    const denied = requireServiceAccess(c, service);
    if (denied) return denied;
    try {
      await checkExternalDatabaseConnection(service.id);
      db.update(services).set({ status: "active", updatedAt: nowIso() }).where(eq(services.id, service.id)).run();
      return c.json({ ok: true });
    } catch (error) {
      db.update(services).set({ status: "failed", updatedAt: nowIso() }).where(eq(services.id, service.id)).run();
      return c.json({ error: error instanceof Error ? error.message : "Could not check the database connection." }, 400);
    }
  });

  app.patch("/api/services/:serviceId/database/connection", async (c) => {
    const service = db.select().from(services).where(eq(services.id, c.req.param("serviceId"))).get();
    if (!service || !isExternalDatabase(service.id)) return c.json({ error: "Existing database connection not found." }, 404);
    const denied = requireServiceAccess(c, service);
    if (denied) return denied;
    const body = connectionSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Enter a PostgreSQL connection URL." }, 400);
    try {
      await testExternalDatabaseUrl(body.data.url, service.repoFullName === "database:postgis");
      saveExternalDatabaseConnection(service.id, body.data.url);
      await checkExternalDatabaseConnection(service.id);
      db.update(services).set({ status: "active", updatedAt: nowIso() }).where(eq(services.id, service.id)).run();
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Could not update the database connection." }, 400);
    }
  });
}
