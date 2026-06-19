/** Returns true for localhost, 127.0.0.1 and private/LAN IPv4 addresses */
export function isPrivateHost(hostname: string): boolean {
	if (hostname === "localhost" || hostname === "127.0.0.1") return true;
	if (hostname.startsWith("192.168.")) return true;
	if (hostname.startsWith("10.")) return true;
	if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
	return false;
}

/** Dev mode: localhost, 127.0.0.1 or private/LAN IP */
export const IS_DEV = isPrivateHost(globalThis.location?.hostname ?? "");

const hostname = () => globalThis.location?.hostname ?? "localhost";
const protocol = () => globalThis.location?.protocol ?? "http:";
const port = () => (globalThis.location?.port ? `:${globalThis.location?.port}` : "");

/** Dev URL: http://{hostname}:{devPort}{path} */
export function getDevUrl(devPort: number, path = ""): string {
	return `http://${hostname()}:${devPort}${path}`;
}

/** Prod URL: {protocol}//{prodHostname}{port}{path} */
function getProdUrl(prodHostname: string, path = ""): string {
	return `${protocol()}//${prodHostname}${port()}${path}`;
}

/** URL based on environment */
export function getUrl(devPort: number, prodHostname: string, path = ""): string {
	return IS_DEV ? getDevUrl(devPort, path) : getProdUrl(prodHostname, path);
}

/** Base URL for API calls. In prod returns just the basePath (same-origin) */
export function getBaseUrl(devPort: number, basePath = ""): string {
	return IS_DEV ? getDevUrl(devPort, basePath) : basePath;
}

/** Remote entry URL for Module Federation */
export function getRemoteEntryUrl(devPort: number, prodHostname: string, filename = "remoteEntry.js"): string {
	return IS_DEV ? `http://${hostname()}:${devPort}/${filename}` : `http://${prodHostname}:3000/${filename}`;
}
