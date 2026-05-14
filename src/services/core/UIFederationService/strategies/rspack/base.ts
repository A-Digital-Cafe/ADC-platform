import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { BaseFrameworkStrategy } from "../base-strategy.js";
import type { BundlerType, IBuildContext, IBuildResult } from "../types.js";
import { getConfigDir, getBinPath, getLogsDir, normalizeForConfig, getServerHost, getCommonPublicDir } from "../../utils/path-resolver.js";
import aliasGenerator from "../../utils/alias-generator.js";
import { generateTailwindConfig, generatePostCSSConfig, hasTailwindEnabled } from "../../config-generators/tailwind.js";

/**
 * Clase base para estrategias Rspack con lógica común de generación de config
 */
export abstract class RspackBaseStrategy extends BaseFrameworkStrategy {
	readonly bundler: BundlerType = "rspack";
	/**
	 * Genera la configuración de Rspack
	 */
	async generateConfig(context: IBuildContext): Promise<string> {
		const { module, namespace, registeredModules, uiOutputBaseDir } = context;
		const configDir = getConfigDir(namespace, module.uiConfig.name);
		await fs.mkdir(configDir, { recursive: true });

		const isLayout = this.isLayout(context);
		const isHost = this.isHost(context);
		const isProduction = process.env.NODE_ENV === "production";
		const safeName = this.getSafeName(module.uiConfig.name);

		// Los layouts ahora usan lazyLoadRemoteComponent, por lo que no necesitan pre-declarar remotes
		// Esto evita que todos los mf-manifest.json se carguen eagerly
		const remotes = {};
		const externals: string[] = [];

		// Detectar frameworks usados
		const usedFrameworks = aliasGenerator.detectUsedFrameworks(registeredModules, module);

		// Generar aliases
		const aliasesObject = aliasGenerator.generateForRspack(registeredModules, uiOutputBaseDir, module);

		// Configurar Tailwind si está habilitado
		let postcssConfigPath = "";
		let tailwindCssPath = "";
		if (hasTailwindEnabled(module)) {
			context.logger?.logInfo(`[${module.uiConfig.name}] Tailwind CSS habilitado, generando configuración...`);
			tailwindCssPath = await generateTailwindConfig(module, registeredModules, configDir, context.logger);
			postcssConfigPath = await generatePostCSSConfig(tailwindCssPath, configDir, context.logger);
		}

		// Generar contenido del config
		const configContent = this.buildConfigContent({
			context,
			safeName,
			isLayout,
			isHost,
			isProduction,
			remotes,
			externals,
			usedFrameworks,
			aliasesObject,
			postcssConfigPath,
			tailwindCssPath,
			configDir,
		});

		const configPath = path.join(configDir, "rspack.config.mjs");
		await fs.writeFile(configPath, configContent, "utf-8");
		context.logger?.logDebug(`Config Rspack generado: ${configPath}`);

		return configPath;
	}

	/**
	 * Inicia el dev server de Rspack
	 */
	async startDevServer(context: IBuildContext): Promise<IBuildResult> {
		const { module, namespace } = context;
		const configPath = await this.generateConfig(context);
		const rspackBin = getBinPath("rspack");

		const logName = `${namespace}-${module.uiConfig.name}`;
		context.logger?.logInfo(`Iniciando Rspack dev server para ${module.uiConfig.name} [${namespace}]...`);

		// Setup log redirection
		const logsDir = getLogsDir();
		await fs.mkdir(logsDir, { recursive: true });
		const logFile = path.join(logsDir, `${logName}.log`);
		await fs.appendFile(logFile, `\n--- Start of Session: ${new Date().toISOString()} ---\n`);

		const spawnOptions: any = {
			cwd: module.appDir,
			stdio: "pipe",
			shell: false,
		};

		if (process.platform !== "win32") {
			spawnOptions.detached = true;
		}

		const watcher = spawn(rspackBin, ["serve", "--config", configPath], spawnOptions);

		watcher.stdout?.on("data", async (data) => {
			try {
				await fs.appendFile(logFile, data);
			} catch {
				// Silent fail
			}
		});

		watcher.stderr?.on("data", async (data) => {
			try {
				await fs.appendFile(logFile, data);
			} catch {
				// Silent fail
			}
		});

		watcher.on("error", (error) => {
			context.logger?.logError(`Error en watcher Rspack ${module.uiConfig.name}: ${error.message}`);
			module.buildStatus = "error";
			fs.appendFile(logFile, `[ERROR] Spawn error: ${error.message}\n`).catch(() => {});
		});

		watcher.on("exit", (code, signal) => {
			const exitMsg = `Rspack watcher terminated (code: ${code}, signal: ${signal})\n`;
			fs.appendFile(logFile, exitMsg).catch(() => {});

			if (code !== 0 && signal !== "SIGTERM" && signal !== "SIGKILL" && signal !== "SIGINT") {
				context.logger?.logWarn(`Rspack watcher ${module.uiConfig.name} terminado inesperadamente. Ver logs: ${logFile}`);
				module.buildStatus = "error";
			}
		});

		const serverMode = context.isDevelopment ? "Dev Server" : "Production Server";
		context.logger?.logOk(`${module.uiConfig.name} [${namespace}] Rspack ${serverMode} iniciado. Logs: temp/logs/${logName}.log`);

		// Dar tiempo al servidor para arrancar y compilar
		await new Promise((resolve) => setTimeout(resolve, 5000));

		// El output path donde rspack genera los archivos (configurado en rspack.config.mjs)
		const outputPath = path.join(context.uiOutputBaseDir, module.uiConfig.name);
		return { watcher, outputPath };
	}

