-- Horarios rotativos de dos semanas (Semana A / Semana B).
CREATE TYPE "schedule_type_enum" AS ENUM ('WEEKLY', 'BIWEEKLY_ROTATING');
CREATE TYPE "cycle_week_enum" AS ENUM ('A', 'B');

ALTER TABLE "schedules" ADD COLUMN "schedule_type" "schedule_type_enum" NOT NULL DEFAULT 'WEEKLY';

-- Toda fila existente queda en semana A (unica semana usada por horarios WEEKLY).
ALTER TABLE "schedule_details" ADD COLUMN "week" "cycle_week_enum" NOT NULL DEFAULT 'A';

ALTER TABLE "schedule_details" DROP CONSTRAINT "schedule_details_schedule_id_day_of_week_key";
ALTER TABLE "schedule_details" ADD CONSTRAINT "schedule_details_schedule_id_week_day_of_week_key" UNIQUE ("schedule_id", "week", "day_of_week");

ALTER TABLE "user_schedules" ADD COLUMN "cycle_anchor_date" DATE;
ALTER TABLE "user_schedules" ADD COLUMN "cycle_start_week" "cycle_week_enum";
