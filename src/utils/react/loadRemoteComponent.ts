/**
 * Utilidad para cargar componentes remotos en layouts React.
 * Soporta wrapping de componentes React, Vue y Vanilla JS.
 *
 * NOTA: Este archivo solo debe usarse en layouts que tengan React como sharedLib.
 */
import React from "react";

export type Framework = "react" | "vue" | "vanilla";

export interface RemoteComponentResult {
	Component: React.ComponentType<any>;
	moduleName: string;
	timestamp: number;
}

export interface LazyLoadRemoteComponentOptions {
	/** URL del remoteEntry.js (ej: 'http://localhost:3001/remoteEntry.js') */
	remoteEntryUrl: string;
	/** Nombre del contenedor remoto (debe coincidir con ModuleFederationPlugin) */
	remoteName: string;
	/** Scope del módulo expuesto (ej: './App') */
	scope: string;
	/** Nombre del módulo para logs */
	moduleName: string;
	/** Framework del módulo */
	framework: Framework;
	/** Componente de error personalizado (opcional) */
	errorComponent?: (error: Error, moduleName: string) => React.ReactElement;
}

/**
 * Crea un wrapper de React para un componente Vue
 */
function createVueWrapper(RemoteComponent: any, moduleName: string, timestamp: number): React.FC<any> {
	return (props: any) => {
		const containerRef = React.useRef<HTMLDivElement>(null);
		const vueAppRef = React.useRef<any>(null);

		React.useEffect(() => {
			let cancelled = false;
			if (containerRef.current && !vueAppRef.current) {
				// Vue se importa dinámicamente: así un host React-only que solo monta
				// remotes React nunca descarga el runtime de Vue (queda en chunk aparte).
				// NOTA: isCustomElement se configura en vue-loader (build-time), no aquí
				void import("vue").then(({ createApp }) => {
					if (cancelled || !containerRef.current || vueAppRef.current) return;
					vueAppRef.current = createApp(RemoteComponent, props);
					vueAppRef.current.mount(containerRef.current);
					console.log(`[Layout] Vue app montada: ${moduleName}`);
				});
			}

			return () => {
				cancelled = true;
				if (vueAppRef.current) {
					vueAppRef.current.unmount();
					vueAppRef.current = null;
					console.log(`[Layout] Vue app desmontada: ${moduleName}`);
				}
			};
		}, []);

		return React.createElement(
			"div",
			{
				"data-module": moduleName,
				"data-framework": "vue",
				"data-timestamp": timestamp,
				style: { display: "contents" },
			},
			React.createElement("div", { ref: containerRef })
		);
	};
}

/**
 * Crea un wrapper de React para un componente Vanilla JS (clase con mount/unmount)
 */
function createVanillaWrapper(RemoteComponent: any, moduleName: string, timestamp: number): React.FC {
	return () => {
		const containerRef = React.useRef<HTMLDivElement>(null);
		const appInstanceRef = React.useRef<any>(null);

		React.useEffect(() => {
			if (containerRef.current && !appInstanceRef.current) {
				appInstanceRef.current = new RemoteComponent();
				appInstanceRef.current.mount(containerRef.current);
				console.log(`[Layout] Vanilla JS app montada: ${moduleName}`);
			}

			return () => {
				if (appInstanceRef.current?.unmount) {
					appInstanceRef.current.unmount();
					appInstanceRef.current = null;
					console.log(`[Layout] Vanilla JS app desmontada: ${moduleName}`);
				}
			};
		}, []);

		return React.createElement(
			"div",
			{
				"data-module": moduleName,
				"data-framework": "vanilla",
				"data-timestamp": timestamp,
				style: { display: "contents" },
			},
			React.createElement("div", { ref: containerRef })
		);
	};
}

/**
 * Crea un wrapper de React para un componente React remoto
 */
function createReactWrapper(RemoteComponent: any, moduleName: string, timestamp: number): React.FC<any> {
	return (props: any) => {
		return React.createElement(
			"div",
			{
				"data-module": moduleName,
				"data-framework": "react",
				"data-timestamp": timestamp,
				style: { display: "contents" },
			},
			React.createElement(RemoteComponent, props)
		);
	};
}

/**
 * Componente de error por defecto (usa adc-error de la ui-library)
 */
