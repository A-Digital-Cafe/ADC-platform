import "@ui-library/utils/react-jsx";
import PageShell from "../components/PageShell";
import { CONTACTS } from "../data/contact";

export function CookiesPage() {
	return (
		<PageShell
			title="Política de Cookies"
			subtitle="Qué cookies usamos y para qué."
			standards={["GDPR / ePrivacy (compromiso)"]}
			declaration="commitment"
			breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Cookies" }]}
		>
			<h2 id="cookies-necesarias">1. Cookies necesarias</h2>
			<p>
				Son imprescindibles para iniciar sesión, mantener tu sesión, prevenir CSRF y garantizar la seguridad básica del sitio. La
				relación con datos de sesión y seguridad se explica en <a href="/privacy#que-datos-tratamos">privacidad</a>. Sin ellas, partes
				esenciales no funcionarían.
			</p>

			<h2 id="cookies-de-preferencia">2. Cookies de preferencia</h2>
			<p>Recordamos preferencias como tema visual (claro/oscuro) o idioma. Puedes cambiarlas directamente en la interfaz.</p>

			<h2 id="analitica">3. Analítica</h2>
			<p>
				Usamos <strong>Cloudflare Web Analytics</strong>, que mide tráfico de forma agregada <strong>sin instalar cookies</strong> en tu
				navegador y sin tracking publicitario. La métrica se basa en señales del proxy de Cloudflare, descrito también en{" "}
				<a href="/privacy#infraestructura-y-subprocesadores">infraestructura y subprocesadores</a>.
			</p>

			<h2 id="cookies-opcionales">4. Cookies opcionales</h2>
			<p>
				En la fase actual del sitio principal no se incorporan cookies analíticas, de marketing ni de terceros que requieran
				consentimiento. El subdominio <code>games</code> incorporará publicidad; si esa publicidad usa cookies, identificadores o
				proveedores de medición, se publicará un aviso específico y se solicitará consentimiento cuando corresponda antes de activarlos.
				La regla de subdominios con avisos propios está en los <a href="/terms#subdominios-con-reglas-propias">términos</a> y el trabajo
				pendiente se sigue en el <a href="/roadmap#capa-de-transparencia-operaciones">roadmap</a>.
			</p>

			<h2 id="gestion">5. Gestión</h2>
			<p>
				Puedes borrar las cookies desde tu navegador en cualquier momento. Para dudas, contáctanos desde los{" "}
				<a href="/contact#canales">canales publicados</a>: <a href={`mailto:${CONTACTS.email}`}>{CONTACTS.email}</a> o vía Discord{" ("}
				<a href={CONTACTS.discordUrl} rel="noreferrer">
					{CONTACTS.discordHandle}
				</a>
				{")."}
			</p>
		</PageShell>
	);
}
