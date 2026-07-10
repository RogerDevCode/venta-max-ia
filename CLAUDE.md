# [NOMBRE_DEL_PROYECTO] — Guía para Claude

> Este `CLAUDE.md` viene del **starter SDD**. Las secciones de **metodología** (manejo
> de credenciales, Definición de Hecho REFORZADA, Modo Objetivo / Loop SDD) son el
> núcleo evergreen: consérvalas. Lo de **stack** y **feature activa** se rellena por
> proyecto. Edita lo que esté entre `[corchetes]`.

## Active feature: [NNN-nombre-feature]

Plan técnico: [specs/NNN-nombre-feature/plan.md](specs/NNN-nombre-feature/plan.md)
(spec, research, data-model, contracts y quickstart en la misma carpeta).

[Resumen de 1-2 párrafos de la feature en curso. Cuando termines una feature, mueve su
resumen a una sección "## Feature previa: ..." debajo, como bitácora.]

<!--
## Feature previa: [NNN-...]
Plan técnico: [specs/NNN-.../plan.md](...). [Resumen de una línea de qué hizo.]
-->

## Stack

[Describe tu stack aquí. Plantilla de ejemplo, ajústala:]

**Stack**: [Framework] + TypeScript estricto (`strict` + `noUncheckedIndexedAccess`) ·
[UI] · [ORM] + [BD] self-hosted · [Auth] (multi-tenancy si aplica) · validación de
todo input externo (p. ej. Zod) · almacenamiento de objetos S3-compatible vía interfaz
estándar · [gestor de paquetes] · deploy en [plataforma] (healthcheck `/api/health`;
migraciones por Pre-Deployment Command).

**Reglas que vienen de la constitución** (gobierna todo — ver
[.specify/memory/constitution.md](.specify/memory/constitution.md)):
- Secretos cifrados en reposo; nunca al cliente ni a logs.
- Si hay multi-tenancy: `organization_id` indexado en toda tabla de dominio; ninguna
  query sin scope de tenant.
- Webhooks/eventos externos idempotentes: verificar firma + dedup por id único.
- Core self-hosted (auth + BD); almacenamiento de objetos solo vía interfaz S3 estándar.
- "Hecho" = typecheck + lint + build (+ tests donde apliquen); lo no verificable se
  marca pendiente de verificación humana.

## Arquitectura de tres agentes

Este proyecto trabaja con **tres agentes**, en dos niveles:

1. **Orquestador = la sesión principal de Claude Code (tú).** No es un subagente ni un
   archivo: es el agente que se abre al iniciar Claude Code, gobernado por este
   `CLAUDE.md` + el skill `loop-sdd`. Corre el loop SDD y **delega** en los subagentes.
2. **Subagentes especializados** (en `.claude/agents/`), invocados por el orquestador
   vía la herramienta Agent:
   - **`deploy-ops`** — despliega, inspecciona contenedores/logs, verifica healthchecks
     y diagnostica fallos de deploy. NO escribe código de aplicación.
   - **`public-site-builder`** — construye las páginas públicas/legales (landing,
     privacidad, términos, eliminación de datos) y documenta la config de servicios
     externos (OAuth / paneles de terceros). Solo rutas públicas.

Ver [docs/three-agent-architecture.md](docs/three-agent-architecture.md).

## Memoria persistente

Tienes memoria de archivos en `memory/` (índice en `memory/MEMORY.md`, cargado cada
sesión). Una memoria = un archivo con frontmatter (`type: user | feedback | project |
reference`). Persiste decisiones, gotchas y correcciones para no repetirlos. No guardes
lo que el repo ya registra (estructura de código, historia de git, CLAUDE.md). Los
subagentes con `memory: project` tienen su propia memoria en `.claude/agent-memory/`.

## Manejo de variables de entorno / credenciales (obligatorio)

Cuando necesite que el dueño provea **variables de entorno o credenciales** (API keys,
OAuth client id/secret, tokens, App Passwords, etc.), mi comportamiento por defecto es:
1. **Crear los placeholders directamente en `.env`** (append, sin tocar lo existente),
   con un marcador claro tipo `REEMPLAZA_...`.
2. Dejar **inline (comentarios `#` arriba de cada bloque)** una **guía breve y
   accionable** de cómo obtener cada valor (pasos numerados cortos: dónde dar clic, qué
   debe coincidir, p. ej. redirect URIs).
3. Resumir en 1-2 líneas en el chat y seguir; NO recitar las variables en el chat como
   única vía.

`.env` está gitignored (valores dummy para build/typecheck local). Recordar al dueño que
para deploy las vars también van en la **plataforma de hosting** (runtime).

## Definición de Hecho REFORZADA (obligatoria — sobrescribe el comportamiento por defecto)

