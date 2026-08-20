# Operar los documentos legales

Los cuatro documentos versionados (`terms`, `privacy`, `cookies`, `dpa`) se administran desde la tab
**«Legales»** del panel de administración (`adc-admin-panel`, permiso `security:legal`, sólo en
contexto global). Esta guía es lo que la pantalla no alcanza a decir.

## El texto vive en el código, y eso es a propósito

Cada documento es un componente React (`presets/help/apps/help/src/pages/*.tsx`) y su metadata está
en [`src/common/utils/legal-docs.ts`](../../src/common/utils/legal-docs.ts). Los dos viajan en el
mismo despliegue, así que un nodo nunca puede servir un texto mientras un registro central afirma
otra versión. La contrapartida es que **publicar una versión nueva es un cambio de código**; el
panel lo calcula y lo verifica, pero no lo hace por vos.

El PDF congelado (`presets/help/apps/help/public/legal/`) está **gitignored**: lleva horneados el
nombre legal, el CUIT y el domicilio, que llegan por `ADC_PUBLIC_*` para que un fork no los herede.
Por eso desarrollo y producción tienen archivos distintos, y por eso el panel muestra siempre el
estado **del nodo que responde**.

## Los dos estados que hay que distinguir

| Estado | Cuándo | Editar el texto cuesta |
| --- | --- | --- |
| **En preaviso** | `hoy < effectiveFrom` | Sólo actualizar `contentHash` y sumar una entrada a `corrections`. Versionar acá pediría re-aceptar algo que nadie aceptó todavía. |
| **Vigente** | `hoy >= effectiveFrom` | Una versión nueva: `version` = hoy, `effectiveFrom` = hoy + 30 (`MIN_LEGAL_NOTICE_DAYS`), `contentHash` nuevo. El panel muestra las tres líneas ya calculadas. |

La condición para corregir en lugar de versionar es que el cambio **amplíe derechos, asuma
obligaciones o informe de más** — nunca que recorte. Si recorta algo, es una versión nueva aunque el
documento todavía no rija.

## Cómo publicar una versión nueva

1. Editar el `.tsx`.
2. `bun run check:legal` (o `bun run extra-checks`): dice el `contentHash` nuevo y, si el documento
   ya regía, también las fechas del bump.
3. Pegar esos valores en `legal-docs.ts`. Si fue una corrección dentro de la ventana, sumar la
   entrada a `corrections` — es lo que la tab lista como trazabilidad.
4. Desplegar. `LegalDocsService` genera el PDF de la versión nueva al arrancar, y 30 s después
   anuncia el cambio a todas las cuentas (una sola vez, con lease entre nodos y dedup por
   `broadcastId`). La re-aceptación no se pide hasta `effectiveFrom`.
5. Verificar en la tab que el documento quedó sin alertas y que el aviso figura en el historial.

## Qué se ejecuta solo

| Cuándo | Qué | Dónde se ve |
| --- | --- | --- |
| Al arrancar el servicio | Verifica el sello de los cuatro documentos; genera los PDF faltantes | Historial (`pdf`) + warnings del log |
| 30 s después del arranque, en un solo nodo | Anuncia los cambios de versión respecto de la marca de Redis | Historial (`announce`) |
| `bun run extra-checks` | Chequeo de deriva y de preaviso, sin estado | Salida del comando |

**El primer arranque no anuncia nada**: sella lo desplegado como punto de partida y lo deja
asentado. Es lo que evita que un Redis nuevo dispare cuatro avisos por cambios que no ocurrieron.

## Rehacer un PDF congelado

Sólo si el archivo salió mal —por ejemplo con los datos del responsable vacíos porque faltaban las
`ADC_PUBLIC_*` al generarlo—, **nunca** para reflejar un cambio de texto: eso es una versión nueva.
El botón exige un motivo, lo asienta en el audit log (`legal.pdf-rebuild`) antes de tocar nada y
falla con 503 si la auditoría no está disponible. Afecta al nodo donde corre; los demás conservan el
suyo hasta que se rehaga ahí también.

## Cifras de aceptación

Un `$group` sobre las cuentas activas, cacheado 5 minutos. El número accionable es **«vieron el
aviso y no aceptaron»**: quien inició sesión después de `effectiveFrom` vio el gate de
re-aceptación sí o sí, así que seguir pendiente es una decisión. Las cuentas con baja programada
quedan fuera del denominador.

Nadie puede ser obligado a aceptar para ejercer sus derechos: el gate (`adc-legal-gate`) no tapa
`help`, `my-account`, `adc-auth` ni `adc-status`, y siempre ofrece cerrar sesión.