	/**
	 * Build estático (no aplicable para rspack por defecto - requiere devPort)
	 */
	async buildStatic(context: IBuildContext): Promise<IBuildResult> {
		// Rspack strategies requieren devPort, pero podemos generar un build de producción
		const configPath = await this.generateConfig(context);
		const rspackBin = getBinPath("rspack");
		const outputPath = path.join(context.uiOutputBaseDir, context.module.uiConfig.name);

		context.logger?.logInfo(`Ejecutando build de producción para ${context.module.uiConfig.name}...`);

		const { module, namespace, isDevelopment } = context;

		// En desarrollo, usar --watch para remotos (sin servidor HTTP)
		const useWatch = isDevelopment && !module.uiConfig.isHost;
		const buildMode = useWatch ? "build con watch" : "build de producción";
		const buildArgs = useWatch ? ["build", "--watch", "--config", configPath] : ["build", "--config", configPath];

		context.logger?.logInfo(`Ejecutando ${buildMode} para ${module.uiConfig.name} [${namespace}]...`);

		// Si es watch mode, manejar como proceso continuo (similar a dev server)
		if (useWatch) {
			const logName = `${namespace}-${module.uiConfig.name}`;
			const logsDir = getLogsDir();
			await fs.mkdir(logsDir, { recursive: true });
			const logFile = path.join(logsDir, `${logName}.log`);
			await fs.appendFile(logFile, `\n--- Start of Watch Build: ${new Date().toISOString()} ---\n`);

			const spawnOptions: any = {
				cwd: module.appDir,
				stdio: "pipe",
				shell: false,
			};

			if (process.platform !== "win32") {
				spawnOptions.detached = true;
			}

			const watcher = spawn(rspackBin, buildArgs, spawnOptions);

			watcher.stdout?.on("data", async (data) => {
				try {
					await fs.appendFile(logFile, data);
				} catch {
					// Silent fail
				}
			});

			watcher.stderr?.on("data", async (data) => {
				try {
					await fs.appendFile(logFile, data);
				} catch {
					// Silent fail
				}
			});

			watcher.on("error", (error) => {
				context.logger?.logError(`Error en watcher Rspack ${module.uiConfig.name}: ${error.message}`);
				module.buildStatus = "error";
				fs.appendFile(logFile, `[ERROR] Spawn error: ${error.message}\n`).catch(() => {});
			});

			watcher.on("exit", (code, signal) => {
				const exitMsg = `Rspack watcher terminated (code: ${code}, signal: ${signal})\n`;
				fs.appendFile(logFile, exitMsg).catch(() => {});

				if (code !== 0 && signal !== "SIGTERM" && signal !== "SIGKILL" && signal !== "SIGINT") {
					context.logger?.logWarn(`Rspack watcher ${module.uiConfig.name} terminado inesperadamente. Ver logs: ${logFile}`);
					module.buildStatus = "error";
				}
			});

			context.logger?.logOk(`${module.uiConfig.name} [${namespace}] Rspack Watch Build iniciado. Logs: temp/logs/${logName}.log`);

			// Dar tiempo al build inicial para completar
			await new Promise((resolve) => setTimeout(resolve, 5000));

			return { watcher, outputPath };
		}

		// Build de producción (sin watch)
		return new Promise((resolve, reject) => {
			const proc = spawn(rspackBin, buildArgs, {
				cwd: module.appDir,
				stdio: "pipe",
				shell: false,
			});

			let output = "";
			let errorOutput = "";

			proc.stdout?.on("data", (data) => {
				output += data.toString();
			});

			proc.stderr?.on("data", (data) => {
				errorOutput += data.toString();
			});

			proc.on("close", (code) => {
				if (code === 0) {
					context.logger?.logOk(`Build completado para ${module.uiConfig.name}`);
					resolve({ outputPath });
				} else {
					context.logger?.logError(`Build falló para ${module.uiConfig.name}`);
					context.logger?.logError(`Error: ${errorOutput.slice(0, 500)}`);
					reject(new Error(`Rspack build falló con código ${code}`));
				}
			});

			proc.on("error", (error) => {
				reject(error);
			});
		});
	}