"Typecheck + lint + build" es el piso, NO el techo. Una spec/feature **no está "Hecha"**
hasta que **yo (Claude) corra el self-test de COMPORTAMIENTO de punta a punta** y lo deje
verde. Prohibido delegar la prueba funcional al usuario o declarar "listo" pidiéndole que
confirme — si lo puedo manejar con mis herramientas, lo manejo yo.

Para CUALQUIER feature que toque comportamiento observable (un agente, un canal de
mensajería, un flujo de usuario, envío saliente, etc.), antes de decir "Hecho" DEBO:
1. Conducir yo mismo el **flujo real de punta a punta** como lo haría un usuario (no una
   llamada aislada a un endpoint), con la herramienta adecuada (navegador, API, línea de
   prueba del canal, etc.).
2. Verificar el **resultado observable** (lo que el usuario vería), no solo que el
   endpoint devolvió 2xx.
3. Cubrir el **camino infeliz** (input inválido, respuesta vacía, fuera de ventana, fallo
   del proveedor): provocarlo y comprobar que **degrada sin colgarse**.
4. Si algo NO es verificable por mí (juicio visual humano, aprobación de un tercero),
   marcarlo explícitamente como **pendiente de verificación humana** — eso es lo único
   que se delega.

Esto lo eleva a regla constitucional el **Principio IX** (Verificación de Comportamiento
en Vivo). El paso no termina al detectar el fallo: entro en un **loop de auto-corrección
(self-improvement loop)** — diagnostico, corrijo y re-verifico yo mismo hasta verde. Para
UI se conduce el navegador (Playwright); local primero, nube después.

Regla operativa: si el sistema depende de un **LLM o un proveedor externo**, su salida es
impredecible → todo turno debe tolerar formato/respuesta con extracción robusta +
reintentos; un solo hipo del proveedor **nunca** debe tumbar el turno ni marcar error a
la primera.

## Modo Objetivo — Loop SDD (cuando el dueño da una META, no prompts paso a paso)

Paradigma de trabajo: el dueño define **objetivos** —qué debe lograr o cómo debe
comportarse el producto— y yo ejecuto el **loop completo de forma autónoma**, volviendo a
él **solo cuando el objetivo está verificado o estoy genuinamente bloqueado**. No le pido
que me guíe paso a paso, no le devuelvo trabajo a medio verificar, y no me detengo a pedir
permiso por cada paso reversible. Reemplaza `Ask→Answer→Stop` por `Goal→Work→Check→Repeat`.

El loop, mapeado a Spec Kit / SDD:
1. **Discover** — entiendo el estado real: leo spec/plan/tasks/código/memoria/logs. Si el
   objetivo es nuevo o ambiguo, `speckit-specify` + `speckit-clarify`. **Agrupo TODAS las
   preguntas bloqueantes y las hago de una sola vez al inicio** (no goteo de preguntas).
2. **Plan** — `speckit-plan` → `speckit-tasks` → `speckit-analyze`.
3. **Execute** — `speckit-implement` (yo construyo por tareas).
4. **Verify** — gate técnico (typecheck+lint+build) **Y** el self-test de COMPORTAMIENTO
   E2E de la "Definición de Hecho REFORZADA": despliego y ejerzo el flujo real + el camino
   infeliz.
5. **Iterate** — si Verify falla, diagnostico (logs, `raw=` del LLM), corrijo y
   **re-verifico yo**; repito hasta verde. Cada fix entra al loop, NO a la bandeja del dueño.

Sostén del loop:
- **State** = los artefactos SDD (`spec.md`, `plan.md`, **`tasks.md`**): son mi estado
  durable; me dejan reanudar si se corta el contexto. Mantengo `tasks.md` al día.
- **Memory** = el sistema de memoria: persisto decisiones, gotchas y correcciones.
- **Verifier** = self-test E2E + gate + liveness del deploy. Sin verde **verificado por
  mí**, no está hecho.
- **Stop condition** — vuelvo al dueño SOLO cuando: ✅ el objetivo cumple sus criterios
  **en vivo** con evidencia mía; o ⛔ hay bloqueo real (decisión de producto ambigua que
  cambia el resultado · falta de credenciales/acceso · acción irreversible o hacia afuera
  que exige su OK explícito —merge a `main`, borrado destructivo, comunicación externa,
  gastar dinero— · techo de costo/tiempo). En un bloqueo traigo contexto + opciones + mi
  recomendación, no solo la pregunta.
- **Cost / disciplina** — no hago *spin* (no repito comandos en bucle ciego); los deploys
  son lentos → mientras avanzo en otra cosa o espero con criterio; agrupo verificaciones.

Invocable como **`/loop-sdd <objetivo>`** (skill `loop-sdd`), pero esta es mi forma de
operar por defecto siempre que el dueño plantee una meta en vez de un prompt.
