import React, { useCallback, useEffect, useState } from "react";
import { twoFactorApi, type TwoFactorMode } from "../utils/auth-api.ts";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { clearErrors } from "@ui-library/utils/adc-fetch";
import { redirectToReturnUrl } from "../utils/safe-url.ts";

/** Errores del desafío que se muestran inline como callout. */
const TWO_FACTOR_ERROR_KEYS = [
	{ key: "NO_PENDING_2FA", severity: "warning" },
	{ key: "INVALID_PENDING_2FA", severity: "warning" },
	{ key: "INVALID_TOTP", severity: "error" },
	{ key: "TWO_FACTOR_UNAVAILABLE", severity: "warning" },
	{ key: "ACCOUNT_DISABLED", severity: "warning" },
];

interface TwoFactorChallengeProps {
	readonly returnUrl: string;
	/**
	 * Modo ya conocido por quien renderiza (el login nativo lo recibe en la respuesta). Si falta
	 * —el flujo OAuth, que llega por redirect— se pregunta al backend con la cookie del desafío.
	 */
	readonly initialMode?: TwoFactorMode;
	readonly onNavigateToLogin: () => void;
}

/**
 * Segundo paso del login: pide el código del autenticador, o guía el alta obligatoria cuando la
 * cuenta tiene rol de administración y todavía no configuró el segundo factor.
 *
 * El alta termina en tres tramos —secreto/QR, código de confirmación, códigos de recuperación— y
 * la sesión se emite recién al confirmar: hasta ahí no hay forma de entrar sin el factor.
 */
