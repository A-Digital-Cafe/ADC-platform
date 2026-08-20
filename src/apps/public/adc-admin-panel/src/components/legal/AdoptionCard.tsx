import type { LegalAdoption } from "../../utils/legal-api.ts";

interface Props {
	readonly adoption: LegalAdoption | null;
}

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

/**
 * Cuántas cuentas cubren la versión vigente.
 *
 * El número que importa es `pendingSeen`: quien entró después de la fecha de vigencia vio el gate
 * de re-aceptación sí o sí, así que seguir sin aceptar es una decisión y no un olvido. Es la única
 * señal de que un cambio legal cayó mal, y hasta ahora no se medía en ningún lado.
 */
export function AdoptionCard({ adoption }: Props) {
	if (!adoption) {
		return (
			<adc-callout tone="info" role="status">
				No se pudieron leer las cifras de aceptación: el servicio de identidad no respondió. El resto de la pantalla sirve igual.
			</adc-callout>
		);
	}

	const accepted = pct(adoption.accepted, adoption.total);
	// Antes de la vigencia nadie vio el gate, así que "pendiente" es el estado normal y el número
	// no dice nada sobre cómo cayó el cambio. Sin esta línea, 1.579 pendientes parecen un problema.
	const enforced = Date.parse(adoption.enforcedFrom) <= Date.now();

	return (
		<section className="rounded-lg border border-border p-4">
			<header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
				<h3 className="font-heading text-base font-semibold text-text">Aceptación de la versión vigente</h3>
				<span className="text-xs text-muted">
					Términos {adoption.termsVersion} · Privacidad {adoption.privacyVersion} · calculado el{" "}
					{new Date(adoption.computedAt).toLocaleString()}
				</span>
			</header>

			<div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-surface" role="img" aria-label={`${accepted}% aceptó`}>
				<div className="h-full bg-primary" style={{ width: `${accepted}%` }} />
			</div>

			{!enforced && (
				<adc-callout tone="info" class="mb-3 block" role="status">
					Esta versión todavía no rige (lo hace el {adoption.enforcedFrom}), así que a nadie se le pidió aceptarla: lo esperable es que casi
					todas las cuentas figuren pendientes. El número recién dice algo a partir de esa fecha.
				</adc-callout>
			)}

			<dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
				<div className="flex justify-between">
					<dt className="text-muted">Aceptaron</dt>
					<dd className="text-text">
						{adoption.accepted} <span className="text-muted">({accepted}%)</span>
					</dd>
				</div>
				<div className="flex justify-between">
					<dt className="text-muted">Pendientes</dt>
					<dd className="text-text">
						{adoption.pending} <span className="text-muted">({pct(adoption.pending, adoption.total)}%)</span>
					</dd>
				</div>
				<div className="flex justify-between sm:col-start-2">
					<dt className="pl-4 text-muted">· vieron el aviso y no aceptaron</dt>
					<dd className="text-text">{enforced ? adoption.pendingSeen : "—"}</dd>
				</div>
				<div className="flex justify-between sm:col-start-2">
					<dt className="pl-4 text-muted">· no volvieron a entrar</dt>
					<dd className="text-text">{enforced ? adoption.pendingDormant : "—"}</dd>
				</div>
			</dl>

			<p className="mt-3 border-t border-border pt-2 text-xs text-muted">
				Sobre {adoption.total} cuentas activas. Las {adoption.deleting} con baja programada quedan fuera del cálculo. Son contadores: la
				pantalla no lista personas.
			</p>
		</section>
	);
}
