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
automáticamente.

### Hot reload de archivos de configuración

El Kernel detecta cambios en los `config*.json` de las apps y recarga **solo la instancia
específica** asociada a ese archivo, sin afectar otras instancias de la misma app:

- **Cambio de archivo:** al editar un `config*.json`, solo se reinicia la instancia correspondiente.
- **Nuevo archivo:** al agregar un config nuevo, se crea automáticamente una nueva instancia.
- **Eliminación de archivo:** al borrar un config, se detiene y remueve la instancia correspondiente.

Ejemplo: con `user-profile:main` (`config-main.json`) y `user-profile:secondary`
(`config-secondary.json`) corriendo, editar `config-main.json` solo reinicia `user-profile:main`.

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
