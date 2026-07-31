# Política de nombres: alias de correo y usernames prohibidos

Un único archivo controla qué nombres puede tomar una persona y qué direcciones
son alias que entregan en el buzón de otra:
**[src/common/config/name-policy.json](../../src/common/config/name-policy.json)**.

Se relee **en caliente** (el loader compara `mtime`), así que editarlo no requiere
reiniciar la plataforma. Si el JSON queda mal formado se conserva la última
política válida y se sigue sirviendo: una config rota no tumba el registro.

## Alias de correo

`aliases` mapea **dirección → username de la plataforma**. La clave sin `@` se
interpreta en el dominio raíz (`MAIL_ROOT_DOMAIN`):

```json
"aliases": {
  "support": "abbytec",
  "dmarc": "abbytec",
  "support@miorg.adigitalcafe.com": "otro-usuario"
}
```

- `support@adigitalcafe.com` entrega en el buzón de `abbytec`, aunque esa
  dirección no sea un buzón real (los buzones son `usuario@<orgSlug>.<raíz>`).
- Funciona igual con subaddressing: `support+ventas@…` sigue siendo `support`.
- Los alias sin dominio **no** aplican a subdominios de organización; para eso hay
  que poner la dirección completa como clave.
- Enviar desde la plataforma a un alias también funciona: se acepta como
  destinatario válido aunque no exista el buzón.
- Toda clave de alias queda **reservada** como username automáticamente.

Si el username destino no tiene buzón todavía, el correo se descarta con un aviso
en el log (`Destinatario desconocido, descartado`). El buzón se crea la primera
vez que esa persona abre la app de correo.

## Usernames prohibidos

- `reservedUsernames`: coincidencia **exacta** tras normalizar.
- `blockedWords`: coincidencia por **subcadena** sobre la forma normalizada.
- `allowedExceptions`: usernames exactos que se permiten aunque contengan una
  palabra bloqueada (falsos positivos tipo `sexto`).

La normalización pasa a minúsculas, elimina separadores y deshace el leet
(`4→a`, `1→i`, `0→o`, `3→e`, `5→s`, `7→t`, `@→a`, `$→s`), de modo que `adm1n`,
`a-d-m-i-n` y `admin` colapsan al mismo texto.

Se aplica en:

| Punto | Comportamiento |
| ----- | -------------- |
| `POST /api/auth/register` | Rechaza con `FORBIDDEN_USERNAME` (400) |
| Cambio de username (`PUT /api/users/:id`) | Rechaza con `FORBIDDEN_USERNAME` (400) |
| Alta por OAuth (Discord) | **No rechaza**: asigna un username generado tipo `braveOtter482` |

En OAuth el nombre no lo elige la persona en la plataforma, así que cortar el
login sería peor que renombrarla; el vocabulario del nombre generado sale de
`randomUsername` en el mismo archivo.

Bloquear un username bloquea también su dirección de correo, porque el buzón se
deriva del username (`<username>@<orgSlug>.<raíz>`).

> Los usuarios que ya existían **no** se revalidan: la política sólo actúa al
> crear o renombrar. Si hace falta, revisar los existentes es un paso aparte.
