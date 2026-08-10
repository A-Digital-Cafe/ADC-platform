interface Props {
	readonly offset: number;
	readonly shown: number;
	/** Conteo real del filtro: la paginación es limit/offset, así que sin el total no hay "siguiente". */
	readonly total: number;
	readonly onOffset: (next: number) => void;
	readonly pageSize: number;
}

/** Paginador Anterior/Siguiente calculado sobre el total (el listado no devuelve cursor). */
export function OverridesPager({ offset, shown, total, onOffset, pageSize }: Props) {
	return (
		<div className="flex items-center justify-between gap-3 text-sm text-muted">
			<span>
				{offset + 1}–{offset + shown} de {total}
			</span>
			<div className="flex gap-2">
				<adc-button
					size="small"
					variant="accent-outlined"
					label="Anterior"
					disabled={offset === 0}
					onClick={() => onOffset(Math.max(0, offset - pageSize))}
				/>
				<adc-button
					size="small"
					variant="accent-outlined"
					label="Siguiente"
					disabled={offset + shown >= total}
					onClick={() => onOffset(offset + pageSize)}
				/>
			</div>
		</div>
	);
}
