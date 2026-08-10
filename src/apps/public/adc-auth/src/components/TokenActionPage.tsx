import { useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { AdcFetchResult } from "@ui-library/utils/adc-fetch";

type Status = "idle" | "working" | "done" | "failed";

interface TokenActionPageProps {
	/** Bloque del diccionario `adc-auth` con los textos de la página (`cancelDeletion` | `confirmEmail`). */
	readonly i18nPrefix: string;
	/** Canje del token contra la API pública de identidad. */
	readonly submit: (token: string) => Promise<AdcFetchResult<{ success: boolean }>>;
	/** errorKey del backend → clave de mensaje (relativa al prefijo). El resto cae en `errorBody`. */
	readonly errorMessages?: Record<string, string>;
	readonly onNavigateToLogin: () => void;
}

/**
 * Página pública de canje de un token que llegó por email (`?token=…`): cancelación de baja y
 * confirmación de cambio de email. El canje NO es automático al abrir la página — un botón de
 * confirmación evita que un prefetch del cliente de correo consuma un token de un solo uso.
 */
export function TokenActionPage({ i18nPrefix, submit, errorMessages, onNavigateToLogin }: TokenActionPageProps) {
	const { t, ready } = useTranslation({ namespace: "adc-auth", autoLoad: true });
	const [status, setStatus] = useState<Status>("idle");
	const [errorMsgKey, setErrorMsgKey] = useState("errorBody");
	const token = (new URLSearchParams(globalThis.location?.search).get("token") ?? "").trim();

	const handleConfirm = async () => {
		setStatus("working");
		const res = await submit(token);
		if (res.success) {
			setStatus("done");
			return;
		}
		if (res.status === 429) {
			setErrorMsgKey("tooMany");
		} else {
			setErrorMsgKey(errorMessages?.[res.errorKey ?? ""] ?? "errorBody");
		}
		setStatus("failed");
	};

	if (!ready) {
		return (
			<div className="w-full max-w-md">
				<adc-blur-panel variant="elevated" glow class="w-full">
					<adc-skeleton variant="rectangular" height="240px" />
				</adc-blur-panel>
			</div>
		);
	}

	const working = status === "working";

	return (
		<div className="w-full max-w-md">
			<adc-blur-panel variant="elevated" glow class="w-full">
				<h1 className="font-heading text-2xl font-bold text-center mb-6 text-text">
					{t(status === "done" ? `${i18nPrefix}.successTitle` : `${i18nPrefix}.title`)}
				</h1>

				{status === "done" && (
					<>
						<p className="text-base text-text text-center">{t(`${i18nPrefix}.successBody`)}</p>
						<adc-button type="button" variant="primary" class="w-full mt-8" onClick={onNavigateToLogin}>
							{t(`${i18nPrefix}.goToLogin`)}
						</adc-button>
					</>
				)}

				{status !== "done" && !token && (
					<p className="text-sm text-tdanger bg-danger/20 border border-danger/40 rounded-lg p-3">
						{t(`${i18nPrefix}.missingToken`)}
					</p>
				)}

				{status !== "done" && token && (
					<>
						<p className="text-base text-text">{t(`${i18nPrefix}.intro`)}</p>

						{status === "failed" && (
							<p className="mt-4 text-sm text-tdanger bg-danger/20 border border-danger/40 rounded-lg p-3" role="alert">
								{t(`${i18nPrefix}.${errorMsgKey}`)}
							</p>
						)}

						<adc-button
							key={working ? "loading" : "idle"}
							type="button"
							variant="primary"
							class="w-full mt-8"
							loading={working}
							disabled={working || undefined}
							onClick={handleConfirm}
						>
							{t(working ? `${i18nPrefix}.working` : `${i18nPrefix}.action`)}
						</adc-button>
					</>
				)}
			</adc-blur-panel>
		</div>
	);
}
