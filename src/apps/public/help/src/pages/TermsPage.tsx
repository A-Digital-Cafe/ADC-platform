import "@ui-library/utils/react-jsx";
import PageShell from "../components/PageShell";

const AGE_RULES: ReadonlyArray<{ region: string; entries: ReadonlyArray<{ place: string; age: string; note?: string }> }> = [
	{
		region: "Asia",
		entries: [
			{ place: "Corea del Sur", age: "14+" },
			{ place: "Vietnam", age: "15+" },
		],
	},
	{
		region: "Caribe",
		entries: [
			{ place: "Aruba", age: "16+" },
			{ place: "Caribe Neerlandés", age: "16+" },
			{ place: "Curaçao", age: "16+" },
			{ place: "Sint Maarten", age: "16+" },
		],
	},
	{
		region: "Europa",
		entries: [
			{ place: "Austria", age: "14+" },
			{ place: "Bulgaria", age: "14+" },
			{ place: "Croacia", age: "16+" },
			{ place: "Chipre", age: "14+" },
			{ place: "República Checa", age: "15+" },
			{ place: "Francia", age: "15+" },
			{ place: "Alemania", age: "16+" },
			{ place: "Grecia", age: "15+" },
			{ place: "Hungría", age: "16+" },
			{ place: "Irlanda", age: "16+" },
			{ place: "Italia", age: "14+" },
			{ place: "Lituania", age: "14+" },
			{ place: "Luxemburgo", age: "16+" },
			{ place: "Países Bajos", age: "16+" },
			{ place: "Polonia", age: "16+" },
			{ place: "Rumania", age: "16+" },
			{ place: "San Marino", age: "16+" },
			{ place: "Serbia", age: "15+" },
			{ place: "Eslovaquia", age: "16+" },
			{ place: "Eslovenia", age: "16+" },
			{ place: "España", age: "14+" },
		],
	},
	{
		region: "Sudamérica",
		entries: [
			{ place: "Chile", age: "14+" },
			{ place: "Colombia", age: "14+" },
			{ place: "Perú", age: "14+" },
			{ place: "Venezuela", age: "14+", note: "temporalmente bloqueado por geofiltro" },
		],
	},
];

