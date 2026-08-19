# Convenciones de codigo

Guia de patrones a seguir al agregar funcionalidad nueva, para que el
codigo se sienta escrito por una sola persona. No es exhaustiva — cuando
tengas dudas, copia el patron del modulo mas parecido que ya exista en vez
de inventar uno nuevo.

## Backend (`apps/api`)

- **Un modulo de negocio = `service` + `controller` + `module` + `dto/`.**
  El `service` tiene toda la logica y las queries de Prisma; el
  `controller` solo valida el DTO de entrada (via `class-validator`) y
  delega — nunca pongas logica de negocio en un controller.
- **Flujo de aprobacion (pendiente → aprobar/rechazar)**: el patron de
  referencia es `modules/overtime/overtime-approval.service.ts` —
  `listPending()` + `review(id, decision, reviewerId)`. Los modulos
  `incidences` y `rest-credits` siguen el mismo shape. Si agregas un flujo
  de aprobacion nuevo, replicalo en vez de inventar otro.
- **Autenticacion**: JWT global (`JwtAuthGuard` aplicado a nivel de app) con
  `@Public()` para excluir rutas (login, endpoints de kiosco que usan su
  propio `KioskTokenGuard`). Permisos por rol con `@Roles(...)` +
  `RolesGuard`. El usuario autenticado se obtiene con `@CurrentUser()`,
  nunca confies en un `userId`/`companyId` que venga en el body del
  request para decidir a que empresa pertenece algo.
- **Multi-tenant**: todo query que toque datos de negocio debe filtrar por
  `companyId` del usuario autenticado. Si un ID (departmentId, workSiteId,
  etc.) viene del cliente, verifica que pertenezca a esa misma empresa
  antes de usarlo — no asumas que el frontend nunca mandara un ID ajeno.
- **DTOs**: `class-validator` + `class-transformer`, con
  `whitelist: true, transform: true` en el `ValidationPipe` global — los
  campos no declarados en el DTO se descartan silenciosamente, no llegan
  al service.
- **Fechas**: `workDate`/`earnedForDate`/etc. son `@db.Date` (sin hora) y se
  tratan como string `YYYY-MM-DD` en las interfaces de `cst-rules` para
  evitar bugs de timezone al comparar solo fechas.
- **Archivos subidos** (fotos de marcaje/enrolamiento): se guardan en disco
  bajo `apps/api/uploads/<subfolder>/`, nunca en la base de datos como
  blob. Solo la ruta relativa se persiste (ver `photo-storage.util.ts`).

## Motor de calculo (`packages/cst-rules`)

- **Funciones puras.** Nada de I/O, nada de Prisma, nada de `Date.now()`
  implicito — todo lo que el calculo necesita entra como parametro. Esto es
  lo que permite testear con `npx tsx` sin levantar nada.
- Antes de tocar `novelty-calculator.ts` o `hours-classifier.ts`, lee
  `cst-engine.md` completo — son las reglas de negocio con mas matices
  legales del proyecto y un cambio mal hecho puede afectar calculos
  historicos.

## Web (`apps/web`)

- **App Router**, paginas autenticadas bajo el grupo de rutas `(app)/`,
  envueltas por `AppShell`. Una pagina nueva del panel administrativo va en
  `src/app/(app)/<ruta>/page.tsx` y automaticamente hereda el sidebar.
- **`src/lib/api.ts` es el unico lugar que hace `fetch` al backend.** Una
  pantalla nueva agrega su funcion ahi (adjuntando el JWT), nunca hace
  `fetch` directo desde el componente.
- **Sistema de diseño**: componentes reusables en `src/components/ui/`
  (`Card`, `Badge`, `PageHeader`, etc.) — usalos en vez de reimplementar
  estilos ad-hoc. Tailwind con tokens semanticos (`text-ink`,
  `text-ink-secondary`, `bg-surface-page`, `border-line-hair`) en vez de
  colores crudos, para que el tema se pueda ajustar centralizado.
- Formularios largos (crear/editar empleado, config de nomina) siguen el
  patron de secciones en `Card` + validacion simple en el cliente antes de
  enviar.

## Mobile (`apps/mobile`)

- **Sesion**: `src/services/auth.ts` (`AsyncStorage`) mirror exacto del
  shape de `StoredUser` en web — si cambias un campo de sesion, cambialo en
  ambos lados.
- **`src/services/api.ts` es el unico lugar que hace `fetch`.** A
  diferencia de web, cada funcion recibe el `token` como primer argumento
  explicito (mobile no tiene un modulo global sincrono equivalente a
  `localStorage`).
- **Navegacion por rol**: `RootNavigator.tsx` decide el stack completo de
  pantallas segun `!session` / `isAdminRole(role)` / empleado — no metas
  chequeos de rol dentro de pantallas individuales para ocultar botones,
  la pantalla completa ya esta gated a nivel de stack.
- **Sin librerias de picker/selector**: los formularios usan chips
  (`TouchableOpacity` en fila) para elegir rol/departamento/sede, para no
  sumar una dependencia nueva por un select simple.
- **Camara**: usa `expo-camera`, ya instalado. El patron de "evidencia
  silenciosa" (preview siempre visible, captura automatica al enviar el
  formulario) es el que se uso en kiosco PIN y marcaje GPS de empleado —
  replicalo si agregas otro flujo con foto de evidencia en vez de pedir una
  confirmacion extra al usuario.

## General

- **No agregues dependencias nuevas si el problema se resuelve con lo que
  ya esta instalado.** Revisa `package.json` de la app correspondiente
  antes de instalar algo.
- **No hay backwards-compatibility que mantener**: este es un proyecto
  greenfield sin usuarios en produccion, asi que al cambiar un contrato
  (DTO, forma de sesion, endpoint) actualiza todos los consumidores en el
  mismo cambio en vez de dejar shims temporales.
- **Verificacion**: no hay CI todavia. Antes de dar por terminado un
  cambio, corre `npx tsc --noEmit` en la app tocada y, si es posible,
  pruebalo en el navegador/simulador — ver `getting-started.md` para cómo
  levantar cada app.
