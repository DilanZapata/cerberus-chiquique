-- =====================================================================
-- Varias sedes por persona: reemplaza users.work_site_id (una sola sede)
-- por una relacion muchos-a-muchos. El marcaje por GPS de autoservicio
-- (mobile-clock) valida contra CUALQUIERA de las sedes asociadas a la
-- persona, no solo una. TimeLog.work_site_id no cambia -- sigue siendo la
-- sede puntual donde se hizo cada marca real.
-- =====================================================================

CREATE TABLE "user_work_sites" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"       UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "work_site_id"  UUID NOT NULL REFERENCES "work_sites"("id") ON DELETE CASCADE,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("user_id", "work_site_id")
);

CREATE INDEX "idx_user_work_sites_work_site" ON "user_work_sites"("work_site_id");

-- Backfill: la sede que ya tenia cada usuario queda como su primera sede
-- asociada, para no perder ninguna asignacion existente.
INSERT INTO "user_work_sites" ("user_id", "work_site_id")
SELECT "id", "work_site_id" FROM "users" WHERE "work_site_id" IS NOT NULL;

ALTER TABLE "users" DROP COLUMN "work_site_id";
