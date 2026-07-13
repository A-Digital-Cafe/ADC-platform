# Runtime de Apps: instancias, hot reload y docker

Comportamiento de una app en ejecución: cómo se crean múltiples instancias desde archivos de
config, cómo recarga en desarrollo y cómo se auto-provisiona infraestructura con Docker. Para cómo
se cargan/versionan los módulos, ver [module-system.md](module-system.md); para el overview de
capas, [README.md](README.md).

## Instancias Múltiples de Apps

Es posible crear múltiples instancias de una misma aplicación con distintos archivos de config. El
Kernel busca archivos de configuración en dos ubicaciones dentro del directorio de una app:

1. **Raíz de la app:** `config.json` o `config-*.json` en la raíz del directorio.
2. **Subdirectorio `configs/`:** `config.json` o `config-*.json` dentro de `configs/`.

Por cada archivo encontrado, el Kernel crea una nueva instancia. El nombre combina el nombre de la
app y el sufijo del archivo: el prefijo `config-` se elimina y un `config.json` plano genera el
sufijo `default` (ver [src/core/apps/AppFileUtils.ts](../../src/core/apps/AppFileUtils.ts)).

```
src/apps/user-profile/
├── index.ts
├── config-main.json
└── configs/
    ├── config-web.json
    └── config-api.json
```

Crea las instancias `user-profile:main`, `user-profile:web` y `user-profile:api`. Cada una recibe su
propia configuración y se ejecuta de forma independiente (p.ej. la misma lógica conectada a
diferentes bases de datos o con distintos parámetros).

### Configuración de módulos por instancia

Los archivos de instancia (ej. `config-main.json`) también pueden contener una sección `modules`
para declarar dependencias y configuraciones de módulos específicas de esa instancia.

## Hot Reloading

En desarrollo (`NODE_ENV=development`) el Kernel observa cambios y recarga componentes
automáticamente. Los watchers vigilan **directorios** y filtran por path (chokidar ≥4 no
soporta globs).

### Hot reload de archivos de configuración

El Kernel detecta cambios en los `config*.json` de las apps y recarga **solo la instancia
específica** asociada a ese archivo, sin afectar otras instancias de la misma app:

- **Cambio de archivo:** al editar un `config*.json`, solo se reinicia la instancia correspondiente.
- **Nuevo archivo:** al agregar un config nuevo, se crea automáticamente una nueva instancia
  (solo si la app **ya corre**; si la app es nueva, queda pendiente — ver abajo).
- **Eliminación de archivo:** al borrar un config, se detiene y remueve la instancia correspondiente.

Ejemplo: con `user-profile:main` (`config-main.json`) y `user-profile:secondary`
(`config-secondary.json`) corriendo, editar `config-main.json` solo reinicia `user-profile:main`.

## Módulos nuevos en runtime: detección sin ejecución (pending)

Un módulo (app/service/provider/utility) que **aparece en disco con el kernel corriendo**
NO se autoejecuta. El `ModuleDetector` (`src/core/runtime/ModuleDetector.ts`) lo registra
como **pendiente** en el disabled-set — sin importar su código; solo lee su `config.json`
para resolver el nombre — y:

- Aparece en **adc-modules-manager** con estado `pending` (badge "Nuevo / sin lanzar") y la
  acción **Lanzar** (= `POST /api/modules/enable`), que hace la primera carga aprobada.
- El preset persiste el estado (`module_statuses`, `pending: true` + `filePath`): un módulo
  dropeado en runtime **sigue pendiente tras un reinicio** (los loaders saltean pendings al boot).
- Se audita (`detect` / `detect-remove` si su fuente se borra antes de lanzarlo) y el kernel
  avisa al equipo de seguridad (topic `security.module_detected`, Admins + Security Managers).
- Los eventos `change`/config de un módulo pendiente **o deshabilitado** se ignoran (editar el
  archivo de un módulo detenido no lo resucita).
- El hot reload (`change`) de módulos **ya cargados** no cambia: editar código de un módulo
  corriendo lo recarga como siempre. Un `config-*.json` nuevo de una app corriendo también
  carga la instancia normalmente (el código ya está aprobado).

### Presets nuevos en runtime

Un directorio nuevo bajo `presets/` (git clone / copia) se **adopta automáticamente**: el
kernel registra el topic, monta un watcher sobre el árbol del preset y todos sus módulos
entran como pendientes (nunca se autoejecutan). No hace falta reiniciar. Limitación: un
service `kernelMode` con prioridad mayor a la de `ModulesManagerService` (75) que llegue por
disco con el kernel apagado se carga al boot antes de que el estado persistido se aplique.

## Reintentos ante fallos (circuit breaker)

Si una app falla al cargar, inicializar o ejecutar (`run()`), el Kernel la reintenta con un
circuit breaker por instancia (`src/core/apps/CircuitBreaker.ts`): 5 reintentos cada 30s y,
agotados, uno cada 10 min. Cada reintento construye una **instancia nueva** (una instancia ya
provisionada no puede re-provisionarse) y re-chequea que la app no esté deshabilitada
(modules-manager o `disabled` en config) ni el kernel cerrándose. Al abrir el circuito se
notifica al equipo de seguridad (topic `security.module_failure`, Admins + Security Managers
globales). Un fallo tras ≥60s de corrida estable resetea el contador; reload/unload/disable
cancelan el reintento pendiente.

## Provisioning Automático con Docker Compose

El Kernel detecta automáticamente `docker-compose.yml` en las apps y lo ejecuta antes de iniciar la
aplicación:

- Si una app contiene `docker-compose.yml`, el Kernel ejecuta `docker-compose up -d` al cargarla.
- Los servicios se inician en background y el Kernel espera ~3 segundos para estabilización.
- Si docker-compose falla o no está disponible, continúa sin error (degradación graciosa).
- Recomendado para apps que requieren servicios como MongoDB, Redis, etc.

```
src/apps/test/user-profile/
├── index.ts
├── default.json
└── docker-compose.yml          # ← Se ejecuta automáticamente
```