	/**
	 * Detecta remotes para Module Federation (solo para hosts)
	 */
	protected async detectRemotes(context: IBuildContext): Promise<Record<string, string>> {
		const { namespace, registeredModules, module: currentModule, logger } = context;
		const remotes: Record<string, string> = {};
		const serverHost = getServerHost();

		logger?.logDebug(
			`[detectRemotes] ${currentModule.uiConfig.name} - namespace: ${namespace}, registered: ${Array.from(registeredModules.keys()).join(
				", "
			)}`
		);

		for (const [moduleName, mod] of registeredModules.entries()) {
			const modNamespace = mod.namespace || "default";
			// Excluir: módulos layout (hosts), el módulo actual, y módulos sin devPort o de otro namespace
			const isLayoutModule = moduleName.includes("layout");
			const isCurrentModule = moduleName === currentModule.uiConfig.name;

			// Solo incluir módulos que tengan devPort y estén en el mismo namespace
			if (!isLayoutModule && !isCurrentModule && mod.uiConfig.devPort && modNamespace === namespace) {
				const framework = mod.uiConfig.framework || "react";
				// Solo incluir frameworks soportados por rspack
				if (["react", "vue", "vanilla"].includes(framework)) {
					const safeRemoteName = this.getSafeName(moduleName);
					remotes[moduleName] = `${safeRemoteName}@http://${serverHost}:${mod.uiConfig.devPort}/mf-manifest.json`;
					logger?.logDebug(`[detectRemotes] Added remote: ${moduleName}`);
				}
			}
		}

		if (Object.keys(remotes).length > 0) {
			logger?.logDebug(`[detectRemotes] Total: ${Object.keys(remotes).length} remotes for ${currentModule.uiConfig.name}`);
		}
		return remotes;
	}

	/**
	 * Construye el contenido del archivo de configuración
	 */
	protected buildConfigContent(options: {
		context: IBuildContext;
		safeName: string;
		isLayout: boolean;
		isHost: boolean;
		isProduction: boolean;
		remotes: Record<string, string>;
		externals: string[];
		usedFrameworks: Set<string>;
		aliasesObject: string;
		postcssConfigPath: string;
		tailwindCssPath: string;
		configDir: string;
	}): string {
		const {
			context,
			safeName,
			isLayout,
			isHost,
			isProduction,
			remotes,
			externals,
			usedFrameworks,
			aliasesObject,
			postcssConfigPath,
			tailwindCssPath,
		} = options;

		const { module, uiOutputBaseDir } = context;
		const mode = isProduction ? "production" : "development";
		const devtool = isProduction ? "false" : "'cheap-module-source-map'";
		const hotReload = !isProduction;

		// Agregar alias para Tailwind CSS v4 si está habilitado
		let finalAliasesObject = aliasesObject;
		if (tailwindCssPath) {
			const originalTailwindCss = normalizeForConfig(path.join(module.appDir, "src", "styles", "tailwind.css"));
			const generatedTailwindCss = normalizeForConfig(tailwindCssPath);
			// Insertar el alias de Tailwind en el objeto de aliases
			if (finalAliasesObject === "{}") {
				finalAliasesObject = `{\n            '${originalTailwindCss}': '${generatedTailwindCss}'\n        }`;
			} else {
				// Insertar antes del cierre del objeto
				finalAliasesObject = finalAliasesObject.replace(
					/\n {8}\}$/,
					`,\n            '${originalTailwindCss}': '${generatedTailwindCss}'\n        }`
				);
			}
		}

