import type { ReadonlyModuleRegistry } from "../../../utils/registry/ReadonlyModuleRegistry.ts";
import type { BroadcastInput, NotifyInput } from "../../types/notifications/Notification.js";
import type { INotificationService } from "../../types/notifications/INotificationService.js";
import type { CapabilityToken } from "../../security/Capability.ts";

/** Topología de cola para las notificaciones (debe coincidir con NotificationService). */
export const NOTIFY_SERVICE = "NotificationService";
export const NOTIFY_OPERATION = "notify";
export const NOTIFY_BROADCAST_OPERATION = "broadcast";

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

	// 2. Entrega directa si el servicio está cargado. `hasAnyModule`, no `hasModule`:
	// `hasModule` sin config chequea la uniqueKey default (false para servicios con config).
	try {
		if (registry.hasAnyModule("service", NOTIFY_SERVICE)) {
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

/**
 * Cómo se despachó el anuncio: `queued` (job firmado en cola; fan-out reanudable),
 * `direct` (sin cola, fan-out inmediato; reintetable sin duplicar por `broadcastId`)
 * o `dropped` (NO se anunció: servicio ausente, sin scope o fan-out fallido).
 */
export type BroadcastEmitResult = "queued" | "direct" | "dropped";

/**
 * Despacha un broadcast por su única puerta: `NotificationService.broadcast(cap, input)`
 * — el productor NO publica a la cola; el servicio valida el scope y encola él mismo
 * el job firmado. Devuelve `dropped` sólo si el servicio no está cargado; los errores
 * del servicio se propagan para que `BaseModule.emitBroadcast` los loguee con causa.
 */
export async function emitBroadcast(
	registry: ReadonlyModuleRegistry,
	cap: CapabilityToken,
	input: BroadcastInput
): Promise<BroadcastEmitResult> {
	if (!registry.hasAnyModule("service", NOTIFY_SERVICE)) return "dropped";
	const service = registry.getService<INotificationService>(NOTIFY_SERVICE);
	return await service.broadcast(cap, input);
}
