import "@ui-library/utils/react-jsx";
import PageShell from "../components/PageShell";

export function NotFoundPage() {
	return (
		<PageShell title="Página no encontrada" declaration="informational">
			<p>La página que buscas no existe o fue movida.</p>
			<p>
				Vuelve al <a href="/">centro de ayuda</a> o revisa el <a href="/roadmap">roadmap</a>.
			</p>
		</PageShell>
	);
}
