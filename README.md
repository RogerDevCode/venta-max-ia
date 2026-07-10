# Claude SDD Starter

Andamiaje **evergreen** para arrancar cualquier proyecto trabajando con **Claude Code**
bajo **Spec-Driven Development (SDD)**. No es un boilerplate de aplicación: es el *cómo se
construye con Claude* — la metodología, los agentes, las skills y el MCP — listo para
montar encima el stack y el nicho que quieras (p. ej. un SaaS de mensajería WhatsApp para
clínicas, restaurantes, talleres, etc.).

## Qué ES y qué NO es

| ES | NO es |
|---|---|
| El motor de metodología SDD / Spec Kit | Un boilerplate de SaaS (no trae `src/`, ORM, auth…) |
| La arquitectura de tres agentes | Código de aplicación de ningún nicho |
| Las skills (`speckit-*`, `loop-sdd`, deploy) | Una app desplegable tal cual |
| La plantilla de MCP + guía de instalación | Secretos ni credenciales reales |

## Los 4 pilares

1. **SDD / Spec Kit** — `.specify/` (plantillas spec/plan/tasks/constitution, scripts,
   workflows) + las skills `speckit-*` + la constitución plantilla + `CLAUDE.md`.
2. **Arquitectura de tres agentes** — el **orquestador** (la sesión principal de Claude
   Code, gobernada por `CLAUDE.md` + `loop-sdd`) que invoca a dos **subagentes**:
   `deploy-ops` y `public-site-builder`. Ver [docs/three-agent-architecture.md](docs/three-agent-architecture.md).
3. **Skills** — en `.claude/skills/`. Ver lista abajo.
4. **MCP** — `.mcp.json` (vacío) + `.mcp.json.example` + [docs/mcp-setup.md](docs/mcp-setup.md).
   El MCP se instala con un comando de CLI (`claude mcp add`), no desde un archivo suelto.

## Estructura

```
claude-sdd-starter/
├─ CLAUDE.md                  # contrato de trabajo con Claude (metodología + stack placeholder)
├─ README.md                  # este archivo
├─ LICENSE                    # MIT (rellena el titular)
├─ .gitignore                 # endurecido (protege .env y secretos)
├─ .env.example               # contrato de variables con placeholders + guía inline
├─ .mcp.json                  # MCP scoped al proyecto (arranca vacío)
├─ .mcp.json.example          # ejemplos: Playwright + GitHub
├─ skills-lock.json           # versionado de skills externas (agentic-microservice-deployer)
├─ .specify/                  # motor Spec Kit (plantillas, scripts, constitución, workflows)
│   └─ memory/constitution.md # constitución plantilla (I-VII genéricos, VIII = tu nicho)
├─ .claude/
│   ├─ agents/                # deploy-ops.md, public-site-builder.md (el orquestador eres tú)
│   ├─ agent-memory/          # memoria de proyecto de cada subagente (versionada)
│   └─ skills/                # speckit-*, loop-sdd, agentic-microservice-deployer
├─ docs/                      # getting-started, sdd-workflow, three-agent, mcp-setup
└─ specs/                     # aquí aterrizan tus features (una carpeta NNN-nombre por feature)
```

## Requisitos previos

- **Claude Code** instalado y autenticado.
- **PowerShell** (los scripts de Spec Kit en `.specify/scripts/powershell/` están en PS) —
  o pórtalos a tu shell si trabajas en Linux/macOS.
- **git**, y opcionalmente **Node.js + pnpm/npx** (para MCP vía `npx` y, cuando montes app,
  el stack que elijas).

## Arranque en 5 pasos

1. **Copia y renombra** esta carpeta para tu proyecto, e inicializa git:
   ```bash
   git init && git add -A && git commit -m "chore: SDD starter"
   ```
2. **Define la constitución**: ejecuta `/speckit-constitution` y describe tu producto +
   nicho. Rellena el Principio VIII y ajusta I-VII (ver
   [.specify/memory/constitution.md](.specify/memory/constitution.md)).
3. **Personaliza `CLAUDE.md`**: nombre del proyecto, stack real, y borra los placeholders.
4. **Configura el MCP** que necesites (ver [docs/mcp-setup.md](docs/mcp-setup.md)) y copia
   `.env.example` → `.env` con tus credenciales.
5. **Arranca tu primera feature** describiendo un objetivo (modo Loop SDD) o con
   `/speckit-specify`. Ver [docs/sdd-workflow.md](docs/sdd-workflow.md).

## Skills incluidas

**Metodología SDD**
- **`speckit-*`** (15): el flujo SDD completo — `specify`, `clarify`, `plan`, `tasks`,
  `analyze`, `implement`, `checklist`, `constitution`, `taskstoissues`, más los `git-*`.
- **`loop-sdd`**: ejecutar **objetivos** de punta a punta en loop autónomo
  (Discover→Plan→Execute→Verify→Iterate).

**Deploy**
- **`agentic-microservice-deployer`**: deploy a un PaaS self-hosted (Coolify de referencia),
  usada por el subagente `deploy-ops`.

**Integración Meta / WhatsApp** (el backbone agnóstico de nicho del producto)
- **`whatsapp-saas-meta-infra`**: construir la infraestructura — Embedded Signup, OAuth
  callbacks, verificación de webhooks, status de mensajes, data deletion / deauthorize,
  persistencia. Cada cliente conecta SU cuenta de WhatsApp Business.
- **`whatsapp-meta-app-review`**: pasar el App Review de Meta —
  `whatsapp_business_management` / `whatsapp_business_messaging`, guion de screencast,
  patrones de rechazo, flujo review-only.

> Nota: las *referencias* de estas dos skills usan **Supabase/Vercel** como ejemplo de
> stack. El conocimiento de Meta (Embedded Signup, webhooks, App Review) es independiente
> del stack; adapta los ejemplos de persistencia/deploy a tu stack real (el starter
> apunta a Postgres self-hosted + Coolify).

## Cómo trabajar (resumen)

- **Da objetivos, no micro-prompts.** El orquestador corre el loop SDD y vuelve solo cuando
  el objetivo está verificado en vivo o hay un bloqueo real.
- **"Hecho" = verificado por Claude**, no "debería funcionar": typecheck + lint + build
  **y** un self-test de comportamiento E2E. Ver la *Definición de Hecho REFORZADA* en
  `CLAUDE.md`.
- **Specs antes de código.** Toda feature pasa por specify → plan → tasks → implement.

## Personalización

Busca y reemplaza los placeholders `[entre corchetes]` y los marcadores `REEMPLAZA_...`:
`CLAUDE.md`, `.specify/memory/constitution.md`, `LICENSE`, `.env.example`. Los dos
subagentes están escritos para **leer del proyecto** (no asumir nicho), así que funcionan
sin tocarlos; ajústalos si tu plataforma de deploy o tu proveedor externo difieren.

## Licencia

MIT — ver [LICENSE](LICENSE) (rellena el titular del copyright).
