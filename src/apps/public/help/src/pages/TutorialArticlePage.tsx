import "@ui-library/utils/react-jsx";
import { useEffect, useState } from "react";
import { getPlatformApps } from "@ui-library/utils/platform-links";
import { fetchAppTutorials, fetchTutorialMarkdown, type TutorialMeta } from "@ui-library/utils/tutorials";
import { markdownToBlocks, type MarkdownBlock } from "@ui-library/utils/markdown-blocks";
import PageShell from "../components/PageShell";

interface TutorialArticleState {
	status: "loading" | "ready" | "missing";
	meta?: TutorialMeta;
	blocks?: MarkdownBlock[];
}

/**
 * Un tutorial concreto: carga el `.md` desde el origen de la app que lo
 * publica y lo renderiza con `adc-blocks-renderer` (estilos y chips de
 * platform-link incluidos).
 */
export function TutorialArticlePage({ appId, slug }: Readonly<{ appId: string; slug: string }>) {
	const [state, setState] = useState<TutorialArticleState>({ status: "loading" });
	const app = getPlatformApps().find((candidate) => candidate.id === appId);

	useEffect(() => {
		if (!app) {
			setState({ status: "missing" });
			return;
		}
		let cancelled = false;
		setState({ status: "loading" });
		Promise.all([fetchAppTutorials(app), fetchTutorialMarkdown(app, slug)]).then(([tutorials, markdown]) => {
			if (cancelled) return;
			const meta = tutorials.find((tutorial) => tutorial.slug === slug);
			if (!meta || markdown === null) {
				setState({ status: "missing" });
				return;
			}
			setState({ status: "ready", meta, blocks: markdownToBlocks(markdown) });
		});
		return () => {
			cancelled = true;
		};
	}, [appId, slug]);

	const breadcrumb = [
		{ label: "Inicio", href: "/" },
		{ label: "Tutoriales", href: "/tutorials" },
		...(app ? [{ label: app.label, href: `/tutorials#${app.id}` }] : []),
		{ label: state.meta?.title || "Tutorial" },
	];

	if (state.status === "missing") {
		return (
			<PageShell title="Tutorial no encontrado" breadcrumb={breadcrumb}>
				<p>
					Este tutorial no existe o ya no está publicado. Volvé al <a href="/tutorials">listado de tutoriales</a>.
				</p>
			</PageShell>
		);
	}

	if (state.status === "loading") {
		return (
			<PageShell title="Cargando tutorial…" breadcrumb={breadcrumb}>
				<div className="space-y-3 animate-pulse" aria-busy="true">
					{[1, 2, 3].map((n) => (
						<div key={n} className="h-4 rounded bg-alt/60" style={{ width: `${100 - n * 15}%` }} />
					))}
				</div>
			</PageShell>
		);
	}

	const meta = state.meta as TutorialMeta;
	return (
		<PageShell title={meta.title} subtitle={meta.description} breadcrumb={breadcrumb}>
			{meta.minutes !== undefined && (
				<p className="text-sm text-muted">
					Lectura estimada: <strong>{meta.minutes} min</strong>
					{app && (
						<>
							{" · "}
							Aplicación: <strong>{app.label}</strong>
						</>
					)}
				</p>
			)}
			<adc-blocks-renderer blocks={state.blocks || []} />
		</PageShell>
	);
}
