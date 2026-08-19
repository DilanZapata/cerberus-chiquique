# El motor de calculo (`packages/cst-rules`)

Este es el corazon del sistema: convierte marcas de entrada/salida crudas en
las novedades laborales que exige el Codigo Sustantivo del Trabajo (CST)
colombiano. Es codigo **puro** (sin NestJS, sin Prisma, sin I/O) para poder
testearlo de forma aislada y reusarlo identico entre marcaje automatico y
carga manual.

Punto de entrada: `calculateDailyNovelties()` en
[`novelty-calculator.ts`](../packages/cst-rules/src/novelty-calculator.ts).
Recibe las marcas de un dia + configuracion legal vigente, y devuelve la
lista de novedades + totales de horas.

## Los 7 conceptos legales

El sistema clasifica cada minuto trabajado en uno de estos codigos
(`hours-classifier.ts`):

| Codigo | Significado | Cuando aplica |
|---|---|---|
| `RNO` | Recargo Nocturno Ordinario | jornada ordinaria trabajada en horario nocturno |
| `DDCOF` | Dominical/Festivo diurno | jornada ordinaria trabajada en domingo/festivo, de dia |
| `DNCOF` | Dominical/Festivo nocturno | igual pero de noche |
| `HEOD` | Hora extra ordinaria diurna | excede el cupo ordinario, dia normal, de dia |
| `HEON` | Hora extra ordinaria nocturna | excede el cupo, dia normal, de noche |
| `HEFD` | Hora extra festiva diurna | excede el cupo, domingo/festivo, de dia |
| `HEFN` | Hora extra festiva nocturna | excede el cupo, domingo/festivo, de noche |

Las horas ordinarias diurnas normales (sin recargo) no generan novedad —
solo cuentan para el total trabajado.

## El pipeline, paso a paso

1. **Resolver el almuerzo** (`lunch-engine.ts` → `resolveLunch`). A partir de
   las 4 marcas del dia (entrada, salida almuerzo, reingreso, salida) calcula
   los intervalos realmente trabajados (excluyendo el bloque de almuerzo) y
   genera novedades de `LLEGADA_TARDE_ALMUERZO` / `ABANDONO_ALMUERZO` si
   aplica. Respeta `allowsLunchSkip` del usuario para jornada continua.

2. **Llegada tarde / salida anticipada.** Compara `checkIn`/`checkOut` contra
   el turno programado (`Shift` o `Schedule` del dia) con una tolerancia
   configurable (default 5 min).

3. **Partir en segmentos homogeneos** (`time-window.ts` →
   `splitIntoHomogeneousSegments`). Cada intervalo trabajado se corta en
   pedazos donde la combinacion (diurno/nocturno) × (domingo-festivo/normal)
   no cambia — por ejemplo, un turno de 6pm a 2am se parte en "6pm-7pm
   diurno" + "7pm-2am nocturno" si la jornada nocturna empieza a las 7pm.
   Un turno que cruza medianoche se maneja igual: el segmento sigue
   avanzando en el tiempo, solo cambia de dia calendario a mitad de camino.

4. **Clasificar cada segmento** (`hours-classifier.ts` →
   `classifySegments`). Reparte los minutos de cada segmento entre
   "ordinario" y "hora extra" consumiendo un cupo (`remainingOrdinaryMinutes`)
   que ya viene calculado aguas arriba — este modulo no conoce topes legales,
   solo distribuye minutos hasta agotar el cupo.

5. **Calcular el cupo ordinario del dia.** Es el minimo entre:
   - el tope diario legal (`maxDailyOrdinaryHours`, default 8h — Art. 161 CST), y
   - el remanente semanal (`maxWeeklyHours` menos lo ya consumido esta
     semana ISO, pasado por el llamador via `weekOrdinaryMinutesAccumulated`
     — Ley 2101 de 2021 bajo la jornada de 42h semanales).

   Esto es lo que hace que, por ejemplo, alguien que ya trabajo su semana
   completa el jueves, el viernes todo lo que trabaje cuente como hora extra
   aunque no haya llegado a las 8h ese dia especifico.

