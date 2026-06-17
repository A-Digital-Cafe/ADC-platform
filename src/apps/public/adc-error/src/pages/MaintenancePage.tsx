import { ErrorCard } from "../components/ErrorCard.tsx";
import { readParam } from "../utils/params.ts";

/** Mensajes predefinidos (espejo de MAINTENANCE_MESSAGES en el core). */
const MESSAGES: Record<string, string> = {
	unavailable: "Esta aplicación no está disponible temporalmente.",
	updating:
		"Estamos trabajando en una actualización para esta aplicación. Actualizá este sitio más tarde para continuar en donde estabas.",
	repairs: "Estamos realizando reparaciones en esta aplicación. Volvé a intentarlo en unos minutos.",
};

export function MaintenancePage() {
	const reason = readParam("reason") || "unavailable";
	const appName = readParam("app");
	const message = readParam("message") || MESSAGES[reason] || MESSAGES.unavailable;

	return (
		<ErrorCard
			icon="🛠️"
			title={appName ? `${appName} no disponible temporalmente` : "No disponible temporalmente"}
			subtitle="Estamos trabajando en mejoras"
			description={message}
			hint="Esta página se actualizará cuando la aplicación vuelva a estar disponible."
			tone="warning"
		/>
	);
}
