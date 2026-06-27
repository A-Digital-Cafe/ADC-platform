// Mobile device emulation for --mobile / --device / --viewport, applied over CDP.
export const DEVICES = {
	mobile: { width: 390, height: 844, dsf: 2, mobile: true, ua: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36" },
	pixel7: { width: 412, height: 915, dsf: 2.625, mobile: true, ua: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36" },
	iphone: { width: 390, height: 844, dsf: 3, mobile: true, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
};

// Resolve --mobile/--device/--viewport into a device-metrics object, or null
// (desktop default). `--viewport WxH` wins for an exact size; add --mobile for
// touch + a mobile UA on top of it.
export function resolveViewport({ mobile, device, viewport } = {}) {
	if (device) {
		const d = DEVICES[String(device).toLowerCase()];
		if (!d) throw new Error(`unknown device "${device}" (known: ${Object.keys(DEVICES).join(", ")})`);
		return d;
	}
	if (viewport) {
		const m = /^(\d+)x(\d+)$/i.exec(viewport);
		if (!m) throw new Error(`--viewport must be WxH (e.g. 414x896), got "${viewport}"`);
		return { width: +m[1], height: +m[2], dsf: mobile ? 2 : 1, mobile: !!mobile, ua: mobile ? DEVICES.mobile.ua : null };
	}
	if (mobile) return DEVICES.mobile;
	return null;
}

// Apply a resolved viewport to a live CDP session (no-op for desktop default).
export async function applyViewport(cdp, vp) {
	if (!vp) return;
	await cdp.send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: vp.dsf || 1, mobile: !!vp.mobile });
	if (vp.ua) await cdp.send("Emulation.setUserAgentOverride", { userAgent: vp.ua });
	try { await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: !!vp.mobile }); } catch {}
	console.log(`viewport -> ${vp.width}x${vp.height}@${vp.dsf || 1}${vp.mobile ? " (touch)" : ""}`);
}
