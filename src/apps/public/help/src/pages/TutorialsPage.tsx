import "@ui-library/utils/react-jsx";
import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { fetchTutorialsCatalog, type AppTutorials } from "@ui-library/utils/tutorials";
import PageShell from "../components/PageShell";

/** Icono de la app si su tag existe en la UI library; fallback genérico. */
function AppIcon({ iconTag }: Readonly<{ iconTag?: string }>) {
	if (iconTag) {
		// Tag dinámico de Web Component: para JSX/React es solo un string en runtime.
		const IconTag = iconTag as unknown as ComponentType<{ size?: string; "aria-hidden"?: string }>;
		return <IconTag size="1.5rem" aria-hidden="true" />;
	}
	return (
		<span aria-hidden="true" className="text-xl leading-none">
			📘
		</span>
	);
}

function TutorialList({ entry }: Readonly<{ entry: AppTutorials }>) {
	return (
		<section id={entry.app.id} aria-label={`Tutoriales de ${entry.app.label}`} className="mt-8 scroll-mt-24">
			<h2 className="text-2xl font-heading mb-3 flex items-center gap-2">
				<AppIcon iconTag={entry.app.iconTag} />
				{entry.app.label}
			</h2>
			<ul className="grid gap-3 sm:grid-cols-2 list-none p-0">
				{entry.tutorials.map((tutorial) => (
					<li key={tutorial.slug}>
						<a
							href={`/tutorials/${entry.app.id}/${tutorial.slug}`}
							className="block h-full rounded-xxl border border-alt p-4 no-underline transition-colors hover:bg-alt/40"
						>
							<span className="flex items-baseline justify-between gap-2">
								<strong className="text-text">{tutorial.title}</strong>
								{tutorial.minutes !== undefined && <span className="shrink-0 text-xs text-muted">{tutorial.minutes} min</span>}
							</span>
							{tutorial.description && <span className="mt-1 block text-sm text-muted">{tutorial.description}</span>}
						</a>
					</li>
				))}
			</ul>
		</section>
	);
}

/**
 * Hub de tutoriales: descubre los `public/tutorials/index.json` que publica
 * cada microfront (vía el registry de platform-links) y los lista agrupados
 * por app. Las apps sin tutoriales se omiten sin error.
 */
export function TutorialsPage() {
	const [catalog, setCatalog] = useState<AppTutorials[] | null>(null);

	useEffect(() => {
		let cancelled = false;
		fetchTutorialsCatalog().then((entries) => {
			if (!cancelled) setCatalog(entries);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<PageShell
			title="Tutoriales"
			subtitle="Guías breves para empezar a usar cada aplicación de la plataforma."
			declaration="informational"
			breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Tutoriales" }]}
		>
			{catalog === null && (
				<div className="grid gap-3 sm:grid-cols-2 animate-pulse" aria-busy="true" aria-label="Cargando tutoriales">
					{[1, 2, 3, 4].map((n) => (
						<div key={n} className="h-24 rounded-xxl border border-alt bg-alt/40" />
					))}
				</div>
			)}

			{catalog !== null && catalog.length === 0 && (
				<adc-callout tone="info" role="status">
					Todavía no hay tutoriales publicados. Volvé a intentarlo más tarde.
				</adc-callout>
			)}

			{catalog !== null && catalog.length > 0 && (
				<nav aria-label="Apps con tutoriales" className="flex flex-wrap gap-2">
					{catalog.map((entry) => (
						<a
							key={entry.app.id}
							href={`#${entry.app.id}`}
							className="rounded border border-alt px-2 py-1 text-sm no-underline hover:bg-alt/40"
						>
							{entry.app.label}
						</a>
					))}
				</nav>
			)}

			{catalog?.map((entry) => <TutorialList key={entry.app.id} entry={entry} />)}
		</PageShell>
	);
}
