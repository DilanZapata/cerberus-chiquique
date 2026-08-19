# Documentacion tecnica de Cerberus

Esta carpeta es la documentacion para desarrolladores (no confundir con la
guia de uso para usuarios finales, que vive dentro de la propia app web en
`/help`).

- [`architecture.md`](./architecture.md) — vision general del sistema, monorepo, stack, como se comunican las apps entre si.
- [`getting-started.md`](./getting-started.md) — como levantar todo el proyecto en local desde cero.
- [`database.md`](./database.md) — modelo de datos: tablas principales y como se relacionan.
- [`cst-engine.md`](./cst-engine.md) — como funciona el motor de calculo de novedades laborales (el corazon del sistema).
- [`conventions.md`](./conventions.md) — convenciones de codigo y patrones a seguir al agregar funcionalidad nueva.

Si vas a tocar el motor de calculo (`packages/cst-rules`), lee primero
`cst-engine.md` completo antes de cambiar nada — es la parte con mas reglas
de negocio implicitas del proyecto.
