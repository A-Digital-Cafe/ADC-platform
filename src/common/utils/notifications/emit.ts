import type { ReadonlyModuleRegistry } from "../../../utils/registry/ReadonlyModuleRegistry.ts";
import type { NotifyInput } from "../../types/notifications/Notification.js";
import type { INotificationService } from "../../types/notifications/INotificationService.js";

/** Topología de cola para las notificaciones (debe coincidir con NotificationService). */
export const NOTIFY_SERVICE = "NotificationService";
export const NOTIFY_OPERATION = "notify";

/** Subconjunto del provider RabbitMQ usado para emitir (evita acoplar `@common` a `@providers`). */
interface BrokerProvider {
	readonly connection: unknown;
	publish(serviceName: string, operationName: string, message: Record<string, unknown>): Promise<void>;
}

/**
 * Emite una notificación de forma **desacoplada y tolerante a fallos**. Pensada
 * para que cualquier productor avise a un usuario sin acoplarse al ciclo de vida
 * del subsistema de notificaciones.
 *
 * Orden de preferencia:
 *  1. **Cola durable RabbitMQ** (`NotificationService/notify`): sobrevive a que el
 *     `NotificationService` esté en mantenimiento — los mensajes se acumulan en la
 *     cola y se entregan cuando el consumidor vuelve (entrega eventual garantizada).
 *  2. **Entrega directa** vía `NotificationService.notify()` si la cola no está
 *     disponible pero el servicio sí (sin durabilidad, pero llega en el momento).
 *  3. Si no hay ni cola ni servicio: best-effort, se descarta y se devuelve `false`.
 *
 * **Nunca lanza**: una app/servicio que emite notificaciones no debe romperse
 * porque el subsistema de notificaciones esté caído.
 *
 * @returns `true` si se encoló o entregó; `false` si se descartó (best-effort).
 */
export async function emitNotification(registry: ReadonlyModuleRegistry, input: NotifyInput): Promise<boolean> {
	// 1. Cola durable (preferida): independiente de que el servicio esté vivo.
	try {
		const broker = registry.getProvider<BrokerProvider>("queue/rabbitmq");
		if (broker?.connection) {
			await broker.publish(NOTIFY_SERVICE, NOTIFY_OPERATION, input as unknown as Record<string, unknown>);
			return true;
		}
	} catch {
		// Sin cola disponible: intentamos entrega directa.
	}

	// 2. Entrega directa si el servicio está cargado.
	try {
		if (registry.hasModule("service", NOTIFY_SERVICE)) {
			const service = registry.getService<INotificationService>(NOTIFY_SERVICE);
			await service.notify(input);
			return true;
		}
	} catch {
		// Servicio no disponible.
	}

	// 3. Ni cola ni servicio: no se pudo emitir (no rompemos al productor).
	return false;
}
