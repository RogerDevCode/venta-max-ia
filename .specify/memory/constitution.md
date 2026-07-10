<!--
SYNC IMPACT REPORT
==================
Plantilla base del starter. Personaliza por proyecto con /speckit-constitution.

Versión actual: 1.1.0 (plantilla starter)
Principios definidos (9):
  - I.    Seguridad de Datos Primero (NO NEGOCIABLE)
  - II.   Soberanía / Self-Hosted        [ajustable por proyecto]
  - III.  Multi-Tenancy Real             [aplica si el producto es multi-tenant]
  - IV.   Idempotencia en Integraciones Externas
  - V.    Calidad Verificable Antes de "Hecho" (NO NEGOCIABLE)
  - VI.   Specs Antes de Código
  - VII.  Trazabilidad de Decisiones
  - VIII. Foco Vertical [DEFINE-TU-NICHO]   <- RELLENA esto por proyecto
  - IX.   Verificación de Comportamiento en Vivo (NO NEGOCIABLE)

Historial de la plantilla:
  - 1.0.0: 8 principios base (I-VII genéricos + VIII hueco del nicho).
  - 1.1.0: añadido Principio IX "Verificación de Comportamiento en Vivo" —
    self-test E2E + loop de auto-corrección (self-improvement loop) por el
    implementador para toda feature con comportamiento observable.

Cómo usar esta plantilla:
  1. Ejecuta /speckit-constitution y describe tu producto + nicho.
  2. Conserva, ajusta o elimina los principios genéricos (I-VII) según tu caso.
     Algunos (multi-tenancy, self-hosted) no aplican a todo proyecto: bórralos
     si no corresponden en lugar de dejarlos como letra muerta.
  3. Reemplaza el Principio VIII por el foco vertical real de tu producto.
  4. Sube la versión y actualiza este Sync Impact Report.
-->

# [NOMBRE_DEL_PROYECTO] Constitution

[Una línea sobre qué es el producto]. Esta constitución define las reglas no
negociables del producto. Aplica a todas las fases del flujo de trabajo (specify,
plan, tasks, implement). Cualquier conflicto entre una decisión de implementación y
esta constitución SE RESUELVE A FAVOR de esta constitución.

> **Esto es una plantilla.** Los principios I-VII son defaults sólidos y genéricos
> heredados del starter; consérvalos, ajústalos o elimínalos según tu producto. El
> Principio VIII es el **hueco del nicho**: defínelo. Usa `/speckit-constitution`
> para personalizar y versionar este archivo.

## Core Principles

### I. Seguridad de Datos Primero (NO NEGOCIABLE)

La protección de datos es la primera responsabilidad del sistema, por encima de
velocidad de entrega o conveniencia de desarrollo.

- Tokens, credenciales y secretos sensibles NUNCA se exponen al cliente (navegador,
  app, respuestas de API) ni se escriben en logs, trazas o mensajes de error.
- Todo secreto se almacena cifrado en reposo. Las claves de cifrado se gestionan
  fuera del código fuente y fuera del control de versiones.
- Si el producto es multi-tenant, todo dato de un tenant está aislado de los demás:
  ninguna consulta, endpoint o tarea en segundo plano debe devolver o modificar datos
  de un tenant distinto al del solicitante. El aislamiento se aplica por defecto.

**Rationale**: Una fuga de credenciales o un cruce de datos entre clientes es un
fallo catastrófico e irreversible; prevenirlo siempre cuesta menos que remediarlo.

### II. Soberanía / Self-Hosted   [ajustable por proyecto]

El producto debería poder operar sobre infraestructura propia, sin depender de SaaS
de terceros para sus funciones core. *(Ajusta o elimina si tu producto acepta
servicios gestionados.)*

- Las funciones CORE —autenticación y base de datos— corren sobre infraestructura
  controlada por el operador del producto. Depender de un tercero para una función
  core se justifica explícitamente en el Complexity Tracking del plan.
- El almacenamiento de objetos PUEDE usar un servicio externo compatible con S3
  SIEMPRE QUE el código acceda vía la interfaz S3 estándar, de modo que migrar a una
  alternativa self-hosted (p. ej. MinIO) no requiera cambios de código.
- Las integraciones externas inevitables se aíslan tras una frontera clara para no
  acoplar el core a ellas.

**Rationale**: La soberanía sobre datos e infraestructura es un diferenciador y un
requisito para clientes con restricciones de residencia de datos.

### III. Multi-Tenancy Real   [aplica si el producto es multi-tenant]

El sistema sirve a múltiples organizaciones independientes desde una sola instancia
lógica. *(Elimina este principio si tu producto es single-tenant.)*

