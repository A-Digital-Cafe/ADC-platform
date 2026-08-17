'use strict';

// Plugin de cola: entrega el correo entrante al email-service vía webhook HTTP.
// El cuerpo se envía como MIME crudo (base64) y se autentica con un secreto
// compartido en la cabecera `x-adc-webhook-secret`.

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

exports.register = function () {
	this.cfg = this.config.get('adc_inbound_webhook.ini');
};

exports.hook_queue = function (next, connection) {
	// Los callbacks internos son arrow functions, así que `this` (el plugin de
	// Haraka) se preserva sin necesidad del alias `const plugin = this`.
	const txn = connection.transaction;
	if (!txn) return next();

	const url = this.cfg?.main?.url || process.env.INBOUND_WEBHOOK_URL;
	const secret = this.cfg?.main?.secret || process.env.INBOUND_WEBHOOK_SECRET || '';
	if (!url) {
		connection.logerror(this, 'INBOUND_WEBHOOK_URL no configurado');
		return next(DENYSOFT, 'webhook no configurado');
	}

	// `get_data` es la única forma soportada de leer el mensaje entero:
	// `message_stream` sólo emite a través de `pipe()`, así que escucharlo con
	// `.on('data')`/`.on('end')` no dispara nunca y la sesión SMTP se cuelga en
	// DATA hasta el timeout del plugin (ningún correo llegaba a entregarse).
	txn.message_stream.get_data((raw) => {
		const recipients = txn.rcpt_to.map((r) => r.address());
		const body = {
			mailFrom: txn.mail_from ? txn.mail_from.address() : null,
			recipients,
			raw: raw.toString('base64'),
			sizeBytes: raw.length,
			receivedAt: new Date().toISOString(),
		};

		// Veredicto y señales de autenticación por `notes` (adc_basic_spam), fuera del
		// MIME que controla el remitente. Si el plugin no corrió van omitidos, no vacíos.
		const spam = txn.notes.adcSpam;
		const auth = txn.notes.adcAuth;
		if (spam) body.spam = { score: spam.score, flag: spam.flag };
		if (auth) body.auth = { spf: auth.spf, dkim: auth.dkim };

		const payload = JSON.stringify(body);

		const parsed = new URL(url);
		const client = parsed.protocol === 'https:' ? https : http;

		const req = client.request(
			parsed,
			{
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'content-length': Buffer.byteLength(payload),
					'x-adc-webhook-secret': secret,
				},
			},
			(res) => {
				res.resume();
				if (res.statusCode >= 200 && res.statusCode < 300) {
					return next(OK);
				}
				connection.logerror(this, `webhook status ${res.statusCode}`);
				return next(DENYSOFT, 'reintentar entrega');
			}
		);
		req.on('error', (err) => {
			connection.logerror(this, `webhook error: ${err.message}`);
			return next(DENYSOFT, 'reintentar entrega');
		});
		req.write(payload);
		req.end();
	});
};
