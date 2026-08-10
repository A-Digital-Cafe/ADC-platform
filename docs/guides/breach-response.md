# Respuesta a incidentes que afectan datos personales

Runbook operativo del compromiso publicado en `/privacy` §11: notificar a la **AAIP** dentro de
las **72 horas** desde que se toma conocimiento y avisar a las personas afectadas cuando el riesgo
es alto. El respaldo técnico es `BreachRegisterService` (registro del art. 33.5) y el panel
**Admin - General → Brechas** (`adc-admin-panel`).

> `.github/SECURITY.md` cubre lo **entrante**: alguien reporta una vulnerabilidad. Esto cubre lo
> **saliente**: datos personales que se expusieron, se perdieron o se alteraron. Una vulnerabilidad
> reportada y no explotada **no** es una brecha; si hay indicio de que se explotó, sí.

## 0. Qué cuenta como incidente

Cualquier violación de la seguridad que ocasione destrucción, pérdida, alteración, comunicación o
acceso no autorizados a datos personales. Incluye lo aburrido: un backup expuesto, un correo masivo
con las direcciones en copia visible, un archivo compartido con el enlace equivocado, una cuenta de
administración comprometida, un proveedor que avisa de su propia brecha.

## 1. Detectar y abrir (minuto 0)

Abrir el incidente en el panel **antes** de investigar: `detectedAt` es la constancia del
conocimiento y de ahí salen las 72 h. Se abre con lo que se sepa; el resto se completa después.
Al abrirlo, el panel calcula el vencimiento, avisa al equipo y empieza a recordarlo.

**Origen** (`source`): interno, reporte de un tercero, aviso de un proveedor o requerimiento de una
autoridad. Si viene de un ticket de seguridad, anotar su clave en `sourceRef`.

## 2. Evaluar (`assessing`)

Describir la **naturaleza** del incidente: qué pasó, por qué vía, desde cuándo, si sigue abierto.
Es el único campo del registro que admite datos personales — por eso el registro es colección
propia y no el audit log, que descarta cualquier cosa con pinta de PII.

## 3. Contener (`contained`)

Cortar la exposición primero, entender después. Registrar cada medida con su hora: es la mitad de
la prueba del art. 32. Al contener hay que fijar:

- **categorías de datos** alcanzadas y número aproximado de personas y registros;
- **consecuencias probables** (art. 33.3.c);
- la **evaluación de riesgo** con su fundamento. `highRisk` es lo que vuelve obligatorio el aviso a
  las personas (art. 34) — marcarlo o no es la decisión más consecuente de todo el procedimiento.

Criterio práctico para `highRisk`: credenciales, contenido de correo, archivos privados o datos de
facturación ⇒ sí, salvo que estuvieran cifrados con una clave que el atacante no tiene. Metadatos
de uso sin identificadores directos ⇒ normalmente no, y hay que escribir por qué.

## 4. Registrar (`registered`)

Con al menos una medida de contención y las medidas correctivas escritas, el incidente **existe
formalmente** aunque nunca se notifique. Este paso no es opcional: el art. 33.5 obliga a documentar
también los incidentes que no llegan a notificarse, y `/privacy` §11 lo promete literalmente.

## 5. Notificar a la autoridad — o no

- **Notificar** (`authority_notified`): el panel arma el borrador con la estructura del art. 33.3.
  Revisarlo, enviarlo por el canal de la AAIP y pegar el texto **tal como se envió** más el número
  de acuse. Si se pasó de las 72 h, el sistema exige el **motivo de la demora** porque la propia
  política promete acompañarlo.
- **No notificar** (`no_notification`): exige fundamento escrito. Es la decisión que una autoridad
  va a auditar, así que se registra con la misma formalidad que notificar y se audita fail-closed.

## 6. Avisar a las personas afectadas

Sólo si `highRisk`. Tres pasos, en este orden:

1. **Congelar la audiencia** (`PUT .../audience`) antes de enviar nada. A quién se avisó es
   evidencia; sin la foto previa no hay forma de probarlo.
2. **Revisar el texto**: el borrador cubre los seis puntos que `/privacy` §11 promete. Lenguaje
   claro (art. 34.2): quien lo lee no es abogado.
3. **Enviar** (`notify-subjects`). Sale por `platform.security_incident`, que la persona no puede
   silenciar, con dedup por incidente: reintentar no duplica.

**Excepciones del art. 34.3** (`encrypted`, `measures_taken`, `disproportionate_effort`): se
invocan con su fundamento, y la tercera exige además una comunicación pública — un aviso global
desde **Admin - Módulos** sirve, y su URL se guarda en el registro.

> ⚠️ Con `MAIL_INTERNAL_ONLY=true` el canal email no llega a casillas externas. El aviso in-app
> sale igual, pero **no se puede dar por cumplido el aviso por correo**: verificar la política de
> entrega antes de prometerlo y, si hace falta, usar la comunicación pública como respaldo.

## 7. Cerrar

`closed` con todo lo pendiente resuelto. El registro no se borra nunca.

## Contactos y plazos

| Qué | Dónde |
| --- | ----- |
| Autoridad (Argentina) | AAIP — Agencia de Acceso a la Información Pública |
| Plazo a la autoridad | 72 h desde el conocimiento (`BREACH_AUTHORITY_DEADLINE_HOURS`) |
| Aviso previo del sistema | 12 h antes (`BREACH_REMINDER_LEAD_HOURS`) |
| Aviso a personas | sin dilación indebida cuando el riesgo es alto |
| Registro interno | `security.breach`, panel Admin - General |
| Rastro de decisiones | audit log (`breach.*`), permiso `security.audit_log` |
