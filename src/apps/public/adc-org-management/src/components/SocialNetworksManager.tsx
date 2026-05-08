import React from "react";
import type { SocialNetwork } from "../utils/org-api.js";

interface SocialNetworksManagerProps {
	socialNetworks: Omit<SocialNetwork, "icon">[];
	onAddSocialNetwork: () => void;
	onRemoveSocialNetwork: (idx: number) => void;
	onSocialNetworkChange: (idx: number, field: "platform" | "url", value: string) => void;
}

/**
 * Componente gestor de redes sociales
 * Maneja: agregar, eliminar y editar redes sociales
 */
export const SocialNetworksManager: React.FC<SocialNetworksManagerProps> = ({
	socialNetworks,
	onAddSocialNetwork,
	onRemoveSocialNetwork,
	onSocialNetworkChange,
}) => {
	return (
		<div className="space-y-4 border-t border-border pt-6">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-sm font-semibold text-text">Redes Sociales</h3>
					<p className="text-xs text-muted mt-1">Agrega canales de comunicación</p>
				</div>
				<adc-button type="button" onClick={onAddSocialNetwork} class="px-3! py-2! text-sm!">
					+ Agregar
				</adc-button>
			</div>

			{/* Social Networks List */}
			{socialNetworks.length > 0 && (
				<div className="space-y-3">
					{socialNetworks.map((social, idx) => (
						<div key={idx} className="flex gap-3 items-end p-4 rounded-lg border border-border bg-background">
							{/* Platform Select */}
							<div className="flex-1 min-w-0">
								<label className="block text-xs font-semibold text-text mb-2">Plataforma</label>
								<select
									value={social.platform}
									onChange={(e) => onSocialNetworkChange(idx, "platform", e.target.value)}
									className="w-full px-3 py-2 rounded-lg border border-border bg-background text-text focus:outline-none focus:ring-2 focus:ring-primary transition"
								>
									<option value="twitter">𝕏 Twitter / X</option>
									<option value="linkedin">💼 LinkedIn</option>
									<option value="instagram">📸 Instagram</option>
									<option value="facebook">👍 Facebook</option>
									<option value="github">🐙 GitHub</option>
									<option value="discord">💬 Discord</option>
									<option value="youtube">📺 YouTube</option>
									<option value="tiktok">🎵 TikTok</option>
								</select>
							</div>

							{/* URL Input */}
							<div className="flex-1 min-w-0">
								<label className="block text-xs font-semibold text-text mb-2">URL</label>
								<input
									type="url"
									placeholder="https://..."
									value={social.url}
									onChange={(e) => onSocialNetworkChange(idx, "url", e.target.value)}
									className="w-full px-3 py-2 rounded-lg border border-border bg-background text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary transition"
								/>
							</div>

							{/* Remove Button */}
							<button
								type="button"
								onClick={() => onRemoveSocialNetwork(idx)}
								className="w-10 h-10 flex items-center justify-center rounded-lg border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20 transition"
								title="Eliminar red social"
							>
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
									/>
								</svg>
							</button>
						</div>
					))}
				</div>
			)}

			{socialNetworks.length === 0 && (
				<p className="text-xs text-muted italic">
					Sin redes sociales agregadas aún. Haz clic en "Agregar" para añadir canales de comunicación.
				</p>
			)}
		</div>
	);
};
