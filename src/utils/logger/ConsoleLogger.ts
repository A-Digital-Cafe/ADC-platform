import { ILogger } from "../../interfaces/utils/ILogger.js";
import { logBuffer, MAX_MESSAGE_CHARS, type LogLevel as BufferLevel } from "@common/utils/log-buffer.ts";
import { redact } from "@common/utils/redact.ts";

type LogLevel = "DEBUG" | "INFO" | "OK" | "WARN" | "ERROR" | "NONE";

const LogLevelValues: Record<LogLevel, number> = {
	DEBUG: 0,
	INFO: 1,
	OK: 2,
	WARN: 3,
	ERROR: 4,
	NONE: 5,
};

const BufferLevels: Record<Exclude<LogLevel, "NONE">, BufferLevel> = { DEBUG: "debug", INFO: "info", OK: "ok", WARN: "warn", ERROR: "error" };

/** Módulo con el que se indexan los logs emitidos sin `createLogger(title)`. */
const ROOT_MODULE = "System";

/** Serializa un argumento variádico de `console.*` a texto plano para el buffer. */
function stringify(value: unknown): string {
	if (typeof value === "string") return value;
	if (value instanceof Error) return `${value.name}: ${value.message}`;
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value); // referencias circulares
	}
}

/**
 * Códigos ANSI para colores en la consola
 */
const Colors = {
	Reset: "\x1b[0m",
	Debug: "\x1b[36m", // Cyan
	Info: "\x1b[34m", // Blue
	Ok: "\x1b[32m", // Green
	Warn: "\x1b[33m", // Yellow
	Error: "\x1b[31m", // Red
	Dim: "\x1b[2m", // Dim
};

/**
 * Implementación de logger en consola con soporte para colores y niveles
 */
export default class ConsoleLogger implements ILogger {
	constructor(private currentLevel: LogLevel = "DEBUG") {}

	public createLogger(title: string): ILogger {
		return {
			logDebug: (message: string, ...args: any[]) => this.#emit("DEBUG", title, message, args),
			logInfo: (message: string, ...args: any[]) => this.#emit("INFO", title, message, args),
			logOk: (message: string, ...args: any[]) => this.#emit("OK", title, message, args),
			logWarn: (message: string, ...args: any[]) => this.#emit("WARN", title, message, args),
			logError: (message: string, ...args: any[]) => this.#emit("ERROR", title, message, args),
			setLevel: (level: LogLevel) => this.setLevel(level),
			createLogger: (newTitle: string): ILogger => this.createLogger(`${title}:${newTitle}`),
		};
	}

	public setLevel(level: LogLevel): void {
		this.currentLevel = level;
	}

	#shouldLog(level: LogLevel): boolean {
		return LogLevelValues[level] >= LogLevelValues[this.currentLevel];
	}

	#format(level: LogLevel, message: string): string {
		const levelLabel = level.padEnd(5);
		const timestamp = new Date().toLocaleTimeString("es-ES");

		switch (level) {
			case "DEBUG":
				return `${Colors.Dim}${timestamp}${Colors.Reset} ${Colors.Debug}[${levelLabel}]${Colors.Reset} ${message}`;
			case "INFO":
				return `${timestamp} ${Colors.Info}[${levelLabel}]${Colors.Reset} ${message}`;
			case "OK":
				return `${timestamp} ${Colors.Ok}[${levelLabel}]${Colors.Reset} ${message}`;
			case "WARN":
				return `${timestamp} ${Colors.Warn}[${levelLabel}]${Colors.Reset} ${message}`;
			case "ERROR":
				return `${timestamp} ${Colors.Error}[${levelLabel}]${Colors.Reset} ${message}`;
			default:
				return message;
		}
	}

	/**
	 * Único punto de salida del logger: consola (`[title] msg`) y ring buffer en memoria, donde el
	 * módulo va aparte del mensaje para poder filtrar. La redacción se aplica sólo al buffer, que
	 * se consulta por HTTP (la consola es efímera y local).
	 */
	#emit(level: Exclude<LogLevel, "NONE">, module: string, message: string, args: any[]): void {
		if (!this.#shouldLog(level)) return;

		const formatted = this.#format(level, module ? `[${module}] ${message}` : message);
		if (level === "ERROR") console.error(formatted, ...args);
		else if (level === "WARN") console.warn(formatted, ...args);
		else console.log(formatted, ...args);

		const serialized = args.length ? [message, ...args.map(stringify)].join(" ") : message;
		// Recortar ANTES de redactar (ver `MAX_MESSAGE_CHARS`).
		const capped = serialized.length > MAX_MESSAGE_CHARS ? `${serialized.slice(0, MAX_MESSAGE_CHARS)}…` : serialized;
		try {
			logBuffer.push(BufferLevels[level], module || ROOT_MODULE, redact(capped));
		} catch {
			// El buffer es un extra de diagnóstico: nunca puede hacer fallar a quien loguea.
		}
	}

	public logDebug(message: string, ...args: any[]): void {
		this.#emit("DEBUG", "", message, args);
	}

	public logInfo(message: string, ...args: any[]): void {
		this.#emit("INFO", "", message, args);
	}

	public logOk(message: string, ...args: any[]): void {
		this.#emit("OK", "", message, args);
	}

	public logWarn(message: string, ...args: any[]): void {
		this.#emit("WARN", "", message, args);
	}

	public logError(message: string, ...args: any[]): void {
		this.#emit("ERROR", "", message, args);
	}
}
