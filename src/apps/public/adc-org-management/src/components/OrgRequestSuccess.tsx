import React from "react";

interface OrgRequestSuccessProps {
	onGoHome: () => void;
	onCreateAnother: () => void;
}

/**
 * Pantalla de éxito para solicitud de organización
 * Muestra confirmación y opciones para el siguiente paso
 */
export const OrgRequestSuccess: React.FC<OrgRequestSuccessProps> = ({
	onGoHome,
	onCreateAnother,
}) => {
	return (
		<div className="flex flex-col items-center justify-center py-12">
			<div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mb-4">
				<svg className="w-8 h-8 text-tsuccess" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
			</div>
			<h2 className="text-2xl font-bold text-text mb-2">¡Solicitud enviada!</h2>
			<p className="text-center text-muted mb-6 max-w-md">
				Tu solicitud de organización ha sido creada y está pendiente de revisión por parte del equipo
				administrativo.
			</p>
			<div className="bg-success/10 border border-success/20 rounded-lg p-4 mb-8 w-full">
				<div className="text-sm text-text">
					<p className="font-semibold mb-3">¿Qué sucede ahora?</p>
					<ul className="space-y-2 text-xs">
						<li className="flex gap-2">
							<span className="text-success">✓</span>
							<span>El equipo de staff revisará tu solicitud.</span>
						</li>
						<li className="flex gap-2">
							<span className="text-success">✓</span>
							<span>Serás notificado por email cuando tu organización sea aprobada o rechazada</span>
						</li>
					</ul>
				</div>
			</div>

			{/* Action Buttons */}
			<div className="flex gap-3 w-full justify-center">
				<adc-button type="button" onClick={onGoHome} variant="primary">
					Ir al Home
				</adc-button>
				<adc-button type="button" onClick={onCreateAnother} >
					Otra Solicitud
				</adc-button>
			</div>
		</div>
	);
};
