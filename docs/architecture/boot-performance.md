# Arranque: concurrencia, readiness y cachés

Qué hace lento el arranque, qué lo acota y qué palancas existen. El costo no está en el heap del
kernel (~38 MB) sino en los **procesos hijos de bundler**: uno por módulo UI.

## Instrumentación

[`BootTimeline`](../../src/utils/system/BootTimeline.ts) mide cada fase con `performance.now()` y
muestrea la RSS de los hijos desde `/proc/<pid>/statm`.

- `BOOT-PHASE <nombre> <ms>` por fase (nivel DEBUG) y un `BOOT-TOTAL` con el total, el pico de los
  hijos y las fases más lentas (nivel INFO).
- JSON Lines en `temp/boot-timings.jsonl` — siempre, para diffear entre corridas sin depender del log.
- `ADC_BOOT_TIMELINE=false` la apaga.

Fases útiles: `services:kernel`, `apps:preset-uilibs`, `apps:src`, `apps:presets`, `app:<instancia>`,
`build:<módulo>`, `ready:<módulo>`. La **compresión** que da el paralelismo es
`Σ app:* / (apps:src + apps:presets + apps:preset-uilibs)`.

## Concurrencia acotada

Las capas de apps (`src` y cada preset) se cargan en paralelo bajo un **único**
[`LoadSemaphore`](../../src/utils/system/LoadSemaphore.ts). Que el semáforo sea uno solo es el punto:
uno por rama daría un techo por rama y el pico real se multiplicaría por la cantidad de ramas.

- Techo default `min(4, CPUs-1)`, con freno por presión de memoria
  ([`MemoryProbe`](../../src/utils/system/MemoryProbe.ts): cgroup v2, `MemAvailable`, PSI,
  `memory.events`). Nunca baja de 1, así que el peor caso es el arranque serial de siempre.
- Nunca preempta: un hijo de bundler no se puede des-spawnear, y liberar un slot cuyo hijo sigue
  residente rompe la cota. Un trabajo que sigue vivo a los 90 s emite WARN, nunca un release forzado.
- `BOOT_MAX_PARALLEL=1` restaura el timing serial exacto, sin redeploy.

Dos piezas hacen que paralelizar sea **correcto** y no sólo rápido:

1. **Contexto de carga por flujo asíncrono.** `ModuleRegistry` guarda la instancia que está cargando
   en un `AsyncLocalStorage`, no en un slot global. Ese contexto atribuye la propiedad de los
   providers (es lo que `cleanupAppModules` libera y lo que alimenta la cascada de reload); con un
   slot único, dos apps concurrentes se lo pisan y descargar A decrementa un provider de B.
2. **Construcción single-flight.** El patrón `hasModule() → await loadX() → register()` tiene un
   `await` en el medio: dos apps concurrentes pasan ambas el chequeo, ambas construyen, y el registry
   descarta una **después** de que abrió su conexión. `ModuleLoader.#loadOnce` dedupe por clave de
   módulo, así que la segunda espera en vez de construir.

## Readiness real, no sleeps

- **rspack** ([`readiness.ts`](../../src/services/core/UIFederationService/strategies/shared/readiness.ts)):
  carrera de cuatro brazos con techo de 20 s — `compiled successfully`/`built in` en stdout (teeado
  sobre el handler de logs, no lo reemplaza), `GET /main.js` con 200, artefacto en disco más nuevo
  que el spawn, y exit no-cero. **No** un `net.connect`: `rspack serve` acepta conexiones antes de
  compilar, así que un socket abierto no dice nada (medido: ganaba en ~200 ms sin bundle generado).
- **Stencil**: resuelve sobre la línea `build finished` de stdout. El poll de existencia del loader
  quedó como fallback y exige `mtime` posterior al spawn — sin eso retornaba en la primera iteración
  en cualquier árbol ya compilado, marcando `built` mientras seguía compilando, y los hosts
  bundleaban contra un `init.js`/`styles.css` viejo.

Arreglar esto hace que el arranque **parezca** más lento: antes terminaba antes de tiempo.

## Caché persistente de rspack

`temp/rspack-cache/<namespace>/<módulo>`, un directorio por módulo. Aislada por
`contrato|versión-de-rspack|modo`, así que un upgrade de rspack o un cambio dev↔prod nunca reutiliza
artefactos de la combinación anterior.

Se invalida por hash de: la config generada (que cubre por transitividad a los generadores, los
aliases y la lista de módulos registrados), las configs de Tailwind/PostCSS, el `package.json` del
módulo, su `config.json`, y el `package.json` + `bun.lock` de la raíz.

Válvulas de escape, de menor a mayor alcance:

