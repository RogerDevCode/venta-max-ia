# specs/

Aquí aterriza el trabajo SDD. Cada feature crea su propia carpeta numerada:

```
specs/
└─ NNN-nombre-feature/
   ├─ spec.md         # QUÉ y POR QUÉ (comportamiento observable, sin implementación)
   ├─ plan.md         # CÓMO (decisiones técnicas, Constitution Check)
   ├─ research.md     # decisiones a verificar (DV-...) y su resolución
   ├─ data-model.md   # entidades y relaciones
   ├─ contracts/      # contratos de API/endpoints
   ├─ quickstart.md   # cómo probar la feature
   ├─ checklists/     # checklists de calidad
   └─ tasks.md        # tareas dependency-ordered (tu estado durable)
```

No crees estas carpetas a mano: las generan los comandos de Spec Kit
(`/speckit-specify`, `/speckit-plan`, `/speckit-tasks`). El número `NNN` lo asigna
`/speckit-git-feature` (o el script `create-new-feature.ps1`).

Ver [../docs/sdd-workflow.md](../docs/sdd-workflow.md).
