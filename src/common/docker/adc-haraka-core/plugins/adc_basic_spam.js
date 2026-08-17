'use strict';

// Reglas antispam básicas + recolección de las señales SPF/DKIM que anotan los
// plugins `spf` y `dkim`. El veredicto viaja al webhook por `txn.notes`, que es
// espacio del MTA: las cabeceras X-ADC-* quedan sólo para depurar el .eml.

// Cabeceras que emitimos. Se borran las entrantes antes de escribir las nuestras
// porque el MIME lo controla el remitente y podría mandarse su propio veredicto.
const ADC_HEADERS = ['X-ADC-Spam-Score', 'X-ADC-Spam-Flag', 'X-ADC-Auth-Results'];

exports.register = function () {
	// Prioridad 50 para correr después de `dkim`, que verifica en data_post y en
	// config/plugins está listado más abajo (el orden del archivo nos pondría antes).
	this.register_hook('data_post', 'adc_spam_check', 50);
};

// haraka-plugin-spf deja el veredicto del mfrom en `txn.results` como
// `result: 'Pass'|'Fail'|'None'|'SoftFail'|'Neutral'|'TempError'|'PermError'`.
// Sin resultado (IP privada, o el plugin apagado) es "none", jamás "fail".
function spfVerdict(txn) {
	const result = txn.results.get('spf')?.result;
	if (typeof result !== 'string') return 'none';
	const verdict = result.toLowerCase();
	return verdict === 'pass' || verdict === 'fail' ? verdict : 'none';
}

// haraka-plugin-dkim no guarda un `result`: mete el dominio firmante en las
// listas `pass`/`fail` del store, una entrada por firma. Con firmas mezcladas
// gana el pass (RFC 6376 §6.1); tempfail/invalid no dejan ninguna de las dos.
function dkimVerdict(txn) {
	const results = txn.results.get('dkim');
	if (!results) return 'none';
	if (results.pass?.length) return 'pass';
	if (results.fail?.length) return 'fail';
	return 'none';
}

exports.adc_spam_check = function (next, connection) {
	const txn = connection.transaction;
	if (!txn) return next();

	let score = 0;
	const subject = (txn.header.get('Subject') || '').trim();

	// Asunto vacío
	if (!subject) score += 1.5;
	// Exceso de mayúsculas en el asunto
	if (subject.length > 0 && subject === subject.toUpperCase() && subject.length > 10) score += 1.5;
	// Palabras típicas de spam
	if (/\b(viagra|lottery|free money|bitcoin doubler|nigerian prince)\b/i.test(subject)) score += 3;
	// Sin From válido
	if (!txn.header.get('From')) score += 2;
	// Demasiados destinatarios
	if (txn.rcpt_to.length > 25) score += 1;

	const flag = score >= 5;
	const auth = { spf: spfVerdict(txn), dkim: dkimVerdict(txn) };

	txn.notes.adcSpam = { score, flag };
	txn.notes.adcAuth = auth;

	// `remove_header` borra todas las ocurrencias, pero de un solo nombre por llamada.
	for (const name of ADC_HEADERS) txn.remove_header(name);
	txn.add_header('X-ADC-Spam-Score', String(score));
	if (flag) txn.add_header('X-ADC-Spam-Flag', 'YES');
	txn.add_header('X-ADC-Auth-Results', `spf=${auth.spf}; dkim=${auth.dkim}`);

	return next();
};