export function TwoFactorChallenge({ returnUrl, initialMode, onNavigateToLogin }: TwoFactorChallengeProps) {
	const { t, ready } = useTranslation({ namespace: "adc-auth", autoLoad: true });

	const [mode, setMode] = useState<TwoFactorMode | null>(initialMode ?? null);
	const [loadingState, setLoadingState] = useState(!initialMode);
	const [expired, setExpired] = useState(false);

	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);

	// Alta obligatoria
	const [secret, setSecret] = useState<string | null>(null);
	const [otpauthUri, setOtpauthUri] = useState<string | null>(null);
	const [showSecret, setShowSecret] = useState(false);
	const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

	/** Sin desafío vivo no hay nada que mostrar: el login hay que rehacerlo desde el principio. */
	const markExpired = useCallback(() => {
		setExpired(true);
		setLoadingState(false);
	}, []);

	useEffect(() => {
		if (initialMode) return;
		void (async () => {
			const result = await twoFactorApi.getChallenge();
			if (result.success && result.data) setMode(result.data.mode);
			else markExpired();
			setLoadingState(false);
		})();
	}, [initialMode, markExpired]);

	/** Pide el secreto en cuanto se sabe que el modo es alta obligatoria. */
	useEffect(() => {
		if (mode !== "enroll" || secret) return;
		void (async () => {
			const result = await twoFactorApi.startEnrollment();
			if (result.success && result.data) {
				setSecret(result.data.secret);
				setOtpauthUri(result.data.otpauthUri);
			} else {
				markExpired();
			}
		})();
	}, [mode, secret, markExpired]);

	const finish = (redirectUrl?: string) => {
		if (globalThis.location) redirectToReturnUrl(redirectUrl || returnUrl);
	};

	const handleSubmit = async (e: React.SubmitEvent) => {
		e.preventDefault();
		clearErrors();
		setBusy(true);

		const result = mode === "enroll" ? await twoFactorApi.confirmEnrollment(code) : await twoFactorApi.verify(code);
		setBusy(false);

		if (!result.success || !result.data) {
			setCode("");
			return;
		}

		// En el alta los códigos de recuperación se muestran ANTES de entrar: es la única vez que
		// existen, y redirigir en el acto los perdería para siempre.
		if (result.data.recoveryCodes?.length) {
			setRecoveryCodes(result.data.recoveryCodes);
			return;
		}
		finish(result.data.redirectUrl);
	};

	if (!ready || loadingState) {
		return (
			<div className="w-full max-w-md">
				<adc-blur-panel variant="elevated" glow class="w-full">
					<adc-skeleton variant="rectangular" height="320px" />
				</adc-blur-panel>
			</div>
		);
	}

	if (expired) {
		return (
			<div className="w-full max-w-md">
				<adc-blur-panel variant="elevated" glow class="w-full">
					<h1 className="font-heading text-2xl font-bold text-center mb-4 text-text">{t("twoFactor.expiredTitle")}</h1>
					<p className="text-base text-muted text-center">{t("twoFactor.expiredBody")}</p>
					<div className="mt-6 text-center">
						<button type="button" onClick={onNavigateToLogin} className="text-accent hover:underline font-medium text-sm">
							{t("twoFactor.backToLogin")}
						</button>
					</div>
				</adc-blur-panel>
			</div>
		);
	}

	if (recoveryCodes) {
		return (
			<div className="w-full max-w-md">
				<adc-blur-panel variant="elevated" glow class="w-full">
					<h1 className="font-heading text-2xl font-bold text-center mb-4 text-text">{t("twoFactor.recoveryTitle")}</h1>
					<p className="text-base text-text mb-4">{t("twoFactor.recoveryBody")}</p>
					<adc-recovery-codes
						codes={JSON.stringify(recoveryCodes)}
						copyLabel={t("twoFactor.recoveryCopy")}
						copiedLabel={t("twoFactor.recoveryCopied")}
						downloadLabel={t("twoFactor.recoveryDownload")}
						filename={t("twoFactor.recoveryFilename")}
					/>
					<adc-button
						class="w-full flex justify-end mt-6"
						variant="primary"
						onClick={() => finish()}
						label={t("twoFactor.recoveryContinue")}
					/>
				</adc-blur-panel>
			</div>
		);
	}

	const enrolling = mode === "enroll";

	return (
		<div className="w-full max-w-md">
			<adc-blur-panel variant="elevated" glow class="w-full">
				<h1 className="font-heading text-2xl font-bold text-center mb-4 text-text">
					{enrolling ? t("twoFactor.enrollTitle") : t("twoFactor.verifyTitle")}
				</h1>

				<p className="text-base text-text">{enrolling ? t("twoFactor.enrollIntro") : t("twoFactor.verifyIntro")}</p>

				{enrolling && (
					<div className="mt-5">
						{otpauthUri ? (
							<div className="flex flex-col items-center gap-3">
								<div className="rounded-lg p-3 bg-white">
									<adc-qr-code value={otpauthUri} size={200} label={t("twoFactor.qrAlt")} />
								</div>
								<button
									type="button"
									onClick={() => setShowSecret(!showSecret)}
									className="text-accent hover:underline text-sm cursor-pointer"
								>
									{showSecret ? t("twoFactor.hideSecret") : t("twoFactor.cannotScan")}
								</button>
								{showSecret && secret && (
									<output className="block w-full text-center font-mono text-sm tracking-widest break-all bg-surface-alt rounded-lg p-3 text-text">
										{secret.replaceAll(/(.{4})/g, "$1 ").trim()}
									</output>
								)}
							</div>
						) : (
							<adc-skeleton variant="rectangular" height="200px" />
						)}
					</div>
				)}

				<adc-custom-error variant="callout" keys={JSON.stringify(TWO_FACTOR_ERROR_KEYS)} class="mt-4 block" />

				<form onSubmit={handleSubmit} className="space-y-4 mt-4">
					<div>
						<label htmlFor="totp-code" className="block text-base font-medium mb-1 text-text">
							{t("twoFactor.codeLabel")}
						</label>
						<adc-input
							inputId="totp-code"
							type="text"
							value={code}
							required
							// `one-time-code` habilita el autocompletado del código en iOS/Android.
							autocomplete="one-time-code"
							inputmode="numeric"
							placeholder="000000"
							onInput={(e) => setCode((e.target as HTMLInputElement).value)}
						/>
						{!enrolling && <p className="mt-2 text-sm text-muted">{t("twoFactor.recoveryHint")}</p>}
					</div>

					<adc-button
						key={busy ? "loading" : "idle"}
						type="submit"
						class="w-full flex justify-end mt-8"
						loading={busy}
						variant="primary"
						disabled={(enrolling && !secret) || undefined}
						label={busy ? t("twoFactor.submitting") : t("twoFactor.submit")}
					/>
				</form>

				<div className="mt-6 text-center">
					<button type="button" onClick={onNavigateToLogin} className="text-accent hover:underline font-medium text-sm">
						{t("twoFactor.backToLogin")}
					</button>
				</div>
			</adc-blur-panel>
		</div>
	);
}
