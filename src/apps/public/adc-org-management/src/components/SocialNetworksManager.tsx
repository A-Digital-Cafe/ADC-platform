import React, { useRef, useEffect } from "react";
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
 * Usa componentes adc-input de la librería UI
 */
export const SocialNetworksManager: React.FC<SocialNetworksManagerProps> = ({
	socialNetworks,
	onAddSocialNetwork,
	onRemoveSocialNetwork,
	onSocialNetworkChange,
}) => {
	const inputRefs = useRef<Map<string, any>>(new Map());

	// Setup event listeners para adc-input components
	useEffect(() => {
		const unsubscribers: Array<() => void> = [];

		socialNetworks.forEach((_, idx) => {
			["platform", "url"].forEach((field) => {
				const ref = inputRefs.current.get(`${field}-${idx}`);
				if (ref) {
					const handler = (e: CustomEvent<string>) => {
						onSocialNetworkChange(idx, field as "platform" | "url", e.detail);
					};
					ref.addEventListener("adcChange", handler);
					unsubscribers.push(() => ref.removeEventListener("adcChange", handler));
				}
			});
		});

		return () => {
			unsubscribers.forEach((unsub) => unsub());
		};
	}, [socialNetworks, onSocialNetworkChange]);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-sm font-semibold text-text">Redes Sociales</h3>
					<p className="text-xs text-muted mt-1">Agrega canales de comunicación</p>
				</div>
				<adc-button type="button" onClick={onAddSocialNetwork} class="px-3! py-2! text-sm!">
					<adc-icon-plus></adc-icon-plus> Agregar
				</adc-button>
			</div>

			{/* Social Networks List */}
			{socialNetworks.length > 0 && (
				<div className="space-y-3">
					{socialNetworks.map((social, idx) => (
						<div key={idx} className="flex gap-3 items-end p-4 rounded-lg border border-border bg-background">
							{/* Platform Input */}
							<div className="flex-1 min-w-0">
								<adc-input
									ref={(el: any) => {
										if (el) inputRefs.current.set(`platform-${idx}`, el);
									}}
									inputId={`social-platform-${idx}`}
									name={`social-platform-${idx}`}
									type="text"
									placeholder="ej: Twitter, LinkedIn, TikTok, Tumblr..."
									value={social.platform}
								/>
							</div>

							{/* URL Input */}
							<div className="flex-1 min-w-0">
								<adc-input
									ref={(el: any) => {
										if (el) inputRefs.current.set(`url-${idx}`, el);
									}}
									inputId={`social-url-${idx}`}
									name={`social-url-${idx}`}
									type="url"
									placeholder="https://..."
									value={social.url}
								/>
							</div>

							{/* Remove Button */}
							<button
								type="button"
								onClick={() => onRemoveSocialNetwork(idx)}
								className="w-10 h-10 flex items-center justify-center rounded-lg border border-tdanger/50 bg-danger/10 text-tdanger/50 hover:bg-danger/20 transition"
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