- Cada organización (tenant) gestiona sus propios usuarios, roles y permisos.
- El identificador de tenant es un parámetro de primer nivel en el modelo de datos y
  en la capa de acceso a datos, no un campo opcional añadido a posteriori.

**Rationale**: Multi-tenancy diseñado desde el inicio evita reescrituras costosas y
hace cumplible el aislamiento del Principio I.

### IV. Idempotencia en Integraciones Externas

Todo evento entrante de un sistema externo (webhooks, callbacks de pago,
notificaciones de terceros) se procesa de forma idempotente.

- Recibir el mismo evento dos o más veces NO duplica efectos observables (mensajes
  reenviados, cargos repetidos, registros duplicados).
- Cada evento entrante se identifica de forma única y su procesamiento se registra
  para detectar y descartar reintentos.

**Rationale**: Los proveedores externos reintentan entregas por diseño; sin
idempotencia, los reintentos corrompen datos y generan acciones duplicadas.

### V. Calidad Verificable Antes de "Hecho" (NO NEGOCIABLE)

Ninguna tarea se considera terminada sin pasar verificación.

- "Hecho" requiere, como mínimo: comprobación de tipos, lint y build; y tests donde
  apliquen al alcance de la tarea.
- Lo que NO se pueda verificar automáticamente se marca explícitamente como
  "pendiente de verificación humana"; no se reporta como completado sin esa marca.
- No se reporta una tarea como terminada describiendo que "debería funcionar": o pasa
  la verificación, o se declara su estado real (incluyendo fallos).

**Rationale**: La verificación automática es la única definición de "hecho" que no
depende de optimismo.

### VI. Specs Antes de Código

Ninguna feature se implementa sin una especificación previa.

- La especificación describe el comportamiento observable por el usuario, no la
  implementación.
- El orden del flujo es specify → plan → tasks → implement; el código de una feature
  no comienza antes de existir su spec.
- Correcciones triviales y cambios sin comportamiento observable nuevo (typos,
  formato, refactors internos sin cambio de contrato) están exentos.

**Rationale**: Especificar el comportamiento observable antes de codificar previene
retrabajo y mantiene alineadas todas las fases del flujo.

### VII. Trazabilidad de Decisiones

Las decisiones tomadas sin contexto suficiente se documentan para revisión humana.

- Cuando una decisión se toma con información incompleta o supuestos no confirmados,
  se registra de forma visible (en el spec, el plan, el PR o un marcador
  `NEEDS CLARIFICATION` / TODO con responsable), no se entierra en el código.
- Los supuestos que condicionan el comportamiento se hacen explícitos para que un
  humano pueda revisarlos y revertirlos.

**Rationale**: Las decisiones implícitas bajo incertidumbre son la principal fuente
de deuda oculta; hacerlas visibles permite corregirlas a tiempo.

### VIII. Foco Vertical [DEFINE-TU-NICHO]

> **RELLENA ESTE PRINCIPIO.** Es el que ancla el producto a un dominio concreto e
> impide que derive hacia una herramienta genérica. Ejemplo del proyecto original:
> "Foco Vertical Inmobiliario — es un CRM inmobiliario, no una herramienta genérica
> de mensajería".

Este producto sirve específicamente a **[describe tu nicho: clínicas, restaurantes,
talleres, e-commerce, etc.]**.

- El modelo de datos y los flujos MUST reflejar el dominio real de **[tu nicho]**.
- **[El canal/tecnología principal, p. ej. WhatsApp]** es un medio, no define la
  naturaleza del producto.
- Toda feature MUST servir a **[tu usuario objetivo]**. Cualquier feature que no
  cumpla esa condición queda FUERA del alcance de v1.

**Rationale**: Un foco vertical explícito mantiene el modelo de datos alineado con el
negocio real y da un criterio claro para aceptar o rechazar alcance.

### IX. Verificación de Comportamiento en Vivo (NO NEGOCIABLE)

Complementa el Principio V. TODA feature con comportamiento observable —UI web,
mensajería, API o integración externa— se verifica ejerciendo ese comportamiento como
lo haría un usuario real antes de declararse "Hecha". El gate técnico (Principio V) es
el piso, no el techo.

- **Self-test + loop por el implementador (self-improvement loop).** Tras implementar,
  quien implementa ejecuta el self-test E2E —camino feliz Y camino infeliz (degradación
  sin colgarse)— y, si algo falla, diagnostica, corrige y re-verifica él mismo hasta
  verde. No se entrega trabajo a medio verificar ni se delega la prueba funcional al
  dueño. Lo único delegable a verificación humana es lo intrínsecamente no verificable
  por herramientas (juicio visual, aprobación de un tercero), marcado explícitamente.
