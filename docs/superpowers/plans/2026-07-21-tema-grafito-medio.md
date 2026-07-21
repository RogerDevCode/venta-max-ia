# Tema grafito medio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reducir el deslumbramiento del frontend con una paleta grafito medio accesible.

**Architecture:** Ajustar exclusivamente tokens semánticos globales y reglas de foco para que componentes existentes hereden la nueva apariencia sin duplicar estilos.

**Tech Stack:** Tailwind CSS, variables CSS, Next.js, Playwright.

## Tasks

### Task 1: Tokens y accesibilidad

**Files:**
- Modify: `src/app/globals.css`

- [ ] Reemplazar fondos blancos por capas grafito medio y conservar el acento white-label.
- [ ] Añadir foco visible para controles interactivos y asegurar texto principal/secundario contrastado.
- [ ] Verificar `pnpm lint && pnpm typecheck`.

### Task 2: Verificación de interfaz

**Files:**
- Verify: `src/app/(auth)/layout.tsx`, `src/components/ui/*.tsx`

- [ ] Abrir registro y comprobar fondo, tarjeta, texto, input, botón y foco.
- [ ] Ejecutar `pnpm test` y una comprobación Playwright local si el servidor está disponible.
- [ ] Ejecutar `pnpm build`; registrar cualquier fallo externo al cambio.

