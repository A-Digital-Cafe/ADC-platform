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

/** Prefijo de continuación: una línea con este gutter no puede pasar por entrada nueva. */
const CONTINUATION = "\n  │ ";

function sanitizeLogText(text: string): string {
	// eslint-disable-next-line no-control-regex -- los caracteres de control son justamente el objetivo.
	return text.replaceAll(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replaceAll(/\r\n|[\r\n]/g, CONTINUATION);
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
	 *
	 * Por ser el único punto de salida es también donde se sanitiza (ver `sanitizeLogText`): así
	 * ningún productor puede inyectar líneas falsas, sin que cada caller tenga que acordarse.
	 */
	#emit(level: Exclude<LogLevel, "NONE">, module: string, message: string, args: any[]): void {
		if (!this.#shouldLog(level)) return;

		const safeModule = sanitizeLogText(module);
		const safeMessage = sanitizeLogText(message);
		// Sólo los strings sueltos llegan crudos a la consola: dentro de un objeto o un array,
		// `util.inspect` ya escapa los saltos de línea al formatearlos.
		const safeArgs = args.map((arg) => (typeof arg === "string" ? sanitizeLogText(arg) : arg));

		const formatted = this.#format(level, safeModule ? `[${safeModule}] ${safeMessage}` : safeMessage);
		if (level === "ERROR") console.error(formatted, ...safeArgs);
		else if (level === "WARN") console.warn(formatted, ...safeArgs);
		else console.log(formatted, ...safeArgs);

		// Los args string ya vienen sanitizados de `safeArgs`; re-sanitizarlos duplicaría el gutter.
		const serializedArgs = safeArgs.map((arg) => (typeof arg === "string" ? arg : sanitizeLogText(stringify(arg))));
		const serialized = safeArgs.length ? [safeMessage, ...serializedArgs].join(" ") : safeMessage;
		// Recortar ANTES de redactar (ver `MAX_MESSAGE_CHARS`).
		const capped = serialized.length > MAX_MESSAGE_CHARS ? `${serialized.slice(0, MAX_MESSAGE_CHARS)}…` : serialized;
		try {
			logBuffer.push(BufferLevels[level], safeModule || ROOT_MODULE, redact(capped));
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
