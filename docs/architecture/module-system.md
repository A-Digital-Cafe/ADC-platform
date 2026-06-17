# Sistema de Módulos: loaders, versionado y dependencias

Cómo el Kernel descubre, versiona, carga (incluso cross-language) y aísla dependencias de los
módulos. Para el comportamiento runtime de una app ya cargada (instancias, hot reload, docker), ver
[app-runtime.md](app-runtime.md); para el overview de capas, [README.md](README.md).

## Loaders

Sistema de carga de módulos con soporte para:

- Versionado semántico.
- Múltiples lenguajes (TypeScript, Python).
- Interoperabilidad cross-language via IPC (named pipes).

`LoaderManager` selecciona el loader según el lenguaje declarado; `VersionResolver` resuelve la
versión compatible antes de importar.

## Sistema de Versionado

El sistema soporta versionado semántico con el patrón: `{moduleName}/{version}-{language}/`

### Estructura de Módulos

```
src/services/
├── JsonFileCrud/
│   ├── index.ts                    # Versión default (1.0.0)
│   └── config.json                 # (Opcional) Dependencias del service
├── JsonFileCrud/1.0.1-ts/
│   └── index.ts                    # Versión específica TypeScript
├── JsonFileCrud/2.0.0-ts/
│   └── index.ts                    # Versión major
└── JsonFileCrud/1.0.0-py/
    └── index.py                    # Versión en Python
```

### Especificadores de Versión

Soportados: `1.0.0` (exacta), `^1.0.0` (caret), `~1.2.3` (tilde), `>=1.0.0`, `>1.0.0`, `<=2.0.0`,
`<2.0.0`, `*`/`latest`.

### Declarar en config.json (Apps)

```json
{
	"failOnError": false,
	"services": [
		{
			"name": "JsonFileCrud",
			"version": "^1.0.0",
			"language": "typescript",
			"custom": {}
		}
	]
}
```

## Interoperabilidad Multi-Lenguaje

ADC Platform soporta módulos en múltiples lenguajes mediante IPC (named pipes):

- **TypeScript ↔ Python:** los módulos Python se comunican con TypeScript via named pipes nativos del SO.
- **KernelLogger:** los módulos Python tienen acceso al logger del kernel, manteniendo logs uniformes.
- **Serialización:** buffers y datos complejos se serializan automáticamente (base64 para JSON).

```json
{
	"utilities": [
		{
			"name": "json-file-adapter",
			"version": "1.0.0-py",
			"language": "python"
		}
	]
}
```

## Gestión de Dependencias con Workspaces

El proyecto usa [npm workspaces](https://docs.npmjs.com/cli/v7/using-npm/workspaces) para gestionar
dependencias de forma modular. Cada app, provider, utility y service es un "paquete" individual del
workspace, lo que permite un manejo aislado y eficiente.

### Estructura

- Cada módulo (ej. `src/apps/user-profile`) contiene su propio `package.json`.
- El `package.json` raíz define la ubicación de estos paquetes con la directiva `workspaces`.

### Añadir dependencias a un módulo

Usar el flag `-w` (`--workspace`) desde la raíz. El nombre del workspace se define en el
`package.json` del módulo:

```bash
# Instala 'lodash' únicamente para el módulo 'user-profile'
bun add lodash -w @adc-platform/user-profile
```

### Beneficios

- **Aislamiento:** las dependencias de un módulo no afectan a otros.
- **Mantenimiento simplificado:** si eliminas el directorio de un módulo y reinstalas, sus
  dependencias dejan de instalarse, manteniendo `node_modules` limpio.
- **Instalación única:** un solo `bun install` en la raíz instala todas las dependencias de todos los
  módulos.
