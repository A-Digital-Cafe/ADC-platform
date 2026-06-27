// Authenticate as a dev user inside the page by POSTing to /api/auth/login from a
// loaded localhost origin: in dev CORS allows credentialed localhost requests,
// CSRF is off, and the auth cookies are scoped to domain "localhost" (so they
// apply across every app port). If the user has orgs and none was given, the
// first option is auto-picked.
import { setTimeout as sleep } from "node:timers/promises";
import { BASE, DEV_USERS } from "./config.mjs";

// Resolve a preset key (admin | orgadmin) or a "username::password[::orgId]" spec.
export function resolveCreds(who) {
	if (!who) throw new Error("login: missing user (admin | orgadmin | 'user::pass[::orgId]')");
	if (DEV_USERS[who]) return DEV_USERS[who];
	const [username, password, orgId] = who.split("::");
	if (!username || !password) throw new Error(`login: unknown preset "${who}" and not a 'user::pass[::orgId]' string`);
	return { username, password, ...(orgId ? { orgId } : {}) };
}

export async function loginInPage(cdp, creds) {
	const body = { username: creds.username, password: creds.password, ...(creds.orgId ? { orgId: creds.orgId } : {}) };
	const res = await cdp.eval(`(async () => {
		const url = ${JSON.stringify(BASE)} + '/api/auth/login';
		const post = (b) => fetch(url, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) })
			.then(r => r.json().then(j => ({ status: r.status, json: j })).catch(() => ({ status: r.status, json: null })));
		let r = await post(${JSON.stringify(body)});
		if (r.json && r.json.requiresOrgSelection && r.json.orgOptions && r.json.orgOptions.length) {
			r = await post({ ...${JSON.stringify(body)}, orgId: r.json.orgOptions[0].orgId });
		}
		return r;
	})()`);
	if (!res || res.status >= 400 || !res.json?.success || res.json?.requiresOrgSelection) {
		throw new Error(`login failed for ${creds.username}: ${JSON.stringify(res)}`);
	}
	const u = res.json.user || {};
	console.log(`login -> ${u.username || creds.username}${u.orgSlug ? ` @${u.orgSlug}` : ""} (ok)`);
	return res.json;
}

// Open a localhost origin and authenticate, so subsequent navigations are logged in.
export async function loginSession(cdp, who) {
	await cdp.send("Page.navigate", { url: BASE });
	await sleep(1500);
	return loginInPage(cdp, resolveCreds(who));
}
