import React, { useState, useEffect } from "react";
import { authApi } from "../utils/auth-api.ts";
import { identityApi } from "@ui-library/utils/api-identity";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { clearErrors } from "@ui-library/utils/adc-fetch";
import { showError } from "@ui-library/utils/error-handler";
import { useAbortable } from "@ui-library/utils/use-abortable";
import { getBaseUrl } from "@common/utils/url-utils.js";
import { redirectToReturnUrl, sanitizeReturnUrl } from "../utils/safe-url.ts";

/** Pattern de username válido: alfanumérico + _ . - entre 3 y 32 caracteres. */
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;

/** Puntúa la fuerza de la contraseña: 0 = vacía, 1 = débil, 2 = media, 3 = fuerte. */
function passwordStrength(password: string): 0 | 1 | 2 | 3 {
	if (!password) return 0;
	let score = 0;
	if (password.length >= 8) score++;
	if (password.length >= 12) score++;
	if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
	if (/\d/.test(password)) score++;
	if (/[^a-zA-Z0-9]/.test(password)) score++;
	if (score <= 2) return 1;
	if (score === 3) return 2;
	return 3;
}

/** Estilos + clave i18n por nivel de fuerza (1..3); 0 reutiliza el nivel débil. */
const STRENGTH_META: Record<1 | 2 | 3, { bar: string; text: string; labelKey: string }> = {
	1: { bar: "bg-danger", text: "text-danger", labelKey: "register.passwordWeak" },
	2: { bar: "bg-warn", text: "text-warn", labelKey: "register.passwordMedium" },
	3: { bar: "bg-success", text: "text-success", labelKey: "register.passwordStrong" },
};

/** Errores específicos de formulario registro (se muestran inline como callout) */
const REGISTER_SPECIFIC_ERROR_KEYS = [
	{ key: "PASSWORDS_MISMATCH", severity: "error" },
	{ key: "PASSWORD_TOO_SHORT", severity: "error" },
	{ key: "MISSING_FIELDS", severity: "error" },
	{ key: "INVALID_USERNAME", severity: "error" },
	{ key: "WEAK_PASSWORD", severity: "error" },
	{ key: "INVALID_EMAIL", severity: "error" },
	{ key: "USERNAME_EXISTS", severity: "warning" },
	{ key: "EMAIL_EXISTS", severity: "warning" },
];

/** Base URL for API calls */
const API_BASE = getBaseUrl(3000);

interface RegisterProps {
	readonly onNavigateToLogin: () => void;
	readonly returnUrl: string;
}