		// Obtener configuración específica del framework
		const mainEntry = this.getMainEntry();
		const appExtension = this.getFileExtension();
		const extensions = JSON.stringify(this.getResolveExtensions());
		const moduleRules = this.getModuleRules(isProduction, postcssConfigPath);
		const plugins = this.getPlugins(context, isHost, usedFrameworks);
		const imports = this.getImports();
		const shared = this.buildSharedConfig(usedFrameworks);

		// Layouts cargan remotes, módulos remotos se exponen, host-only no tiene ni remotes ni exposes
		const isRemote = module.uiConfig.isRemote ?? false;
		let federationConfig: string;
		if (isLayout) {
			federationConfig = `remotes: ${JSON.stringify(remotes, null, 4)},`;
		} else if (isRemote) {
			federationConfig = this.buildExposesConfig(context, appExtension);
		} else {
			// Host-only modules: no exposes, no remotes — avoids producing a remoteEntry.js
			// that creates a separate runtime receiving hot-update pushes for foreign modules
			federationConfig = "";
		}

		// Determinar publicPath correcto
		// Para módulos remotos (isRemote) en desarrollo, usar URL absoluta del dev server
		// Esto es necesario para que cuando se carguen dinámicamente desde otro host,
		// los chunks como __federation_expose_App.js se carguen desde el servidor correcto
		// Para layouts (shell principal), usar '/'
		// Para producción, usar 'auto'
		const devPort = module.uiConfig.devPort;
		let publicPath: string;
		const serverHost = getServerHost();

		if (isRemote && devPort && !isProduction) {
			// Para módulos remotos en desarrollo, usar URL completa del dev server
			// Esto aplica incluso si también son isHost (pueden ejecutarse standalone)
			publicPath = `'http://${serverHost}:${devPort}/'`;
		} else if (isHost) {
			// Los hosts (aplicaciones que se pueden ejecutar solas) usan '/' para que el router funcione en subrutas
			publicPath = "'/'";
		} else {
			publicPath = "'auto'";
		}

		// Generar configuración de static directories para devServer
		// Incluye la carpeta public/ del módulo y las de sus uiDependencies
		const staticDirs = this.buildStaticDirectories(context);

		const devServerConfig = `
    devServer: {
        host: '0.0.0.0',
        port: ${module.uiConfig.devPort},
        hot: ${hotReload},
        historyApiFallback: true,
        allowedHosts: 'all',
        static: ${staticDirs},
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
            'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
        },
        proxy: [
            {
                context: ['/adc-sw.js', '/adc-i18n.js', '/api/i18n'],
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
        ],
    },`;

