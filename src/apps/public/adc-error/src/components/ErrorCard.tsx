import React from "react";
import { getUrl } from "@common/utils/url-utils.js";

const AUTH_URL = getUrl(3012, "auth.adigitalcafe.com", "/login");
const HOME_URL = getUrl(3024, "adigitalcafe.com");

interface ErrorCardProps {
	readonly icon: string;
	readonly title: string;
	readonly subtitle?: string;
	readonly description?: string;
	readonly hint?: string;
	readonly tone?: "danger" | "warning" | "info";
	readonly children?: React.ReactNode;
}

const TONE_STYLES: Record<NonNullable<ErrorCardProps["tone"]>, string> = {
	danger: "text-error",
	warning: "text-warning",
	info: "text-accent",
};

export function ErrorCard({ icon, title, subtitle, description, hint, tone = "danger", children }: ErrorCardProps) {
	return (
		<div className="w-full max-w-lg">
			<adc-blur-panel variant="elevated" glow class="w-full">
				<div className="text-center">
					<div className={`text-6xl mb-4 ${TONE_STYLES[tone]}`} aria-hidden="true">
						{icon}
					</div>
					<h1 className="font-heading text-2xl font-bold mb-2 text-text">{title}</h1>
					{subtitle && <p className="text-base text-muted mb-4">{subtitle}</p>}
					{description && (
						<p className="text-sm text-text/80 mb-4 whitespace-pre-line wrap-break-word" data-testid="error-description">
							{description}
						</p>
					)}
					{children}
					{hint && <p className="text-xs text-muted mt-6">{hint}</p>}
				</div>
				<div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
					<a href={AUTH_URL} className="text-accent hover:underline text-sm font-medium">
						Volver al inicio de sesión
					</a>
					<span className="hidden sm:inline text-muted">·</span>
					<a href={HOME_URL} className="text-accent hover:underline text-sm font-medium">
						Ir a adigitalcafe.com
					</a>
				</div>
			</adc-blur-panel>
		</div>
	);
}
