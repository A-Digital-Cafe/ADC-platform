import "@ui-library/utils/react-jsx";
import PageShell from "../components/PageShell";
import { CONTACTS } from "../data/contact";

export function PrivacyPage() {
	return (
		<PageShell
			title="Política de Privacidad"
			subtitle="Datos personales, infraestructura y subprocesadores."
			standards={["GDPR (compromiso)"]}
			declaration="commitment"
			breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Privacidad" }]}
		>
			<h2 id="responsable">1. Responsable</h2>
			<p>
				El sitio es operado por Abby's Digital Cafe (ADC). Para consultas sobre privacidad o ejercicio de derechos puedes escribir a{" "}
				<strong>
					<a href={`mailto:${CONTACTS.email}`}>{CONTACTS.email}</a>
				</strong>{" "}
				o contactar a <strong>{CONTACTS.discordHandle}</strong> en{" "}
				<a href={CONTACTS.discordUrl} rel="noreferrer">
					Discord
				</a>
				.
			</p>

			<h2 id="que-datos-tratamos">2. Qué datos tratamos</h2>
			<ul>
				<li>Datos de cuenta (identificador, email si aplica, credenciales hasheadas).</li>
				<li>
					Dirección IP, asociada a:
					<ul className="list-disc list-inside">
						<li>tokens de inicio de sesión activos,</li>
						<li>registro de intentos de login (incluidos los fallidos),</li>
						<li>aplicación de límites de tasa (rate limiting) en Redis.</li>
					</ul>
				</li>
				<li>Metadatos técnicos mínimos necesarios para autenticación, sesión y seguridad.</li>
				<li>Contenido que decides publicar (artículos, comentarios, archivos adjuntos).</li>
			</ul>

			<h2 id="finalidades">3. Para qué usamos esos datos (base legal y finalidad)</h2>
			<ul>
				<li>Ejecución del servicio que solicitas: registro, sesión, contenido propio.</li>
				<li>Interés legítimo en seguridad: detección de abuso, rate limits, bloqueo de fuerza bruta, integridad de la plataforma.</li>
				<li>
					Consentimiento explícito para usos opcionales (<a href="/cookies#cookies-opcionales">cookies no esenciales</a>,
					comunicaciones).
				</li>
			</ul>

			<adc-callout tone="info" role="note">
				No utilizamos los datos personales del sitio principal para tracking publicitario, ni los vendemos o alquilamos a terceros, ni
				hacemos perfilado para terceros. El subdominio <code>games</code> incorporará publicidad y no queda cubierto por esta afirmación
				sobre el sitio principal; sus <a href="/cookies#cookies-opcionales">proveedores, cookies o identificadores</a> se documentarán
				por separado antes de activarlos.
			</adc-callout>

			<h2 id="tus-derechos">4. Tus derechos</h2>
			<p>
				Puedes ejercer derechos de acceso, rectificación, supresión, limitación, oposición y portabilidad escribiendo a los canales
				indicados. Respondemos en plazo razonable y, si estimas que algo no se respeta, puedes acudir a tu autoridad local de protección
				de datos.
			</p>

			<h2 id="conservacion">5. Conservación</h2>
			<p>
				Conservamos cada dato sólo el tiempo necesario para la finalidad para la que fue recogido. Los plazos concretos por categoría
				(logs de acceso, eventos de seguridad, datos de sesión) están en proceso de formalización; ver{" "}
				<a href="/roadmap#capa-etica-legal-cimientos">roadmap</a>.
			</p>

			<h2 id="seguridad">6. Seguridad</h2>
			<p>
				Aplicamos hashing de contraseñas (PBKDF2), control de sesión basado en tokens, rate limiting, protección CSRF y cabeceras CSP. La
				cobertura completa frente a OWASP ASVS y el detalle de controles forman parte del{" "}
				<a href="/roadmap#capa-de-blindaje-seguridad">roadmap</a> público.
			</p>

			<h2 id="infraestructura-y-subprocesadores">7. Infraestructura y subprocesadores</h2>
			<p>Para operar el sitio recurrimos a los siguientes proveedores que pueden tratar datos personales en nuestro nombre:</p>
			<ul>
				<li>
					<strong>Cloudflare</strong> — CDN y proxy inverso, WAF y reglas de seguridad, protección DDoS, geofiltro por país y{" "}
					<em>Web Analytics</em> sin cookies (medición agregada y respetuosa de la privacidad). Cloudflare puede procesar IPs y
					metadatos de la conexión con fines de seguridad y operación de la red.
				</li>
				<li>
					<strong>MongoDB Atlas</strong> — base de datos gestionada donde se persisten datos de la plataforma. Su uso es{" "}
					<strong>temporal</strong> mientras se evalúan opciones de hosting con menor superficie de transferencias internacionales.
				</li>
			</ul>

			<h2 id="transferencias-internacionales">8. Transferencias internacionales</h2>
			<p>
				Al utilizar Cloudflare y MongoDB Atlas, ciertos datos pueden procesarse fuera de tu país bajo las cláusulas y garantías del
				proveedor correspondiente. Trabajamos en publicar la lista detallada de subprocesadores con sus jurisdicciones y bases de
				transferencia (ver <a href="/roadmap#capa-etica-legal-cimientos">roadmap</a>).
			</p>

			<h2 id="geofiltro-por-pais">9. Geofiltro por país</h2>
			<p>
				Aplicamos un filtro a nivel Cloudflare que <strong>bloquea el acceso desde ciertos países</strong> y aplica un{" "}
				<em>Managed Challenge</em> a bots o dispositivos desconocidos. La motivación, el alcance y la lista actual están descritos en{" "}
				<a href="/values#geofiltro-activo">Valores y Espacio Seguro</a>.
			</p>

			<h2 id="incidentes">10. Incidentes</h2>
			<p>
				Trabajamos en formalizar un proceso interno de respuesta a incidentes que afecten datos personales. Hasta entonces, si detectas o
				sufres un incidente, repórtalo por los canales de <a href="/contact#canales">contacto</a>.
			</p>
		</PageShell>
	);
}