		return `
${imports}

export default {
    mode: '${mode}',
    devtool: ${devtool},
    context: '${normalizeForConfig(module.appDir)}',
    entry: {
        main: '${mainEntry}',
    },
    output: {
        path: '${normalizeForConfig(path.join(uiOutputBaseDir, module.uiConfig.name))}',
        publicPath: ${publicPath},
        uniqueName: '${safeName}',
    },
    resolve: {
        extensions: ${extensions},
        extensionAlias: {
            '.js': ['.ts', '.tsx', '.js'],
            '.mjs': ['.mts', '.mjs'],
        },
        alias: ${finalAliasesObject},
    },${
		externals.length > 0
			? `
    externals: ${JSON.stringify(externals)},`
			: ""
	}
    module: {
        rules: [
            ${moduleRules},${this.getAdditionalRules()}
        ],
    },
    experiments: {${this.getExperiments()}
    },
    plugins: [
        new rspack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify('${mode}'),
        }),
        ${plugins}
        new ModuleFederationPlugin({
            name: '${safeName}',
            runtime: false,
            ${federationConfig}
            shared: ${shared},
        }),
    ],${devServerConfig}
    ignoreWarnings: [
        /Critical dependency.*expression/,
    ],
    performance: {
        hints: ${isProduction ? "'warning'" : "false"},
        maxAssetSize: 512000,
        maxEntrypointSize: 512000,
    },
};
`;
	}

	/**
	 * Construye la configuración de shared libraries
	 */
	protected buildSharedConfig(usedFrameworks: Set<string>): string {
		const sharedLibs: string[] = [];

		// Stencil runtime must be shared as singleton to avoid scope mismatch
		// between host and remotes, which causes intermittent "invalid Stencil runtime" errors
		sharedLibs.push("'@stencil/core': { singleton: true, eager: true, strictVersion: false }");

		if (usedFrameworks.has("react")) {
			sharedLibs.push(
				"react: { singleton: true, requiredVersion: '^19.2.6', eager: true, strictVersion: false }",
				"'react-dom': { singleton: true, requiredVersion: '^19.2.6', eager: true, strictVersion: false }",
				"'react/jsx-dev-runtime': { singleton: true, eager: true, strictVersion: false }"
			);
		}

		if (usedFrameworks.has("vue")) {
			sharedLibs.push("vue: { singleton: true, eager: true }");
		}

		return `{
        ${sharedLibs.join(",\n        ")}
    }`;
	}

	/**
	 * Construye la configuración de exposes para Module Federation
	 * Lee de federationExposes en config.json, o usa ./App por defecto
	 */
	protected buildExposesConfig(context: IBuildContext, appExtension: string): string {
		const { module } = context;
		const federationExposes = module.uiConfig.federationExposes;

		// Si hay federationExposes configurados, usarlos
		if (federationExposes && Object.keys(federationExposes).length > 0) {
			const exposesEntries = Object.entries(federationExposes)
				.map(([key, value]) => `                '${key}': '${value}'`)
				.join(",\n");
			return `
            filename: 'remoteEntry.js',
            exposes: {
${exposesEntries}
            },`;
		}

		// Por defecto, exponer solo ./App
		return `
            filename: 'remoteEntry.js',
            exposes: {
                './App': './src/App${appExtension}',
            },`;
	}

	/**
	 * Template para i18n: lee el index.html del módulo e inyecta el script de i18n antes de </head>
	 */
	protected getI18nTemplate(context: IBuildContext): string {
		const indexHtmlPath = normalizeForConfig(path.join(context.module.appDir, "index.html"));
		return String.raw`
            scriptLoading: 'blocking',
            inject: 'body',
            templateContent: () => {
                const html = fs.readFileSync('${indexHtmlPath}', 'utf-8');
                return html.replace('</head>', '    <script src="/adc-i18n.js"></script>\n  </head>');
            },`;
	}

	/**
	 * Genera la configuración de directorios estáticos para devServer.
	 * Incluye:
	 * - /pub/ para la carpeta public/ del propio módulo
	 * - /ui/ para las carpetas public/ de uiDependencies que sean UI libraries (stencil)
	 */
	protected buildStaticDirectories(context: IBuildContext): string {
		const { module, registeredModules } = context;
		const staticConfigs: string[] = [];

		// 1. Carpeta public/ del propio módulo -> / (root, máxima prioridad para overrides como favicon)
		const ownPublicDir = normalizeForConfig(path.join(module.appDir, "public"));
		staticConfigs.push(`{
            directory: '${ownPublicDir}',
            publicPath: '/',
        }`);

		// 2. Common public/ -> / (fallback global para assets compartidos como favicon)
		const commonPublicDir = normalizeForConfig(getCommonPublicDir());
		staticConfigs.push(`{
            directory: '${commonPublicDir}',
            publicPath: '/',
        }`);

		// 3. Carpetas public/ de uiDependencies que sean UI libraries -> /ui/
		const uiDependencies = module.uiConfig.uiDependencies || [];
		for (const depName of uiDependencies) {
			const depModule = registeredModules.get(depName);
			if (depModule?.uiConfig.framework === "stencil") {
				const depPublicDir = normalizeForConfig(path.join(depModule.appDir, "public"));
				staticConfigs.push(`{
            directory: '${depPublicDir}',
            publicPath: '/ui/',
        }`);
			}
		}

		return `[
            ${staticConfigs.join(",\n            ")}
        ]`;
	}

	/**
	 * Returns the experiments config block content.
	 * Override in subclasses to add framework-specific experiment flags.
	 */
	protected getExperiments(): string {
		return `
        css: true,
        lazyCompilation: false,`;
	}

	/**
	 * Returns additional module rules appended after framework-specific rules.
	 * Override in subclasses to modify or exclude rules that cause compatibility issues.
	 */
	protected getAdditionalRules(): string {
		return `
            {
                scheme: 'data',
                mimetype: 'text/javascript',
                type: 'javascript/auto',
            },`;
	}

	/**
	 * Métodos abstractos para configuración específica del framework
	 */
	protected abstract getMainEntry(): string;
	protected abstract getModuleRules(isProduction: boolean, postcssConfigPath: string): string;
	protected abstract getPlugins(context: IBuildContext, isHost: boolean, usedFrameworks: Set<string>): string;
	protected abstract getImports(): string;
}
