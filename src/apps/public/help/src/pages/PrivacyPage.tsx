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
			lastUpdated="2026-07-16"
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
				{"."}
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
				<li>
					<strong>Dispositivos vinculados a Drive</strong> (si usás la sección Dispositivos): nombre que les des, tipo
					(navegador o agente CLI), fecha de última conexión y, para agentes CLI, un token de acceso del que sólo
					almacenamos el hash. Podés renombrarlos o revocarlos cuando quieras.
				</li>
				<li>
					<strong>Credenciales de unidades remotas</strong> (si conectás un S3 o WebDAV propio): se guardan únicamente{" "}
					<em>cifradas</em> — con tu clave de usuario o, si elegís el modo passphrase, cifradas de punta a punta en tu
					dispositivo de forma que ADC no puede leerlas. La plataforma nunca se conecta a esos servicios: la conexión la
					inicia siempre tu dispositivo, y el contenido de esas unidades no se almacena en ADC.
				</li>
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
			<p>
				<strong>Contenido en Drive y adjuntos:</strong> los archivos que eliminás pasan a la papelera, de la que se quitan
				automáticamente a los <strong>30 días</strong>. A partir de ahí entran en un período de retención de hasta <strong>3 meses</strong>{" "}
				en el que ya no son accesibles para vos ni cuentan contra tu cuota, pero un administrador todavía puede restaurarlos ante un borrado
				accidental o un incidente. Cumplido ese plazo —o al borrarse la cuenta— el binario se elimina de forma definitiva del almacenamiento.
				Ese período de gracia tiene, además, una <strong>capacidad limitada</strong>: como no consume tu cuota, conservamos como mucho tanto
				volumen retenido como espacio tenés contratado, y al superarlo se eliminan definitivamente los archivos retenidos más antiguos.
				Es una salvaguarda de capacidad, no una retención más corta: <strong>no acorta los 3 meses de nada que puedas seguir usando</strong>.
			</p>
			<p>
				<strong>Transferencias entre dispositivos (túnel de Drive):</strong> el contenido que movés en vivo entre tus
				dispositivos (carpetas montadas y unidades remotas) <strong>no se almacena</strong> en la plataforma: el servidor sólo
				lo retransmite en tránsito, y cuando la conexión es directa entre navegadores (P2P) ni siquiera pasa por nuestros
				servidores — sólo intercambiamos la señalización para establecerla. De las <strong>carpetas de transferencia</strong>{" "}
				guardamos el archivo (con las reglas normales de Drive) y un registro de qué dispositivos tuyos confirmaron la
				descarga; si activás el <em>autoborrado</em>, el archivo se elimina <strong>definitivamente y sin pasar por la
				papelera</strong> cuando todos tus dispositivos suscritos lo descargaron o al vencer el plazo que configures — es una
				excepción, elegida por vos, a la retención descrita arriba. Los dispositivos vinculados, sus registros de entrega y
				las unidades remotas se eliminan junto con la cuenta.
			</p>
			<p>
				<strong>Cuentas baneadas o eliminadas:</strong> se conservan durante <strong>30 días</strong> desde el evento (ban o solicitud de
				borrado) y luego se eliminan automáticamente. Para evitar la reentrada de cuentas baneadas mantenemos una{" "}
				<em>lista anti-evasión</em> basada en <strong>hashes HMAC-SHA256</strong> del email normalizado y, durante un máximo de{" "}
				<strong>3 horas</strong> tras el último intento de inicio de sesión, del hash de IP. Estos hashes son <em>unidireccionales</em> y
				no almacenamos los emails, las IPs ni ninguna otra PII en estos registros. Para usuarios baneados desde otros sistemas conectados
				(p. ej. Discord modlogs) sólo guardamos un identificador opaco del evento externo para poder revertir el ban si la fuente
				original lo revoca.
			</p>

			<h2 id="seguridad">6. Seguridad</h2>
			<p>
				Aplicamos hashing de contraseñas (PBKDF2), control de sesión basado en tokens, rate limiting, protección CSRF y cabeceras CSP. Los
				archivos de Drive y las credenciales de unidades remotas se cifran en reposo (AES-256-GCM con claves por usuario; en el modo
				passphrase de unidades remotas el cifrado ocurre en tu dispositivo y ADC no puede descifrarlas). La cobertura completa frente a
				OWASP ASVS y el detalle de controles forman parte del <a href="/roadmap#capa-de-blindaje-seguridad">roadmap</a> público.
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

			<h2 id="contenido-de-usuarios-y-solicitudes-de-terceros">11. Contenido subido por usuarios y solicitudes de terceros</h2>
			<p>
				Las apps de la plataforma (Drive, adjuntos de proyectos y artículos, correo) permiten subir y compartir archivos. Ese contenido es{" "}
				<strong>responsabilidad de quien lo sube</strong>: nosotros lo almacenamos por cuenta del usuario y no lo revisamos de forma
				previa. Los archivos eliminados pasan por una papelera y, una vez vencida la retención (ver{" "}
				<a href="/privacy#conservacion">§5 Conservación</a>), se borran definitivamente, incluido el binario en el almacenamiento.
			</p>
			<p>
				Si sos un <strong>tercero</strong> y considerás que un archivo compartido (por ejemplo, mediante un enlace público de Drive) afecta
				tus datos personales o tus derechos, podés solicitar su revisión o retiro creando un ticket de tipo <strong>“Datos”</strong> en la
				sección <em>Tickets de Soporte</em> de{" "}
				<adc-platform-link href="https://status.adigitalcafe.com/status/tickets">status.adigitalcafe.com</adc-platform-link>{" "}
				incluyendo el enlace al contenido y el motivo. Tratamos estas solicitudes en un plazo máximo de <strong>30 días</strong>;
				mientras se evalúan podemos suspender preventivamente el acceso al contenido reportado. Esto también canaliza solicitudes GDPR de
				acceso, rectificación o supresión sobre datos tratados por terceros dentro de la plataforma.
			</p>
		</PageShell>
	);
}
