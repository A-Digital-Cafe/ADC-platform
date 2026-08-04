export interface ADCCustomErrorJSON<T = Record<string, unknown>, M extends string = string> {
	name: string;
	status: number;
	errorKey: M;
	message: string;
	data?: T;
}

/**
 * Base abstract class for all ADC Platform errors
 * All custom error types should extend this class
 */
export default abstract class ADCCustomError<T = Record<string, unknown>, M extends string = string> extends Error {
	public abstract readonly name: string;
	public readonly status: number;
	public readonly errorKey: M;
	public readonly data?: T;

	constructor(status: number, errorKey: M, message: string, data?: T) {
		super(message);
		this.status = status;
		this.errorKey = errorKey;
		this.data = data;
		if ((Error as ErrorConstructor & { captureStackTrace?: (err: Error, constructor: unknown) => void }).captureStackTrace) {
			(Error as ErrorConstructor & { captureStackTrace: (err: Error, constructor: unknown) => void }).captureStackTrace(
				this,
				this.constructor
			);
		}
	}

	toJSON(): ADCCustomErrorJSON<T, M> {
		return {
			name: this.name,
			status: this.status,
			errorKey: this.errorKey,
			message: this.message,
			data: this.data,
		};
	}
}

export class HttpError extends ADCCustomError<Record<string, unknown>, string> {
	public readonly name = "HttpError";
}

/**
 * ¿El error es culpa del pedido y no de la dependencia? Un 4xx tipado (slug duplicado,
 * recurso inexistente, permisos) da el mismo resultado por más veces que se reintente, así
 * que reintentarlo sólo gasta turnos y —peor— ensucia la salud del servicio con fallos que
 * no son suyos. Se excluyen 408 y 429, que sí dependen del momento.
 *
 * Lo usan el consumer de RabbitMQ (para no reintentar) y el circuit breaker (para no contar).
 */
export function isPermanentClientError(error: unknown): boolean {
	if (!(error instanceof ADCCustomError)) return false;
	return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}
