import "@ui-library/utils/react-jsx";
import type { Organization } from "../../utils/org-api.js";

interface GeneralTabProps {
	org: Organization;
	onUpdate?: (org: Organization) => void;
}

export default function GeneralTab({ org }: GeneralTabProps) {
	return (
		<div className="space-y-6">
			{/* Header */}
			<div>
				<h2 className="text-2xl font-bold text-text mb-1">General</h2>
				<p className="text-muted">Información general de tu organización</p>
			</div>

			{/* Organization Info Container */}
			<div className="space-y-6">
				{/* Logo and Name Section */}
				<div className="bg-surface rounded-xxl p-8 border border-border">
					<div className="flex flex-col md:flex-row gap-8 items-start md:items-center">
						{/* Logo */}
							<div className="shrink-0">
							<img
							src={org.logo}
							alt={org.name}
								className="w-32 h-32 rounded-xl object-cover border border-border shadow-sm"
							/>
						</div>

						{/* Organization Details */}
						<div className="flex-1 space-y-4">
							<div>
								<p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1">Nombre de la Organización</p>
								<h1 className="text-3xl font-bold text-text">{org.name}</h1>
							</div>

							<div>
								<p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1">Slug</p>
								<p className="text-lg text-text font-mono bg-background px-3 py-2 rounded-lg w-fit">
									{org.slug}
								</p>
							</div>

							<div className="flex gap-4 pt-2">
								<adc-button type="button">
									Cambiar Logo
								</adc-button>
								<adc-button type="button">
									Editar Nombre
								</adc-button>
							</div>
						</div>
					</div>
				</div>

				{/* Description Section */}
				<div className="bg-surface rounded-xxl p-8 border border-border">
					<div className="mb-4">
						<h3 className="text-lg font-semibold text-text mb-1">Descripción</h3>
						<p className="text-muted text-sm">Información sobre tu organización</p>
					</div>

					<div className="bg-background rounded-lg p-4 border border-border mb-4">
						<p className="text-text leading-relaxed">{org.description}</p>
					</div>

				<adc-button type="button">
						Editar Descripción
					</adc-button>
				</div>

				{/* Website Section */}
				<div className="bg-surface rounded-xxl p-8 border border-border">
					<div className="mb-4">
						<h3 className="text-lg font-semibold text-text mb-1">Sitio Web</h3>
						<p className="text-muted text-sm">URL oficial de tu organización</p>
					</div>

					<div className="flex flex-col gap-4">
						<div className="bg-background rounded-lg p-4 border border-border">
							<a
								href={org.url}
								target="_blank"
								rel="noopener noreferrer"
								className="text-primary hover:underline font-mono text-sm break-all"
							>
								{org.url}
							</a>
						</div>

					<adc-button type="button">
							Cambiar URL
						</adc-button>
					</div>
				</div>

				{/* Email Section */}
				<div className="bg-surface rounded-xxl p-8 border border-border">
					<div className="mb-4">
						<h3 className="text-lg font-semibold text-text mb-1">Email de Contacto</h3>
						<p className="text-muted text-sm">Email principal de la organización</p>
					</div>

					<div className="flex flex-col gap-4">
						<div className="bg-background rounded-lg p-4 border border-border">
							<a
								href={`mailto:${org.email}`}
								className="text-primary hover:underline font-mono text-sm"
							>
								{org.email}
							</a>
						</div>

					<adc-button type="button">
							Cambiar Email
						</adc-button>
					</div>
				</div>

				{/* Social Networks Section */}
				{org.socialNetworks && org.socialNetworks.length > 0 && (
					<div className="bg-surface rounded-xxl p-8 border border-border">
						<div className="mb-6">
							<h3 className="text-lg font-semibold text-text mb-1">Redes Sociales</h3>
							<p className="text-muted text-sm">Canales de comunicación de tu organización</p>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							{org.socialNetworks.map((social, idx) => (
								<a
									key={idx}
									href={social.url}
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center gap-4 p-4 rounded-lg border border-border bg-background hover:border-primary hover:bg-primary/5 transition group"
								>
									<div className="text-3xl shrink-0">{social.icon}</div>
									<div className="flex-1 min-w-0">
										<p className="font-semibold text-text capitalize group-hover:text-primary transition">
											{social.platform}
										</p>
										<p className="text-sm text-muted truncate">{social.url.replace(/^https?:\/\/(www\.)?/, "")}</p>
									</div>
									<div className="shrink-0 opacity-0 group-hover:opacity-100 transition">
										<svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth={2}
												d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
											/>
										</svg>
									</div>
								</a>
							))}
						</div>

						<adc-button type="button" class="mt-6">
							Editar Redes Sociales
						</adc-button>
					</div>
				)}

				{/* Owner Section */}
				<div className="bg-surface rounded-xxl p-8 border border-border">
					<div className="mb-4">
						<h3 className="text-lg font-semibold text-text mb-1">Propietario</h3>
						<p className="text-muted text-sm">Creador y administrador de la organización</p>
					</div>

					<div className="flex items-center gap-4 bg-background rounded-lg p-4">
									<div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
							<span className="text-lg font-semibold text-primary">
								{org.createdByEmail?.charAt(0).toUpperCase() || "?"}
							</span>
						</div>

						<div className="flex-1 min-w-0">
							<p className="text-sm font-semibold text-text truncate">{org.createdByEmail || "Unknown"}</p>
							<p className="text-xs text-muted">Usuario que creo la org</p>
						</div>
					</div>
				</div>

				{/* Metadata Section */}
				<div className="bg-surface rounded-xxl p-8 border border-border">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						<div>
							<p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">ID de Organización</p>
							<p className="text-text font-mono bg-background px-3 py-2 rounded-lg text-sm">
								{org.id}
							</p>
						</div>

						<div>
							<p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Creada el</p>
							<p className="text-text">
								{new Date(org.createdAt).toLocaleDateString("es-ES", {
									year: "numeric",
									month: "long",
									day: "numeric",
									hour: "2-digit",
									minute: "2-digit",
								})}
							</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}