import { Type } from "@sinclair/typebox";
import { createAtRestSealer, type EnvelopeLogger } from "@common/utils/at-rest-envelope.ts";
import { compileSchema, safeParseJson } from "@common/utils/json-schema.ts";

/**
 * Sellado del cache de permisos por sesión (`session:permfp:*` en Redis).
 *
 * Lo que devuelve ese cache **no** es un fingerprint: es el set de permisos con el que se autoriza
 * el request, y `verifyToken` reemplaza con él los que venían firmados en el token. Como JSON plano
 * en un Redis sin autenticación, escribir `["*"]` en la clave de cualquier usuario le daría
 * administrador (el validador hace short-circuit con el comodín) y `[]` lo dejaría sin nada.
 *
 * El sobre lleva `(userId, orgId)` dentro y se verifican al abrirlo: sin eso, copiar el sobre de un
 * administrador a la clave de la víctima descifra perfectamente. Se hace así y no con el AAD de
 * `encryptAtRest` porque migrarlo invalidaría los sobres vivos sin ganar nada.
 */

/** Etiqueta de separación de dominio. Cambiarla sólo invalida los sobres vivos (TTL 60 s). */
const permCacheSeal = createAtRestSealer("adc:session-permfp");

const permEnvelopeCheck = compileSchema(Type.Object({ u: Type.String(), o: Type.String(), p: Type.Array(Type.String()) }));

/** Valor a guardar en `session:permfp:<userId>:<orgKey>`. */
export function sealPermissions(userId: string, orgKey: string, permissions: string[], logger?: EnvelopeLogger): string {
	return permCacheSeal.seal(JSON.stringify({ u: userId, o: orgKey, p: permissions }), logger);
}

/**
 * Abre el sobre, o `null` si no descifra, no cumple el shape o no corresponde al par
 * `(userId, orgKey)` pedido. `null` significa cache miss: el llamador resuelve contra la
 * fuente autoritativa y vuelve a sellar.
 *
 * Nunca se acepta un valor sin sellar como fallback: sería una vía de degradación permanente
 * —y exactamente el ataque que este archivo cierra—.
 */
export function openPermissions(sealed: string | null | undefined, userId: string, orgKey: string, logger?: EnvelopeLogger): string[] | null {
	const plain = permCacheSeal.open(sealed, logger);
	if (!plain) return null;

	const envelope = safeParseJson(plain, permEnvelopeCheck);
	if (!envelope) return null;
	if (envelope.u !== userId || envelope.o !== orgKey) {
		logger?.logWarn(`[SessionManager] cache de permisos descartado: el sobre no corresponde a ${userId}/${orgKey}`);
		return null;
	}
	return envelope.p;
}
