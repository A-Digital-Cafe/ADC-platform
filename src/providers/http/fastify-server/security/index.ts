export { getBodyLimitBytes, getRawBodyLimitBytes } from "./body-limit.js";
export {
	ALLOWED_CORS_HEADERS,
	ALLOWED_HTTP_METHODS,
	createCorsOriginGuard,
	getAllowHeader,
	isAllowedHttpMethod,
	/** @public */ isPlatformOrigin,
	warnIfCorsAllowlistEmpty,
} from "./cors.js";
export { applySecurityHeaders } from "./headers.js";
export { countryFromRequest, injectCountry } from "./geo-country.js";
export { isTrustedProxyPeer, resolveTrustProxy, warnIfNoTrustedProxies } from "./trusted-proxies.js";
export { getCspNonce, isCspNonceEnabled, stampCspNonce } from "./csp-nonce.js";
export { hasGpcOptOut, hasMalformedBeaconToken, injectWebAnalytics, webAnalyticsSnippet } from "./web-analytics.js";
export { isBlockedBuildArtifact, isSafeStaticPath, normalizeUrlPath, resolveSafeStaticPath, staticCacheControl } from "./static-path.js";
export { acquireInflight, getMaxInflightBodiesPerIp } from "./inflight.js";
export { createTrafficShaper, hasRequestBody, readShapingConfig, type ShapingConfig } from "./traffic-shaper.js";