export function Register({ onNavigateToLogin, returnUrl }: RegisterProps) {
	const { t, ready } = useTranslation({ namespace: "adc-auth", autoLoad: true });
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "unavailable">("idle");

	const checkUsernameRequest = useAbortable((signal, value: string) => identityApi.checkUsernameExists(value, signal));

	const checkUsername = async (username: string) => {
		// Validación estricta inline antes de consultar disponibilidad.
		if (!USERNAME_PATTERN.test(username)) {
			setUsernameStatus("idle");
			return;
		}

		try {
			setUsernameStatus("checking");
			const res = await checkUsernameRequest(username);
			if (!res) return; // abortada: una nueva petición decidirá el estado
			if (res.status === 200) setUsernameStatus("unavailable");
			else if (res.status === 404) setUsernameStatus("available");
			else setUsernameStatus("idle");
		} catch {
			setUsernameStatus("idle");
		}
	};

	useEffect(() => {
		if (username.length < 3) {
			setUsernameStatus("idle");
			return;
		}

		const timeout = setTimeout(() => {
			checkUsername(username);
		}, 500);

		return () => clearTimeout(timeout);
	}, [username]);

	const handleSubmit = async (e: React.SubmitEvent) => {
		e.preventDefault();
		clearErrors();

		if (password !== confirmPassword) {
			showError({ errorKey: "PASSWORDS_MISMATCH", message: t("errors.PASSWORDS_MISMATCH") });
			return;
		}

		if (password.length < 8) {
			showError({ errorKey: "PASSWORD_TOO_SHORT", message: t("errors.PASSWORD_TOO_SHORT") });
			return;
		}

		setLoading(true);

		// authApi.register now handles errors internally via createAdcApi
		const result = await authApi.register(username, email, password);

		if (result.success && globalThis.location) {
			redirectToReturnUrl(returnUrl);
		}

		setLoading(false);
	};

	/**
	 * Construye URL de OAuth preservando returnUrl sanitizado.
	 * `provider` es un literal pasado desde el JSX, no es input del usuario.
	 */
	const getOAuthUrl = (provider: string): string => {
		return `${API_BASE}/api/auth/login/${provider}?returnUrl=${encodeURIComponent(sanitizeReturnUrl(returnUrl))}`;
	};

	const strength = passwordStrength(password);
	const strengthMeta = STRENGTH_META[strength === 0 ? 1 : strength];
	const strengthColor = strengthMeta.bar;
	const strengthTextColor = strengthMeta.text;
	const strengthLabel = t(strengthMeta.labelKey);

	// Skeleton mientras cargan las traducciones
	if (!ready) {
		return (
			<div className="w-full max-w-md">
				<adc-blur-panel variant="elevated" glow class="w-full">
					<adc-skeleton variant="rectangular" height="364px" />
				</adc-blur-panel>
			</div>
		);
	}

	return (
		<div className="w-full max-w-md">
			<adc-blur-panel variant="elevated" glow class="w-full">
				<h1 className="font-heading text-2xl font-bold text-center mb-6 text-text">{t("register.title") || "Crear Cuenta"}</h1>

				{/* Handler de errores específicos del formulario (validación, duplicados) */}
				<adc-custom-error variant="callout" keys={JSON.stringify(REGISTER_SPECIFIC_ERROR_KEYS)} class="mb-4" />

				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<label htmlFor="username" className="block text-base font-medium mb-1 text-text">
							{t("register.username") || "Nombre de Usuario"}
						</label>
						<adc-input
							inputId="username"
							type="text"
							value={username}
							required
							autocomplete="username"
							placeholder={t("register.usernamePlaceholder") || "tu_usuario"}
							hint={usernameStatus === "checking" ? t("register.usernameChecking") : undefined}
							success={usernameStatus === "available" ? t("register.usernameAvailable") : undefined}
							error={usernameStatus === "unavailable" ? t("register.usernameUnavailable") : undefined}
							onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
						/>
					</div>

					<div>
						<label htmlFor="email" className="block text-base font-medium mb-1 text-text">
							{t("register.email") || "Email"}
						</label>
						<adc-input
							inputId="email"
							type="email"
							value={email}
							required
							autocomplete="email"
							placeholder="tu@email.com"
							onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
						/>
					</div>

					<div>
						<label htmlFor="password" className="block text-base font-medium mb-1 text-text">
							{t("register.password") || "Contraseña"}
						</label>
						<adc-input
							inputId="password"
							type="password"
							value={password}
							required
							autocomplete="new-password"
							placeholder="••••••••"
							error={password.length > 0 && password.length < 8 ? t("register.passwordTooShort") : undefined}
							onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
						/>
						{password.length >= 8 && strength > 0 && (
							<div className="mt-2" aria-live="polite">
								<div className="flex gap-1" aria-hidden="true">
									{[1, 2, 3].map((level) => (
										<span
											key={level}
											className={`h-1 flex-1 rounded-full ${level <= strength ? strengthColor : "bg-text/15"}`}
										/>
									))}
								</div>
								<p className="mt-1 text-[11px] text-muted">
									{t("register.passwordStrengthLabel")}: <span className={strengthTextColor}>{strengthLabel}</span>
								</p>
							</div>
						)}
					</div>

					<div>
						<label htmlFor="confirmPassword" className="block text-base font-medium mb-1 text-text">
							{t("register.confirmPassword") || "Confirmar Contraseña"}
						</label>
						<adc-input
							inputId="confirmPassword"
							type="password"
							value={confirmPassword}
							required
							autocomplete="new-password"
							placeholder="••••••••"
							error={confirmPassword.length > 0 && password !== confirmPassword ? t("register.passwordsMismatch") : undefined}
							onInput={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
						/>
					</div>

					<adc-button
						key={loading ? "loading" : "idle"}
						type="submit"
						class="w-full flex justify-end mt-8"
						loading={loading}
						disabled={usernameStatus === "unavailable"}
						variant="primary"
					>
						{loading ? t("register.submitting") || "Creando cuenta..." : t("register.submit") || "Crear Cuenta"}
					</adc-button>
				</form>

				<div className="mt-6 text-center">
					<p className="text-sm text-muted">
						{t("register.hasAccount") || "¿Ya tienes cuenta?"}{" "}
						<button type="button" onClick={onNavigateToLogin} className="text-accent hover:underline font-medium">
							{t("register.login") || "Inicia sesión"}
						</button>
					</p>
				</div>

				<div className="mt-6 pt-6 border-t border-divider">
					<p className="text-sm text-center text-muted mb-4">{t("register.orRegisterWith") || "O regístrate con"}</p>
					<div className="flex gap-3 justify-center">
						<a
							href={getOAuthUrl("discord")}
							className="flex items-center gap-2 px-4 py-2 bg-[#5865F2] text-white rounded-lg hover:brightness-110 transition-all"
						>
							<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
								<path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
							</svg>
							Discord
						</a>
						<a
							href={getOAuthUrl("google")}
							className="flex items-center gap-2 px-4 py-2 bg-white text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50 transition-all"
						>
							<svg width="20" height="20" viewBox="0 0 24 24">
								<path
									fill="#4285F4"
									d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
								/>
								<path
									fill="#34A853"
									d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
								/>
								<path
									fill="#FBBC05"
									d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
								/>
								<path
									fill="#EA4335"
									d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
								/>
							</svg>
							Google
						</a>
					</div>
				</div>
			</adc-blur-panel>
		</div>
	);
}
