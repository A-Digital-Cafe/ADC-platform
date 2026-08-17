import React, { useState } from "react";
import { authApi, type TwoFactorMode } from "../utils/auth-api.ts";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { clearErrors } from "@ui-library/utils/adc-fetch";
import { DEFAULT_RETURN_URL, redirectToReturnUrl } from "../utils/safe-url.ts";
import { TwoFactorChallenge } from "./TwoFactorChallenge.tsx";

/** Nombres visibles de proveedores conocidos (la query es input no confiable: no se muestra cruda). */
const PROVIDER_NAMES: Record<string, string> = { google: "Google", discord: "Discord" };

/** Errores del flujo de vinculación que se muestran inline como callout */
const LINK_ERROR_KEYS = [
	{ key: "NO_PENDING_LINK", severity: "warning" },
	{ key: "INVALID_PENDING_LINK", severity: "warning" },
	{ key: "PASSWORD_REQUIRED", severity: "warning" },
	{ key: "WRONG_PASSWORD", severity: "error" },
	{ key: "ACCOUNT_DISABLED", severity: "warning" },
	{ key: "USER_NOT_FOUND", severity: "error" },
];

interface LinkAccountProps {
	readonly onNavigateToLogin: () => void;
}

/**
 * Página a la que redirige el callback OAuth cuando el email verificado del proveedor coincide
 * con una cuenta existente. Pide la contraseña de plataforma y llama a POST /api/auth/link-account
 * (el token de vinculación viaja en una cookie httpOnly de 5 minutos, con 3 intentos).
 */
export function LinkAccount({ onNavigateToLogin }: LinkAccountProps) {
	const { t, ready } = useTranslation({ namespace: "adc-auth", autoLoad: true });
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	/** La vinculación ya quedó hecha; lo que falta es el segundo factor para emitir la sesión. */
	const [twoFactorMode, setTwoFactorMode] = useState<TwoFactorMode | null>(null);

	const params = new URLSearchParams(globalThis.location?.search);
	const provider = PROVIDER_NAMES[params.get("provider") ?? ""] ?? t("linkAccount.genericProvider");
	const email = params.get("email") ?? "";

	const handleSubmit = async (e: React.SubmitEvent) => {
		e.preventDefault();
		clearErrors();
		setLoading(true);

		const result = await authApi.linkAccount(password);
		if (result.success && result.data?.requires2fa) {
			setTwoFactorMode(result.data.mode ?? "verify");
			setLoading(false);
			return;
		}
		if (result.success && result.data?.success && globalThis.location) {
			// El backend resuelve el returnUrl (cookie httpOnly validada server-side) y lo devuelve.
			redirectToReturnUrl(result.data.redirectUrl);
			return;
		}

		setLoading(false);
	};

	if (twoFactorMode) {
		return <TwoFactorChallenge returnUrl={DEFAULT_RETURN_URL} initialMode={twoFactorMode} onNavigateToLogin={onNavigateToLogin} />;
	}

	if (!ready) {
		return (
			<div className="w-full max-w-md">
				<adc-blur-panel variant="elevated" glow class="w-full">
					<adc-skeleton variant="rectangular" height="320px" />
				</adc-blur-panel>
			</div>
		);
	}

	return (
		<div className="w-full max-w-md">
			<adc-blur-panel variant="elevated" glow class="w-full">
				<h1 className="font-heading text-2xl font-bold text-center mb-6 text-text">{t("linkAccount.title", { provider })}</h1>

				<p className="text-base text-text">{t("linkAccount.intro", { provider, email })}</p>
				<p className="mt-2 text-sm text-muted">{t("linkAccount.hint")}</p>

				<adc-custom-error variant="callout" keys={JSON.stringify(LINK_ERROR_KEYS)} class="mt-4 block" />

				<form onSubmit={handleSubmit} className="space-y-4 mt-4">
					<div>
						<label htmlFor="password" className="block text-base font-medium mb-1 text-text">
							{t("linkAccount.password")}
						</label>
						<adc-input
							inputId="password"
							type="password"
							value={password}
							required
							autocomplete="current-password"
							placeholder="••••••••"
							onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
						/>
					</div>

					<adc-button
						key={loading ? "loading" : "idle"}
						type="submit"
						class="w-full flex justify-end mt-8"
						loading={loading}
						variant="primary"
					>
						{loading ? t("linkAccount.submitting") : t("linkAccount.submit")}
					</adc-button>
				</form>

				<div className="mt-6 text-center">
					<button type="button" onClick={onNavigateToLogin} className="text-accent hover:underline font-medium text-sm">
						{t("linkAccount.backToLogin")}
					</button>
				</div>
			</adc-blur-panel>
		</div>
	);
}
