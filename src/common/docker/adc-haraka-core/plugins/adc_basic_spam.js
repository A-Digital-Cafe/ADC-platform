'use strict';

// Reglas antispam básicas. Suma una puntuación y la añade como cabecera
// X-ADC-Spam-Score. El email-service decide la carpeta (spam vs inbox).

exports.hook_data_post = function (next, connection) {
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

	txn.add_header('X-ADC-Spam-Score', String(score));
	if (score >= 5) txn.add_header('X-ADC-Spam-Flag', 'YES');

	return next();
};
