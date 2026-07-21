# Diseño: tema grafito medio con contraste accesible

## Objetivo

Sustituir las superficies blancas intensas por una paleta grafito medio en todo
el frontend del tenant, desde registro e inicio de sesión hasta la aplicación
autenticada, sin reducir la legibilidad.

## Paleta

- Fondo principal: gris azulado medio `#d7dce2`.
- Fondo sutil y paneles: `#e4e8ed` y `#eef1f4`, para separar capas sin
  volver a blanco puro.
- Superficies de formularios y tarjetas: `#f7f9fb`; es el valor más claro y
  se reserva para áreas de lectura o introducción de datos.
- Texto principal: `#18212b`; secundario: `#465464`; texto tenue:
  `#647385`.
- Bordes: `#b9c3ce` y `#9eabb8`.
- Acento de marca: se conserva el mecanismo white-label actual. Sus variantes
  deben seguir mostrando texto con contraste AA.

## Alcance

Se ajustan los tokens semánticos de `globals.css`, de modo que registro,
inicio de sesión, navegación, paneles, tarjetas, inputs, áreas de texto,
selects, hover y foco consuman colores consistentes. El foco visible será un
anillo de acento con separación suficiente del borde.

No se alteran estructura, rutas, contenido ni la paleta configurable de cada
organización.

## Verificación

Se comprobará visualmente la pantalla de registro y un formulario del tenant
con Playwright, además de typecheck, lint y tests. Los colores de texto normal
contra sus fondos respectivos se mantendrán por encima de 4.5:1.

