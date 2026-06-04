'use strict';

// Plugin de cola: entrega el correo entrante al email-service vía webhook HTTP.
// El cuerpo se envía como MIME crudo (base64) y se autentica con un secreto
// compartido en la cabecera `x-adc-webhook-secret`.

const http = require('http');
const https = require('https');
const { URL } = require('url');

exports.register = function () {
	this.cfg = this.config.get('adc_inbound_webhook.ini');
};

exports.hook_queue = function (next, connection) {
	const plugin = this;
	const txn = connection.transaction;
	if (!txn) return next();

	const url = (plugin.cfg && plugin.cfg.main && plugin.cfg.main.url) || process.env.INBOUND_WEBHOOK_URL;
	const secret = (plugin.cfg && plugin.cfg.main && plugin.cfg.main.secret) || process.env.INBOUND_WEBHOOK_SECRET || '';
	if (!url) {
		connection.logerror(plugin, 'INBOUND_WEBHOOK_URL no configurado');
		return next(DENYSOFT, 'webhook no configurado');
	}

	const chunks = [];
	txn.message_stream.on('data', (c) => chunks.push(c));
	txn.message_stream.on('end', () => {
		const raw = Buffer.concat(chunks);
		const recipients = txn.rcpt_to.map((r) => r.address());
		const payload = JSON.stringify({
			mailFrom: txn.mail_from ? txn.mail_from.address() : null,
			recipients,
			raw: raw.toString('base64'),
			sizeBytes: raw.length,
			receivedAt: new Date().toISOString(),
		});

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
				connection.logerror(plugin, `webhook status ${res.statusCode}`);
				return next(DENYSOFT, 'reintentar entrega');
			}
		);
		req.on('error', (err) => {
			connection.logerror(plugin, `webhook error: ${err.message}`);
			return next(DENYSOFT, 'reintentar entrega');
		});
		req.write(payload);
		req.end();
	});
};