| Palanca | Cuándo |
| --- | --- |
| `POST /api/modules/ui-cache/clear` (`{namespace?, module?}`) | caché sospechada de vieja; instalación manual de dependencias |
| Automático antes de cada `reloadFromDisk` de un deploy git | el árbol cambió por fuera de lo que rspack observa |
| `BUNDLER_CACHE_CONTRACT` en [`bundler-cache.ts`](../../src/common/utils/bundler-cache.ts) | cambió algo del resultado que no está cubierto por `buildDependencies` |
| `ADC_RSPACK_CACHE=false` | descartar la caché como causa de un problema |

Borrarla con la plataforma arriba es seguro: rspack recrea el directorio y, si no puede, compila sin
caché. Lo que **no** hace es afectar a un watcher ya corriendo — su estado vive en memoria, así que
el efecto se ve en el próximo arranque del proceso.

## Recortar la flota de bundlers

| Flag | Efecto |
| --- | --- |
| `ENABLE_TESTS=true` (`bun run dev:tests`) | carga `src/apps/test`: 8 apps más, un bundler cada una. Apagado por default, también en desarrollo |
| `ADC_UI_APPS=adc-home,adc-drive` | compila **sólo** esas apps. Las UI libraries (Stencil) van siempre: son la dependencia contra la que bundlean los hosts |
| `ADC_LOAD_APPS=adc-drive` | **no carga** el resto: nivel de carga, no de build (ver abajo) |
| `ADC_NO_UI_SERVERS=true` | ningún build ni servidor; los módulos UI se registran igual. Lo usa `driver.mjs boot-check` |

### `ADC_UI_APPS` vs `ADC_LOAD_APPS`

Son dos niveles distintos y se pueden usar por separado:

- `ADC_UI_APPS` es de **build**: las apps fuera de la lista se cargan, registran y abren sus
  providers igual; sólo se saltea su bundler. Sirve para recortar la flota de hijos.
- `ADC_LOAD_APPS` es de **carga**: las apps fuera de la lista ni se leen. Es el boot dirigido de
  verdad (iterar sobre una app sin pagar el árbol entero).

`ADC_LOAD_APPS` se expande sola al **cierre transitivo de `uiDependencies`** e incluye siempre las
UI libraries, así que alcanza con nombrar la app bajo prueba: sin eso, el host quedaría esperando
remotes que nunca se registran y el timeout de 30 s haría el boot dirigido *más lento* que el
completo. Un nombre que no matchea ninguna app se avisa por log en vez de recortar en silencio.

Lo que queda afuera se le declara **dormido** al `ModuleOrchestrator` (`setDormantApps`). Es la
pieza sin la cual esto no se puede activar: `memberState` considera FALLO a cualquier app
configurada-pero-no-cargada pasada la gracia de 3 min, así que un boot dirigido pondría roja la
status page pública y el modules-manager abriría incidentes automáticos. Dormido no es ni baja
manual ni `pending`: aparece como tal en el panel y no cuenta para la disponibilidad.

La dormancia **se arrastra a los services**: la env var sólo nombra apps, pero un service se carga
porque alguien lo declara, así que dejar dormida a la app que lo consume hace que nunca cargue. El
orquestador los deriva en `friendlyAvailability` (un service sin cargar cuyos consumidores
**requeridos** están todos dormidos también lo está, en cadena). Se miran sólo los requeridos: quien
lo declaró `optional` funciona sin él, y si contara, un `kernelMode` que lo declara opcionalmente
—`EmailService` ← Identity/Notification— bastaría para seguir reportándolo caído. Un service sin
consumidores requeridos se carga por su cuenta y su ausencia sí es un fallo.

## Lo que NO se hace, y por qué

- **Hidratación on-demand de apps dormidas + stub de puerto**: `ADC_LOAD_APPS` deja la app sin
  cargar hasta el próximo arranque; levantarla *a demanda* es otra cosa. En dev `serveModule` no
  registra hosts (retorna en cuanto hay `devPort`), así que el hook del gateway donde colgar la
  hidratación es inalcanzable y el diseño colapsa en un listener que debe desocupar el puerto antes
  de que `rspack serve` lo tome: un TOCTOU con `EADDRINUSE` por hidratación.
- **Planificador topológico global**: ninguna app de preset depende de otra app de preset. Sería
  código nuevo que debe reproducir un recorrido que ya funciona, a cambio de cero ganancia medida.
- **Builds en workers de `ExecutionManagerService`**: los worker threads comparten espacio de
  direcciones y límites del proceso, y rspack/stencil son CLIs. Peor aislamiento, cero ahorro de RAM.