function DefaultErrorComponent(error: Error, moduleName: string): React.ReactElement {
	let httpError: number | undefined;
	const errorMessage = error.message;

	if (errorMessage.includes("Failed to fetch") || errorMessage.includes("CONNECTION_REFUSED")) {
		httpError = 503;
	} else if (errorMessage.includes("404") || errorMessage.includes("not found")) {
		httpError = 404;
	}

	return React.createElement(
		"div",
		{
			"data-module": moduleName,
			"data-framework": "error",
			"data-timestamp": Date.now(),
			style: { display: "contents" },
		},
		React.createElement("adc-error", {
			"http-error": httpError,
			"error-title": httpError ? undefined : "Aplicación no disponible",
			"error-description": httpError ? undefined : `En estos momentos, ${moduleName} no está disponible`,
			color: "#ef4444",
		})
	);
}

/**
 * Carga dinámicamente el script remoteEntry.js de un módulo remoto.
 * Evita cargar el mismo script múltiples veces.
 */
async function loadRemoteEntry(url: string, name: string): Promise<void> {
	// Check si ya está cargado
	const existingScript = document.querySelector(`script[data-remote-entry="${name}"]`);
	if (existingScript) {
		return;
	}

	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = url;
		script.type = "text/javascript";
		script.async = true;
		script.dataset.remoteEntry = name;

		script.onload = () => {
			console.log(`[Layout] 📦 Remote entry loaded: ${name} from ${url}`);
			resolve();
		};

		script.onerror = () => {
			reject(new Error(`Failed to load remote entry: ${url}`));
		};

		document.head.appendChild(script);
	});
}

/**
 * Carga un componente remoto de forma LAZY (sin pre-declaración en rspack config).
 * Carga el remoteEntry.js dinámicamente y obtiene el módulo del contenedor.
 *
 * @example
 * ```typescript
 * const result = await lazyLoadRemoteComponent({
 *   remoteEntryUrl: 'http://localhost:3001/remoteEntry.js',
 *   remoteName: 'home',
 *   scope: './App',
 *   moduleName: 'home',
 *   framework: 'vanilla',
 * });
 * ```
 */
export async function lazyLoadRemoteComponent(options: LazyLoadRemoteComponentOptions): Promise<RemoteComponentResult> {
	const { remoteEntryUrl, remoteName, scope, moduleName, framework, errorComponent } = options;
	const timestamp = Date.now();

	try {
		// 1. Cargar el script del remoteEntry.js
		await loadRemoteEntry(remoteEntryUrl, remoteName);

		// 2. Obtener el contenedor del window
		const container = (globalThis as any)[remoteName];
		if (!container) {
			throw new Error(`Remote container "${remoteName}" not found after loading ${remoteEntryUrl}`);
		}

		// 3. Inicializar el contenedor con los shared scopes
		// @ts-expect-error - webpack/rspack runtime global
		await container.init(__webpack_share_scopes__.default);

		// 4. Obtener el módulo del contenedor
		const factory = await container.get(scope);
		const module = factory();
		const RemoteComponent = module.default ?? module;

		console.log(`[Layout] ✅ Lazy loaded ${moduleName} from ${remoteEntryUrl}`);
		console.log(`[Layout] Framework detectado para ${moduleName}: ${framework}`);

		// 5. Crear el wrapper según el framework
		let WrapperComponent: React.ComponentType<any>;

		switch (framework) {
			case "vue":
				WrapperComponent = createVueWrapper(RemoteComponent, moduleName, timestamp);
				break;
			case "vanilla":
				WrapperComponent = createVanillaWrapper(RemoteComponent, moduleName, timestamp);
				break;
			case "react":
			default:
				WrapperComponent = createReactWrapper(RemoteComponent, moduleName, timestamp);
				break;
		}

		return { Component: WrapperComponent, moduleName, timestamp };
	} catch (error) {
		console.error(`[Layout] ❌ Error lazy loading ${moduleName}:`, error);

		const ErrorComponent = () =>
			errorComponent ? errorComponent(error as Error, moduleName) : DefaultErrorComponent(error as Error, moduleName);

		return { Component: ErrorComponent, moduleName, timestamp: Date.now() };
	}
}