6. **Horas extra pendientes de autorizacion.** Si
   `payrollConfig.overtimeRequiresPreauthorization` esta activo, toda hora
   extra nace en estado `PENDIENTE` (no `AUTO_CALCULADA`) y se agrega una
   novedad agregada `HORA_EXTRA_PENDIENTE` para que aparezca en el panel de
   aprobacion (`modules/overtime`). Solo se paga lo que un supervisor/RRHH/
   admin aprueba.

7. **Alerta de tope legal de horas extra.** Si el total de horas extra del
   dia supera `maxDailyOvertimeHours` (default 2h) o el acumulado semanal
   supera `maxWeeklyOvertimeHours` (default 12h), se agrega
   `LIMITE_HORAS_EXTRA_EXCEDIDO`. Es **informativa**, no bloquea nada — no
   tiene sentido impedir retroactivamente horas que ya se trabajaron; el
   objetivo es que quede visible para cumplimiento.

## Tarifas versionadas por fecha

Los porcentajes de recargo y los horarios diurno/nocturno vienen de
`PayrollConfigVersion` (ver `database.md`), resueltos por
`PayrollConfigService.resolveEffective(companyId, fecha)` **antes** de
llamar al motor — el motor en si mismo no sabe nada de vigencias, solo
recibe los valores ya resueltos en `PayrollConfigParams`. Esto es
intencional: la Ley 2466 de 2025 y sus sucesoras cambian estos valores
progresivamente hasta 2027, y separar "resolver vigencia" de "calcular" es
lo que permite recalcular correctamente novedades historicas sin tocar el
motor.

## Que NO calcula el motor

- **Dominical/festivo habitual vs ocasional** (Art. 179/180 CST): requiere
  contar cuantos domingos/festivos trabajo el usuario en el mes calendario,
  lo cual necesita consultar la base de datos — vive en
  `NoveltiesService`, **despues** de llamar al motor, no dentro de
  `cst-rules`.
- **Permisos/incapacidades aprobados**: si hay una `Incidence` aprobada que
  cubre la fecha, `NoveltiesService` persiste esa novedad directamente y
  **no llama al motor** para ese dia — no tiene sentido calcular a partir de
  marcas de un dia en que el empleado no debia trabajar.
- **Valor monetario a pagar**: el sistema calcula horas por concepto, no
  pesos. La liquidacion monetaria queda para contabilidad/nomina externa.

## Otros modulos del paquete

- `weekly-hours-tracker.ts` — acumula minutos ordinarios/extra ya
  consumidos en la semana ISO antes del dia en calculo (input del punto 5).
- `colombian-holidays.ts` / `easter.ts` — calendario de festivos
  colombianos, incluida la Ley Emiliani (traslado al lunes siguiente) y el
  calculo de Pascua (varios festivos dependen de ella).
- `shift-rotation-planner.ts` — generador inteligente de rutinas de turnos
  rotativos (equipos cubriendo 24h, reparto equitativo de descansos).
- `milking-rotation-planner.ts` — planificador especializado para fincas:
  rotacion de ordeñadores + vaquero, jornada especial con dia corto
  quincenal, vaqueros fijos con reemplazo automatico.

## Testing

No hay suite de Jest para este paquete todavia; se ha verificado con
scripts `npx tsx` ad-hoc que ejercitan casos concretos (turno nocturno que
cruza medianoche, tope de horas extra excedido, rotacion de ordeño con 1 y 2
estaciones, etc.) — revisa el historial de cambios del paquete si necesitas
un caso de referencia. Si vas a modificar el motor, la forma mas segura de
verificar es escribir un script similar antes de tocar nada, correrlo, y
confirmar que el output esperado no cambia salvo por lo que querias
modificar.