export function TermsPage() {
	return (
		<PageShell
			title="Términos y Condiciones"
			subtitle="Reglas básicas de uso del sitio y la comunidad."
			declaration="policy"
			breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Términos" }]}
		>
			<h2 id="uso-aceptable">1. Uso aceptable</h2>
			<p>
				Al usar el sitio te comprometes a no realizar actividades ilegales, abusivas, fraudulentas o que dañen a otras personas usuarias
				o a la plataforma.
			</p>

			<h2 id="conductas-prohibidas">2. Conductas prohibidas</h2>
			<p>No está permitido usar ADC para:</p>
			<ul>
				<li>acosar, amenazar, doxxear, discriminar o promover discurso de odio;</li>
				<li>publicar malware, spam, phishing, estafas o contenido ilegal;</li>
				<li>suplantar identidades o falsear afiliaciones;</li>
				<li>
					evadir límites de tasa, <a href="/values#geofiltro-activo">geofiltros</a>, medidas antiabuso o controles de seguridad;
				</li>
				<li>extraer datos de forma masiva sin autorización o afectar la disponibilidad del servicio;</li>
				<li>publicar contenido que vulnere derechos de terceros.</li>
			</ul>

			<h2 id="edad-minima">3. Edad mínima</h2>
			<p>
				La edad mínima general para usar la plataforma es <strong>13 años</strong>. En algunos países aplicamos una edad mayor, tomando
				como referencia el criterio público usado por plataformas como Discord. Si tu país no aparece en la lista, aplica la regla
				general de 13+.
			</p>
			<details>
				<summary>Ver edades mínimas por país o región</summary>
				<div className="mt-3 space-y-4">
					{AGE_RULES.map((group) => (
						<section key={group.region}>
							<h3>{group.region}</h3>
							<ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 text-sm">
								{group.entries.map((entry) => (
									<li key={entry.place}>
										<strong>{entry.place}:</strong> {entry.age}
										{entry.note ? ` (${entry.note})` : ""}
									</li>
								))}
							</ul>
						</section>
					))}
				</div>
			</details>

			<h2 id="cuentas">4. Cuentas</h2>
			<p>
				Eres responsable de la actividad de tu cuenta y de mantener tus credenciales seguras. Podemos suspender cuentas que violen estos
				términos o el <a href="/ethics">código de ética</a>.
			</p>

			<h2 id="contenido">5. Contenido</h2>
			<p>
				Conservas los derechos sobre el contenido que publicas. Nos otorgas una licencia limitada para mostrarlo dentro de la plataforma
				con la finalidad para la que lo publicaste, incluyendo copias técnicas necesarias para operar el servicio.
			</p>
			<p>
				<strong>Archivos subidos y compartidos (Drive y adjuntos):</strong> sos responsable del contenido que subís, almacenás o compartís
				(incluido el compartido por enlace público), y declarás contar con los derechos necesarios. No está permitido usar el
				almacenamiento para material ilegal, que infrinja derechos de terceros o que viole las{" "}
				<a href="#conductas-prohibidas">conductas prohibidas</a>. El espacio disponible depende de tu plan o del de tu organización.
				Podemos suspender el acceso a contenido reportado mientras se evalúa una solicitud de retiro: cualquier persona puede reportar
				contenido mediante un ticket de tipo <strong>“Datos”</strong> en{" "}
				<a href="https://status.adigitalcafe.com/status/tickets" rel="noreferrer">
					status.adigitalcafe.com
				</a>{" "}
				(ver <a href="/privacy#contenido-de-usuarios-y-solicitudes-de-terceros">política de privacidad</a>).
			</p>

			<h2 id="enlaces-y-servicios-externos">6. Enlaces y servicios externos</h2>
			<p>
				ADC puede enlazar o integrarse con servicios externos como Discord, Cloudflare, MongoDB Atlas u otros proveedores operativos.
				Esos servicios pueden tener sus propias condiciones y políticas. Cuando un tercero trate datos en nombre de ADC, se documentará
				en la <a href="/privacy#infraestructura-y-subprocesadores">política de privacidad</a> o en el{" "}
				<a href="/roadmap#capa-etica-legal-cimientos">roadmap</a> correspondiente.
			</p>

			<h2 id="subdominios-con-reglas-propias">7. Subdominios con reglas propias</h2>
			<p>
				Algunos subdominios pueden tener condiciones, avisos o políticas adicionales por su función. El subdominio <code>games</code>{" "}
				incorporará publicidad, por lo que tendrá documentación propia sobre proveedores,{" "}
				<a href="/cookies#cookies-opcionales">cookies</a>, identificadores o consentimiento cuando la modalidad técnica esté definida.
			</p>

			<h2 id="disponibilidad">8. Disponibilidad</h2>
			<p>
				La plataforma se ofrece "tal cual". Trabajamos en un programa de SLA/SLO público que se incorporará en futuras fases (ver{" "}
				<a href="/roadmap#capa-de-transparencia-operaciones">Roadmap</a>).
			</p>

			<h2 id="jurisdiccion-y-ley-aplicable">9. Jurisdicción y ley aplicable</h2>
			<p>
				Estos términos se interpretan bajo la ley aplicable de la República Argentina, sin perjuicio de los derechos de protección al
				consumidor o datos personales que puedan corresponder en tu país de residencia.
			</p>

			<h2 id="modificaciones">10. Modificaciones</h2>
			<p>
				Podemos actualizar estos términos. Cambios sustanciales se anunciarán con antelación razonable y la fecha de última actualización
				quedará reflejada al pie.
			</p>
		</PageShell>
	);
}
