import { useEffect, useState } from "react";
import { router } from "@common/utils/router.js";
import { contentAPI, type LearningPath } from "../utils/content-api";

export function PathsPage() {
	const [paths, setPaths] = useState<LearningPath[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		loadPaths();
	}, []);

	async function loadPaths() {
		setLoading(true);
		setError(null);

		try {
			const pathsData = await contentAPI.listPaths({ public: true, listed: true });
			setPaths(pathsData);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Error desconocido");
		} finally {
			setLoading(false);
		}
	}

	if (loading) {
		return (
			<div className="px-8">
				<div className="text-center py-8">
					<p>Cargando rutas de aprendizaje...</p>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="px-8">
				<div className="text-center py-8 text-adc-danger-600">
					<p>Error cargando rutas: {error}</p>
					<button type="button" onClick={loadPaths} className="mt-4 px-4 py-2 bg-button text-white rounded-adc">
						Reintentar
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="px-8">
			<h1 className="text-4xl font-heading mb-2 gap-4">Learning Paths</h1>

			{paths.length > 0 ? (
				<div className="grid gap-16 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 my-4">
					{paths.map((path) => (
						<adc-content-card
							key={path.slug}
							title={path.title}
							description={path.description}
							banner-url={path.banner?.url}
							banner-alt={path.banner?.alt}
							href={`/paths/${path.slug}`}
							onClick={(e: React.MouseEvent) => {
								e.preventDefault();
								router.navigate(`/paths/${path.slug}`);
							}}
						/>
					))}
				</div>
			) : (
				<div className="text-center bg-surface rounded-xxl p-8 shadow-cozy my-4">
					<p className="text-text">No hay paths todavía.</p>
				</div>
			)}
		</div>
	);
}
