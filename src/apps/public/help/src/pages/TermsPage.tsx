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
			lastUpdated="2026-07-16"
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
				<adc-platform-link href="https://status.adigitalcafe.com/status/tickets">status.adigitalcafe.com</adc-platform-link>{" "}
				(ver <a href="/privacy#contenido-de-usuarios-y-solicitudes-de-terceros">política de privacidad</a>).
			</p>
			<p>
				<strong>Transferencias entre dispositivos y unidades remotas:</strong> el mismo régimen de responsabilidad aplica al contenido que
				transfieras en vivo entre tus dispositivos con el túnel de Drive (que la plataforma retransmite sin almacenar) y al de las unidades
				remotas (S3/WebDAV) que conectes, que vive en tu proveedor y no en ADC. Sos responsable de las credenciales de esos servicios, de
				contar con autorización para usarlos y de cumplir sus propias condiciones; si elegís protegerlas con passphrase, su custodia es
				exclusivamente tuya y ADC no puede recuperarlas.
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
			<p id="degradacion-de-planes">
				<strong>Degradación de límites ante una incidencia.</strong> Los límites de tu plan los resuelve un servicio interno de planes.
				Si ese servicio no está disponible, las aplicaciones <strong>no se caen</strong>: siguen funcionando aplicando los límites del{" "}
				<strong>plan base</strong> (el gratuito) hasta que se restablezca. Es una decisión deliberada de seguridad — preferimos quedar
				cortos antes que liberar recursos sin control —, por lo que durante ese lapso una cuenta con plan pago puede ver límites
				menores a los contratados de forma temporal. No implica pérdida del plan ni de datos: al restablecerse el servicio, los límites
				vuelven solos. Estas incidencias se publican en la <a href="https://status.adigitalcafe.com">página de estado</a>.
			</p>

			<h2 id="planes-y-beneficios">9. Planes, beneficios y su revisión</h2>
			<p>
				Los planes pagos incluyen límites concretos (almacenamiento, <strong>volumen de descarga mensual</strong>, envíos de correo,
				proyectos, etc.) que se publican en la página de planes, agrupados por la aplicación a la que pertenecen. Los precios se expresan
				en dólares estadounidenses; el importe efectivamente cobrado se convierte a la moneda del medio de pago al momento de cada cobro.
			</p>
			<p id="volumen-de-descarga">
				<strong>Volumen de descarga.</strong> Los archivos cifrados se descifran en nuestros servidores para servírtelos, así que la
				descarga consume recursos propios y tiene un cupo mensual publicado en cada plan. Al agotarlo dejan de autorizarse descargas
				nuevas hasta el mes siguiente: <strong>no se borra ni se bloquea nada</strong>, tus archivos siguen ahí y podés seguir subiendo,
				compartiendo y trabajando. El cupo se mide al autorizar cada descarga, por el tamaño del archivo.
			</p>
			<p id="minimo-de-asientos">
				<strong>Mínimo de asientos en los planes de equipo.</strong> El plan de equipo tiene un mínimo de asientos contratados, y sus
				límites son un pool compartido dimensionado para ese grupo. Si la cantidad de asientos pagos baja del mínimo, la organización
				deja de reunir las condiciones del plan y pasa al plan gratuito de organización en la siguiente renovación, con los límites que
				correspondan. Es la contracara del precio por asiento reducido: se sostiene porque el grupo se sostiene. Avisamos antes de que
				ocurra y no se pierde ningún dato por este motivo.
			</p>
			<p id="reevaluacion-anual">
				<strong>Reevaluación financiera anual.</strong> Una vez al año publicamos un informe con los costos reales de infraestructura y
				el margen de cada plan. Sirve para que cualquier ajuste de beneficios esté justificado con números y no sea una sorpresa: si el
				costo de almacenamiento o de tráfico se dispara, ahí se va a ver. <strong>Todo cambio que reduzca los beneficios de un plan
				vigente se anuncia con al menos un mes de anticipación</strong>, y durante ese plazo podés dar de baja sin cargo y sin
				penalidad. Los cambios que <em>amplían</em> beneficios pueden aplicarse de inmediato.
			</p>
			<p id="ampliacion-de-organizacion">
				<strong>Ampliaciones del plan de organización.</strong> El plan de equipo admite solicitar una ampliación de sus límites
				compartidos. Se pide por ticket, indicando qué es la organización y a qué compromisos adhiere. La otorgamos a nuestro criterio
				según esos antecedentes y la capacidad disponible, y <strong>podemos revocarla si detectamos un uso que perjudique al resto de
				las personas usuarias</strong> (por ejemplo, envío masivo no solicitado o reventa del servicio). La ampliación no cambia el
				precio, no agrega asientos y su revocación no afecta la suscripción ni los datos: sólo devuelve los límites a los del plan
				contratado. Si te la revocamos, te explicamos el motivo y podés pedir una revisión por el mismo canal.
			</p>
			<p id="planes-a-medida">
				<strong>Planes a medida.</strong> A partir de cierto tamaño, los límites se acuerdan caso por caso por escrito y se revisan cada
				tres meses. Ninguna revisión reduce lo acordado durante el período en curso.
			</p>

			<h2 id="jurisdiccion-y-ley-aplicable">10. Jurisdicción y ley aplicable</h2>
			<p>
				Estos términos se interpretan bajo la ley aplicable de la República Argentina, sin perjuicio de los derechos de protección al
				consumidor o datos personales que puedan corresponder en tu país de residencia.
			</p>

			<h2 id="modificaciones">11. Modificaciones</h2>
			<p>
				Podemos actualizar estos términos. Cambios sustanciales se anunciarán con antelación razonable y la fecha de última actualización
				quedará reflejada al pie.
			</p>
		</PageShell>
	);
}