- **Se conduce la interfaz real.** Navegador vía Playwright para features de UI; la línea
  del canal (p. ej. una API de WhatsApp de prueba) para mensajería; llamadas a la API
  donde esa sea la superficie. No basta con tipos/lint/build, ni con que un endpoint
  devuelva 2xx, ni con inspeccionar la base de datos: se observa el resultado de cara al
  usuario.
- **Local primero, nube después.** Si el comportamiento puede reproducirse en `localhost`
  —incluyendo integraciones externas vía túnel (p. ej. ngrok + handshake del webhook desde
  el panel del proveedor)—, SHOULD probarse ahí antes de desplegar. El deploy a la nube se
  reserva para lo que el entorno local no pueda reproducir, porque desplegar consume tiempo
  y reduce la agilidad del ciclo.
- **Guardarraíles con herramientas no oficiales.** Cuando la prueba use herramientas no
  oficiales vinculadas a un número/cuenta real, MUST respetarse reglas duras: enviar solo a
  destinatarios de una allowlist, NUNCA mensajes en ráfaga (anti-flood obligatorio), y
  minimizar el volumen. La integridad de la cuenta del operador es un activo a proteger, en
  línea con el Principio I.

**Rationale**: El gate técnico no detecta que un agente "se calló", que una tarjeta no
llegó como un solo mensaje, o que un botón de UI no disparó nada — eso solo aparece
ejerciendo el flujo real. Y el valor del paso no está solo en detectar el fallo sino en
cerrarlo: el implementador itera hasta verde en vez de devolver trabajo a medias. Probar
en local primero mantiene el ciclo ágil; y sin guardarraíles duros, una prueba con
herramientas no oficiales podría provocar un baneo irreversible.

## Restricciones de Plataforma y Seguridad

Estas restricciones derivan de los Principios I y II y son verificables en revisión:

- **Gestión de secretos**: los secretos se inyectan vía configuración de entorno o un
  gestor de secretos; nunca se comprometen a control de versiones.
- **Cifrado en reposo**: credenciales y datos sensibles se almacenan cifrados; el
  almacenamiento en claro de secretos es una violación.
- **Frontera de tenant** (si aplica): la capa de acceso a datos exige el identificador
  de tenant; cualquier acceso que pueda omitirlo requiere justificación explícita.
- **Aislamiento de integraciones**: las dependencias de APIs externas se acceden a
  través de adaptadores dedicados, no dispersas por el dominio.

## Flujo de Desarrollo y Puertas de Calidad

- **Orden del flujo**: specify → plan → tasks → implement. Cada fase consume el
  artefacto de la anterior.
- **Puerta constitucional (Constitution Check)**: el plan de cada feature evalúa el
  cumplimiento de estos principios antes de la Fase 0 y se re-evalúa tras el diseño de
  la Fase 1. Las violaciones se registran y justifican en Complexity Tracking o se
  eliminan.
- **Puerta de calidad (Definición de "Hecho")**: tipos + lint + build en verde, y
  tests donde apliquen; lo no verificable automáticamente se marca como pendiente de
  verificación humana (Principio V). Para features con comportamiento observable de cara
  al usuario, "Hecho" exige además el self-test de comportamiento en vivo ejecutado por el
  implementador, con sus guardarraíles (Principio IX).
- **Trazabilidad**: decisiones bajo incertidumbre y supuestos se documentan de forma
  visible (Principio VII), no en comentarios enterrados.

## Governance

Esta constitución es la autoridad máxima del proyecto. Prevalece sobre cualquier otra
práctica, convención o preferencia; ante un conflicto, gana la constitución.

- **Procedimiento de enmienda**: toda enmienda se propone por escrito describiendo el
  cambio y su motivación, se aprueba por el responsable del proyecto y se registra en
  el control de versiones junto con el Sync Impact Report actualizado.
- **Política de versionado** (semantic versioning de la constitución):
  - **MAJOR**: eliminación o redefinición incompatible de un principio o de la
    gobernanza.
  - **MINOR**: adición de un principio/sección nueva o expansión material.
  - **PATCH**: aclaraciones, correcciones de redacción y refinamientos no semánticos.
- **Revisión de cumplimiento**: cada PR y cada revisión de diseño verifican el
  cumplimiento de estos principios. La complejidad que viole un principio debe
  justificarse; si no, debe eliminarse.
- **Propagación**: al enmendar la constitución se revisan y, si procede, se actualizan
  las plantillas dependientes (plan, spec, tasks).

**Version**: 1.1.0 | **Ratified**: [FECHA] | **Last Amended**: [FECHA]
