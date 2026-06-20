# Política de Seguridad · Security Policy

> 🇪🇸 Español primero · 🇬🇧 English below ([jump to English](#-english))

Si encontrás una vulnerabilidad, **no abras un issue público** ni la divulgues
hasta que esté resuelta (_coordinated disclosure_).

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

### Transparencia

Cada ticket de seguridad entra en un **log público** (subdominio `status`) con:
`id de ticket`, `fecha/hora`, **hash SHA-256 de la descripción** y `estado`.
Al resolverse, **si aceptaste agradecimiento público**, se publica la descripción
original — y cualquiera puede recomputar el SHA-256 y verificar que coincide con
el hash publicado al recibirse (prueba de no-manipulación). Los reporteros que
optan por crédito aparecen en <https://status.adigitalcafe.com/status/bounty>.

## Safe Harbor (puerto seguro)

No iniciaremos acciones legales ni denuncias por investigación de seguridad de
**buena fe** que respete esta política. Para mantenerte dentro del puerto seguro:

- Probá solo contra cuentas propias; no accedas, modifiques ni exfiltres datos
  de terceros.
- No realices ataques de denegación de servicio (DoS/DDoS) ni degradación.
- No uses ingeniería social, phishing ni acceso físico.
- Limitá el impacto: detenete al confirmar la vulnerabilidad y reportá.
- Respetá la confidencialidad hasta que publiquemos el fix.

## Alcance (scope)

**Dentro:** `adigitalcafe.com` y sus subdominios, las apps de la plataforma y los
presets de este monorepo.
**Fuera:** servicios de terceros, DoS/volumétricos, datos de terceros, ingeniería
social, reportes automáticos de escáneres sin impacto demostrable, y
vulnerabilidades ya conocidas/reportadas.

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

**Transparency** — every security ticket enters a public log (`status`
subdomain) with: ticket id, date/time, **SHA-256 hash of the description**, and
status. On resolution, **if you opted in for public credit**, the original
description is published and anyone can recompute the SHA-256 to verify it
matches the hash recorded at intake. Credited reporters appear at
<https://status.adigitalcafe.com/status/bounty>.

**Safe Harbor** — we will not pursue legal action for good-faith security
research that follows this policy: test only your own accounts; no access to
third-party data; no DoS/DDoS; no social engineering/phishing/physical access;
minimize impact and stop once confirmed; keep it confidential until the fix
ships.

**Scope** — In: `adigitalcafe.com` and subdomains, platform apps, and this
monorepo's presets. Out: third-party services, DoS/volumetric tests,
third-party data, social engineering, no-impact scanner output, and
already-known issues.

Gracias por ayudar a mantener seguro el ecosistema de **ADC Platform** ·
Thanks for helping keep the **ADC Platform** ecosystem safe.
