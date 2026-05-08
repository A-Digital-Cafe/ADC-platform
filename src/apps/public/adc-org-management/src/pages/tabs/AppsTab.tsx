import "@ui-library/utils/react-jsx";
import type { Organization } from "../../utils/org-api.js";

interface AppsTabProps {
	org: Organization;
	onSave?: () => void;
}

/**
 * Tab de aplicaciones para gestionar qué apps están habilitadas en la organización
 * TODO: Implementar cuando backend esté listo con endpoints de apps
 */
export default function AppsTab({ org }: AppsTabProps) {
	return (
		<div className="space-y-6">
			{/* Header */}
			<div>
				<h2 className="text-2xl font-bold text-text mb-1">Aplicaciones</h2>
				<p className="text-muted">Gestiona las aplicaciones habilitadas en tu organización</p>
			</div>

			{/* Placeholder */}
			<div className="bg-info/10 border border-info/20 rounded-lg p-6">
				<div className="flex gap-4">
					<div className="text-3xl">📱</div>
					<div className="flex-1">
						<h3 className="font-semibold text-text mb-2">Próximamente</h3>
						<p className="text-sm text-text mb-4">
							Aquí podrás activar o desactivar aplicaciones para tu organización.
							<br />
							Esta funcionalidad estará disponible pronto.
						</p>
						<p className="text-xs text-muted">
							Organización: <code className="bg-background px-2 py-1 rounded">{org.slug}</code>
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}