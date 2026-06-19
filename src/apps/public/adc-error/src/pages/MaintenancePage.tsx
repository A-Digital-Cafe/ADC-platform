import { useEffect } from "react";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { readParam } from "../utils/params.ts";
import { returnToAppIfAvailable } from "@common/utils/module-availability.js";

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

	// Al cargar (incluido F5): si la app volvió a estar disponible, devolver al usuario
	// a la URL original desde la que se lo redirigió a mantenimiento.
	useEffect(() => {
		const from = new URLSearchParams(globalThis.location?.search || "").get("from");
		void returnToAppIfAvailable(appName, from);
	}, [appName]);

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
