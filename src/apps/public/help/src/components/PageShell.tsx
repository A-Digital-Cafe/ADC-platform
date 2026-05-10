import "@ui-library/utils/react-jsx";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { router } from "@common/utils/router.js";
import { BRAND, LAST_REVIEW } from "../data/contact";

interface PageShellProps {
	title: string;
	subtitle?: string;
	standards?: string[];
	declaration?: "commitment" | "informational" | "policy";
	lastUpdated?: string;
	breadcrumb?: Array<{ label: string; href?: string }>;
	children: ReactNode;
}

const DECLARATION_LABEL: Record<NonNullable<PageShellProps["declaration"]>, string> = {
	commitment: "Compromiso público — no certificación externa",
	informational: "Información de referencia",
	policy: "Política vigente",
};

const DECLARATION_TONE = {
	commitment: "warning",
	informational: "info",
	policy: "success",
} as const satisfies Record<NonNullable<PageShellProps["declaration"]>, "info" | "warning" | "success" | "error">;

/**
 * Wrapper estable para páginas internas. Mantiene un único nodo top-level
 * para evitar que slots de Stencil (`shadow:false`) repongan hijos al re-render.
 */
export default function PageShell({ title, subtitle, standards, declaration, lastUpdated, breadcrumb, children }: PageShellProps) {
	const breadcrumbRef = useRef<HTMLElement>(null);
	const backHref = breadcrumb && breadcrumb.length > 1 ? breadcrumb[breadcrumb.length - 2]?.href : undefined;
	const breadcrumbItems = JSON.stringify(breadcrumb ?? []);

	useEffect(() => {
		const el = breadcrumbRef.current;
		if (!el) return;

		const handler = () => {
			if (backHref) router.navigate(backHref);
		};

		el.addEventListener("adcBack", handler);
		return () => el.removeEventListener("adcBack", handler);
	}, [backHref]);

	return (
		<article className="max-w-4xl mx-auto pb-16">
			{breadcrumb && breadcrumb.length > 0 && <adc-top-breadcrumb ref={breadcrumbRef} items={breadcrumbItems} back-label="Volver" />}

			<header className="mb-6">
				<h1 className="text-3xl font-heading mb-2">{title}</h1>
				{subtitle && <p className="text-lg opacity-80">{subtitle}</p>}
				<div className="flex flex-wrap gap-2 mt-3">
					{standards?.map((s) => (
						<adc-badge key={s} color="blue">
							{s}
						</adc-badge>
					))}
					{declaration && (
						<adc-badge color={declaration === "commitment" ? "orange" : declaration === "policy" ? "green" : "blue"}>
							{DECLARATION_LABEL[declaration]}
						</adc-badge>
					)}
				</div>
			</header>

			<adc-callout tone="info" role="note">
				Cuando usamos <strong>{BRAND.short}</strong>, nos referimos a <strong>{BRAND.name}</strong>, el proyecto publicado como{" "}
				<a href={BRAND.homeHref}>adigitalcafe.com</a>. La sigla es el nombre corto de la plataforma, no una certificación ni una entidad
				separada.
			</adc-callout>

			{declaration === "commitment" && (
				<adc-callout tone={DECLARATION_TONE[declaration]} role="note">
					Esta página describe un <strong>compromiso público</strong> y un roadmap. No implica certificación por un auditor externo.
					Conserva trazabilidad y se revisa periódicamente.
				</adc-callout>
			)}

			<section className="prose prose-neutral mt-6 space-y-4 contain-content">{children}</section>

			<footer className="mt-10 text-sm opacity-70">
				<p>
					{`Última actualización: `}
					<time dateTime={lastUpdated ?? LAST_REVIEW}>{lastUpdated ?? LAST_REVIEW}</time>
				</p>
			</footer>
		</article>
	);
}
