-- =====================================================================
-- Corte de medianoche de los turnos que cruzan la medianoche.
--
-- Cada dia calendario lleva sus propias marcas: si la persona sigue
-- trabajando a medianoche, el sistema le pone la salida del dia que termina
-- (23:59:59) y la entrada del dia que empieza (00:00:00). Esas dos marcas
-- quedan con este origen, para distinguirlas de las que hace la persona y de
-- las del cierre automatico por olvido (AUTO_CLOSE).
-- =====================================================================
ALTER TYPE time_log_source_enum ADD VALUE IF NOT EXISTS 'AUTO_MIDNIGHT';
