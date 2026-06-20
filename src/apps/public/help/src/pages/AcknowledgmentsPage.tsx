import "@ui-library/utils/react-jsx";
import { useEffect } from "react";
import { getUrl } from "@common/utils/url-utils.js";
import PageShell from "../components/PageShell";

/**
 * El log de agradecimientos/bug-bounty se unificó en el subdominio de estado
 * (`/status/bounty`), que es el log vivo de transparencia. Esta ruta se mantiene
 * para enlaces externos (security.txt, SECURITY.md) y redirige allí.
 */
export function AcknowledgmentsPage() {
	const bountyUrl = getUrl(3020, "status.adigitalcafe.com", "/status/bounty");

	useEffect(() => {
		globalThis.location?.replace(bountyUrl);
	}, [bountyUrl]);

	return (
		<PageShell
			title="Agradecimientos de seguridad"
			subtitle="Te estamos redirigiendo al log público de transparencia."
			breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Agradecimientos" }]}
		>
			<p>
				Los agradecimientos y el bug bounty viven ahora en el log de transparencia del subdominio de estado. Si no se te redirige
				automáticamente, abrí el{" "}
				<adc-platform-link href={bountyUrl}>log de transparencia</adc-platform-link>.
			</p>
		</PageShell>
	);
}
