# App UI — Controles que quedan nativos a propósito (excepciones)

Excepciones a la regla general (usar los átomos) de [frontend.md](frontend.md) → «Controles de formulario».

**Quedan nativos a propósito** (no convertir a `adc-*`):

- **File pickers ocultos** (`type="file"`).
- **Editores especializados**: overlays de texto posicionados sobre un canvas; editores monospace de archivos.
- **Controles inline densos de un editor** donde el estilo de formulario desentona.
- **`<select>` con opciones deshabilitadas** (`adc-select` no las soporta) o dentro de **modales con scroll**
  (su dropdown puede recortarse).
- **Checkboxes que ya replican el estilo del átomo**: convertirlos no aporta y arriesga regresiones.
