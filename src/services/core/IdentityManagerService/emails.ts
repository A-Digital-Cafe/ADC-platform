/**
 * Cuerpos de los correos transaccionales de identidad.
 *
 * Viven acá y no en los endpoints porque los comparten dos flujos (alta y cambio de email) y
 * porque el HTML inline ya estaba engordando el archivo de endpoints. No hay sistema de plantillas
 * ni i18n de correo: cada mensaje es UNO solo, bilingüe (castellano, `<hr>`, inglés), con el
 * asunto también bilingüe separado por raya.
 */

/** Vigencia (minutos) del enlace de confirmación; espejo de `EMAIL_CHANGE_TOKEN_TTL_MS` del DAO. */
export const EMAIL_CHANGE_TOKEN_TTL_MINUTES = 60;

export interface SystemEmailBody {
	subject: string;
	html: string;
	text: string;
}

/** Enlace de un solo uso a la casilla que se quiere vincular (alta o rectificación). */
export function buildEmailConfirmBody(confirmUrl: string): SystemEmailBody {
	const ttl = EMAIL_CHANGE_TOKEN_TTL_MINUTES;
	return {
		subject: "Confirmá tu email — Confirm your email",
		html:
			`<p>Pediste usar esta casilla como email de tu cuenta de ADC Platform.</p>` +
			`<p><a href="${confirmUrl}">Confirmar el email</a> (enlace de un solo uso, vence en ${ttl} minutos).</p>` +
			`<p>Si no fuiste vos, ignorá este correo: sin esta confirmación la casilla no queda vinculada a ninguna cuenta.</p>` +
			`<hr><p>You asked to use this address as your ADC Platform account email. ` +
			`<a href="${confirmUrl}">Confirm the email</a> (single-use link, expires in ${ttl} minutes). ` +
			`If this wasn't you, ignore this message: without confirmation the address is not linked to any account.</p>`,
		text:
			`Pediste usar esta casilla como email de tu cuenta de ADC Platform. ` +
			`Confirmalo (enlace de un solo uso, vence en ${ttl} minutos): ${confirmUrl} — ` +
			`Si no fuiste vos, ignorá este correo. / You asked to use this address as your ADC Platform account email. ` +
			`Confirm here (single-use, expires in ${ttl} minutes): ${confirmUrl}`,
	};
}

/**
 * Aviso a quien YA es titular de la casilla de que alguien la tipeó en un alta o en un cambio de
 * email. Va sin token ni enlace de acción —no hay nada que confirmar— y sin un solo dato de la
 * cuenta (ni username ni fecha de alta): quien lo recibe es el titular y ya los sabe, y quien lo
 * provocó no debe poder deducir nada de que exista o no.
 */
export function buildEmailAlreadyRegisteredBody(): SystemEmailBody {
	return {
		subject: "Esta casilla ya tiene cuenta — This address already has an account",
		html:
			`<p>Alguien intentó usar esta dirección como email de una cuenta de ADC Platform, pero la casilla ya tiene una.</p>` +
			`<p>No hay nada que confirmar ni ninguna acción pendiente: tu cuenta sigue igual y esta dirección sigue siendo tuya. ` +
			`Si fuiste vos, entrá con tu cuenta de siempre.</p>` +
			`<hr><p>Someone tried to use this address as the email of an ADC Platform account, but it already has one. ` +
			`There is nothing to confirm and no pending action: your account is unchanged and this address is still yours. ` +
			`If it was you, just sign in with your existing account.</p>`,
		text:
			`Alguien intentó usar esta dirección como email de una cuenta de ADC Platform, pero la casilla ya tiene una. ` +
			`No hay nada que confirmar: tu cuenta sigue igual. Si fuiste vos, entrá con tu cuenta de siempre. / ` +
			`Someone tried to use this address as the email of an ADC Platform account, but it already has one. ` +
			`Nothing to confirm: your account is unchanged. If it was you, sign in with your existing account.`,
	};
}
