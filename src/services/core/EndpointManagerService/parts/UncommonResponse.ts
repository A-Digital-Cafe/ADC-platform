// ─────────────────────────────────────────────────────────────────────────────
// UncommonResponse - For responses requiring cookies, redirects, or custom headers
// ─────────────────────────────────────────────────────────────────────────────

export interface CookieOptions {
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: "strict" | "lax" | "none";
	path?: string;
	domain?: string;
	maxAge?: number;
}

export interface SetCookie {
	name: string;
	value: string;
	options?: CookieOptions;
}

export interface ClearCookie {
	name: string;
	options?: Pick<CookieOptions, "path" | "domain">;
}

/**
 * UncommonResponse - For endpoints that need cookies, redirects, custom headers
 * or streaming bodies. Throw this instead of returning data when you need
 * HTTP-level control
 */
export class UncommonResponse {
	public readonly type: "json" | "redirect" | "stream";
	public readonly status: number;
	public readonly body?: unknown;
	public readonly redirectUrl?: string;
	public readonly headers: Record<string, string>;
	public readonly cookies: SetCookie[];
	public readonly clearCookies: ClearCookie[];

	private constructor(config: {
		type: "json" | "redirect" | "stream";
		status: number;
		body?: unknown;
		redirectUrl?: string;
		headers?: Record<string, string>;
		cookies?: SetCookie[];
		clearCookies?: ClearCookie[];
	}) {
		this.type = config.type;
		this.status = config.status;
		this.body = config.body;
		this.redirectUrl = config.redirectUrl;
		this.headers = config.headers || {};
		this.cookies = config.cookies || [];
		this.clearCookies = config.clearCookies || [];
	}

	/** JSON response with optional cookies/headers */
	static json(
		body: unknown,
		options?: {
			status?: number;
			headers?: Record<string, string>;
			cookies?: SetCookie[];
			clearCookies?: ClearCookie[];
		}
	): UncommonResponse {
		return new UncommonResponse({
			type: "json",
			status: options?.status || 200,
			body,
			headers: options?.headers,
			cookies: options?.cookies,
			clearCookies: options?.clearCookies,
		});
	}

	/**
	 * Streaming response (Node Readable). Útil para proxyear binarios (ej:
	 * descargas descifradas al vuelo). Setear `Content-Type` y
	 * `Content-Disposition` vía `headers`; `Content-Length` si se conoce.
	 */
	static stream(
		body: NodeJS.ReadableStream,
		options?: {
			status?: number;
			headers?: Record<string, string>;
		}
	): UncommonResponse {
		return new UncommonResponse({
			type: "stream",
			status: options?.status || 200,
			body,
			headers: options?.headers,
		});
	}

	/** Redirect response with optional cookies */
	static redirect(
		url: string,
		options?: {
			status?: 301 | 302 | 303 | 307 | 308;
			cookies?: SetCookie[];
			clearCookies?: ClearCookie[];
		}
	): UncommonResponse {
		return new UncommonResponse({
			type: "redirect",
			status: options?.status || 302,
			redirectUrl: url,
			cookies: options?.cookies,
			clearCookies: options?.clearCookies,
		});
	}
}
