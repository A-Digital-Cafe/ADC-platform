# Política de Seguridad · Security Policy

> 🇪🇸 Español primero · 🇬🇧 English below ([jump to English](#-english))

Si encontrás una vulnerabilidad, **no abras un issue público** ni la divulgues
hasta que esté resuelta (_coordinated disclosure_).

> Esta política cubre las vulnerabilidades **entrantes**. Si además hay indicio de que datos
> personales se expusieron, perdieron o alteraron, se abre en paralelo el procedimiento de
> **incidentes de datos personales** (notificación a la AAIP en 72 h y aviso a las personas
> afectadas cuando el riesgo es alto), descrito en
> [`docs/guides/breach-response.md`](../docs/guides/breach-response.md) y publicado en
> [`/privacy` §11](https://adigitalcafe.com/privacy#incidentes). Una vulnerabilidad reportada y no
> explotada no es una brecha; una que sí se explotó, sí.

## Versiones soportadas

| Versión | Soporte         |
| ------- | --------------- |
| `main`  | ✅ soporte activo |

## Cómo reportar

Tenés dos canales equivalentes:

1. **Ticket de seguridad (preferido)** — abrí un ticket de tipo **Seguridad** en
   el subdominio de estado: <https://status.adigitalcafe.com/status/tickets>.
   Es el canal que activa nuestro flujo de **triage, SLA y bug bounty** y el
   **log público de transparencia** (ver más abajo).
2. **Email** — <gpsmurfs@gmail.com>. También podés usar la
   [página de contacto](https://adigitalcafe.com/contact).

Incluí en tu reporte:

- Descripción técnica del problema.
- Alcance y pasos de reproducción.
- Impacto estimado y CVSS (si tenés).
- Propuesta o idea de fix (opcional).

Metadatos para máquinas: [`/.well-known/security.txt`](https://adigitalcafe.com/.well-known/security.txt) (RFC 9116).

## Tiempos de respuesta (SLA)

- Acuse de recibo dentro de **7 días hábiles**.
- ETA inicial dentro de **30 días hábiles**.

Durante la investigación pedimos mantener la confidencialidad.

## Severidad y proceso de remediación

Clasificamos por severidad (alineada a CVSS):

| Severidad | Ejemplos                                                                                   |
| --------- | ------------------------------------------------------------------------------------------ |
| Low       | Títulos, formato del sitio, lógicas simples.                                                |
| Medium    | Lógica de negocio que afecta a varios usuarios.                                             |
| High      | Lógica de negocio que afecta a muchos usuarios o CVEs conocidos en librerías de la plataforma. |
| Critical  | Errores de seguridad críticos.                                                             |

Proceso: (1) reproducción y clasificación → (2) fix + tests → (3) versión
parche → (4) aviso público con agradecimiento (si elegiste crédito).

## Bug Bounty Program

Recompensamos reportes válidos con **upgrades temporales de tier** (beneficios
gratuitos en la plataforma). Los valores son **mínimos garantizados**; el admin
puede ampliarlos o acordar otros beneficios desde el propio ticket según los
recursos disponibles, considerando tu preferencia (`plus` vs `pro`).

| Severidad        | Recompensa mínima                 |
| ---------------- | --------------------------------- |
| Low              | 1-10 días **plus**                |
| Medium / High    | 1 mes **plus** · ó 1-10 días **pro** |
| Critical         | 3 meses **plus** · ó 1 mes **pro**   |

Para recibir la recompensa necesitás una cuenta (el beneficio se aplica a tu
usuario). El otorgamiento lo confirma un admin/Security Manager al resolver.

### Vigencia y reglas del programa

- El programa es **voluntario**. Podemos modificarlo o discontinuarlo con aviso
  publicado en esta página; **los cambios no afectan reportes ya recibidos**, que
  se resuelven con las reglas vigentes al momento de recibirlos. Lo decimos
  expresamente porque una promesa pública de recompensa formulada sin plazo no
  puede quedar abierta para siempre, y preferimos fijar cómo termina antes que
  discutirlo después.
- La **severidad la determina ADC** y es **revisable a tu pedido**: si no estás de
  acuerdo con la clasificación, pedilo por el mismo ticket y la mira una persona
  con tus argumentos a la vista.
- **En duplicados se reconoce al primero.** Ver abajo.

### Duplicados

Si tu reporte describe algo que ya nos habían reportado, la recompensa es del
**primero** que lo reportó — pero eso no convierte tu hallazgo en inválido, y no
lo tratamos como si lo fuera.

El ticket se cierra como **`Duplicado`**, un estado propio y distinto de
`Descartado`, y el log público muestra **«Duplicado de STATUS-nn»** con la clave
del reporte original. La diferencia importa: `Descartado` es donde van los
reportes inválidos, sin impacto demostrable o de mala fe, y ese log lo lee
cualquiera. Que alguien haya acertado y llegado segundo no debería quedar
registrado igual que si hubiera reportado cualquier cosa.

Si el reporte original todavía no estaba resuelto cuando llegó el tuyo y aportás
información que cambia el alcance o la severidad, decilo en el ticket: eso puede
justificar una recompensa propia aunque el hallazgo base sea el mismo.

### Transparencia

Cada ticket de seguridad entra en un **log público** (subdominio `status`) con:
`id de ticket`, `fecha/hora`, **hash SHA-256 de la descripción**, `estado` y
`severidad`. Eso es todo lo que se publica al recibirlo.

**La descripción del reporte no se publica nunca por defecto.** Se publica sólo si
se cumplen las dos condiciones: (1) el ticket está **resuelto** (vulnerabilidad
parcheada) y (2) vos **consentiste la divulgación** del reporte. Recién ahí
cualquiera puede recomputar el SHA-256 y verificar que coincide con el hash
publicado al recibirse (prueba de no-manipulación).

Son **dos consentimientos distintos** y podés dar uno sin el otro:

- **Divulgación del reporte** — publicar la descripción (una vez resuelto).
- **Crédito público** — que aparezca tu handle en
  <https://status.adigitalcafe.com/status/bounty>. Requiere que además hayas
  consentido la divulgación.

Si borrás tu cuenta, el consentimiento de crédito no sobrevive: tu handle se
elimina del ticket.

## Safe Harbor (puerto seguro)

No iniciaremos acciones legales ni denuncias por investigación de seguridad de
**buena fe** que respete esta política. Para mantenerte dentro del puerto seguro:

- Probá solo contra cuentas propias; no accedas, modifiques ni exfiltres datos
  de terceros.
- No realices ataques de denegación de servicio (DoS/DDoS) ni degradación.
- No uses ingeniería social, phishing ni acceso físico.
- Limitá el impacto: detenete al confirmar la vulnerabilidad y reportá.
- Respetá la confidencialidad hasta que publiquemos el fix.

**Consideramos esta política una autorización expresa del titular del sistema a
los fines del art. 153 bis del Código Penal argentino**, mientras te mantengas
dentro de su alcance. Ese artículo castiga el acceso indebido a un sistema
informático: con esta autorización, el acceso que hagas investigando de buena
fe según estas reglas no es indebido.

Esa autorización **no se extiende a la infraestructura de terceros** —Cloudflare,
MongoDB Atlas, las pasarelas de pago, los proveedores de identidad—. Tienen sus
propias políticas de divulgación y no podemos autorizarte en su nombre: si tu
investigación toca uno de ellos, va por su programa, no por el nuestro.

## Alcance (scope)

**Dentro:** `adigitalcafe.com` y sus subdominios, las apps de la plataforma y los
presets de este monorepo.
**Quedan Fuera:** servicios de terceros, DoS/volumétricos, datos de terceros, ingeniería
social, reportes automáticos de escáneres sin impacto demostrable, y
vulnerabilidades ya conocidas o ya reportadas (que igual se reconocen como
válidas — ver [Duplicados](#duplicados)).

---

## 🇬🇧 English

If you find a vulnerability, **do not open a public issue** and do not disclose
it until it is fixed (coordinated disclosure).

**Supported versions:** `main` (active support).

**How to report** — two equivalent channels:

1. **Security ticket (preferred)** — open a **Security** ticket at
   <https://status.adigitalcafe.com/status/tickets>. This triggers our triage,
   SLA, bug bounty and the public transparency log.
2. **Email** — <gpsmurfs@gmail.com> or the
   [contact page](https://adigitalcafe.com/contact).

Machine-readable metadata: [`/.well-known/security.txt`](https://adigitalcafe.com/.well-known/security.txt).

**SLA:** acknowledgment within **7 business days**, initial ETA within
**30 business days**.

**Bug Bounty** — valid reports are rewarded with **temporary tier upgrades**
(free platform benefits). Listed values are **guaranteed minimums**; an admin may
increase them or agree on other benefits from the ticket, considering your
`plus`/`pro` preference and available resources:

| Severity      | Minimum reward                  |
| ------------- | ------------------------------- |
| Low           | 1-10 days **plus**              |
| Medium / High | 1 month **plus** · or 1-10 days **pro** |
| Critical      | 3 months **plus** · or 1 month **pro**  |

**Programme terms** — the programme is voluntary and may be modified or
discontinued with notice published on this page; **changes do not affect reports
already received**, which are resolved under the rules in force when they came
in. Severity is determined by ADC and is **reviewable on request** from the same
ticket. In duplicates, the first reporter is the one rewarded.

**Duplicates** — if your report describes something already reported to us, the
reward goes to whoever reported it first — but that does not make your finding
invalid, and we do not treat it as if it did. The ticket is closed as
**`Duplicate`**, a status of its own and distinct from `Discarded`, and the
public log shows **"Duplicate of STATUS-nn"** with the original report's key.
`Discarded` is where invalid, no-impact or bad-faith reports go, and that log is
public: being right but second should not look the same as reporting noise. If
the original was still unresolved when yours arrived and you add information that
changes the scope or severity, say so in the ticket — that can justify a reward
of its own.

**Transparency** — every security ticket enters a public log (`status`
subdomain) with: ticket id, date/time, **SHA-256 hash of the description**,
status and severity. That is all that is published at intake. The report's
description is **never published by default**: it is disclosed only once the
ticket is **resolved** (issue patched) **and** you opted in to disclosure — then
anyone can recompute the SHA-256 and verify it matches the hash recorded at
intake. Disclosure and **public credit** are two separate opt-ins: credited
reporters appear at <https://status.adigitalcafe.com/status/bounty>, and credit
requires disclosure too. If you delete your account, the credit consent does not
survive: your handle is removed from the ticket.

**Safe Harbor** — we will not pursue legal action for good-faith security
research that follows this policy: test only your own accounts; no access to
third-party data; no DoS/DDoS; no social engineering/phishing/physical access;
minimize impact and stop once confirmed; keep it confidential until the fix
ships. **We consider this policy an express authorisation by the system owner
for the purposes of art. 153 bis of the Argentine Criminal Code** (unauthorised
access to a computer system), as long as you stay within its scope. That
authorisation **does not extend to third-party infrastructure** — Cloudflare,
MongoDB Atlas, payment gateways, identity providers: they run their own
disclosure programmes and we cannot authorise you on their behalf.

**Scope** — In: `adigitalcafe.com` and subdomains, platform apps, and this
monorepo's presets. Out of scope: third-party services, DoS/volumetric tests,
third-party data, social engineering, no-impact scanner output, and issues
already known or already reported (still acknowledged as valid — see
Duplicates above).

Gracias por ayudar a mantener seguro el ecosistema de **ADC Platform** ·
Thanks for helping keep the **ADC Platform** ecosystem safe.
