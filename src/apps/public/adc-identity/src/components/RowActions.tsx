interface RowActionsProps<T> {
	readonly item: T;
	readonly canEdit?: boolean;
	readonly canDelete?: boolean;
	readonly canManageMembers?: boolean;
	readonly canBan?: boolean;
	readonly isBanned?: boolean;
	readonly onEdit?: (item: T) => void;
	readonly onDelete?: (item: T) => void;
	readonly onManageMembers?: (item: T) => void;
	readonly onBan?: (item: T) => void;
	readonly onUnban?: (item: T) => void;
	readonly editLabel: string;
	readonly deleteLabel: string;
	readonly membersLabel?: string;
	readonly banLabel?: string;
	readonly unbanLabel?: string;
}

export function RowActions<T>({
	item,
	canEdit,
	canDelete,
	canManageMembers,
	canBan,
	isBanned,
	onEdit,
	onDelete,
	onManageMembers,
	onBan,
	onUnban,
	editLabel,
	deleteLabel,
	membersLabel,
	banLabel,
	unbanLabel,
}: RowActionsProps<T>) {
	if (!canEdit && !canDelete && !canManageMembers && !canBan) {
		return undefined;
	}
	return (
		<>
			{canManageMembers && onManageMembers && membersLabel && (
				<adc-button-rounded aria-label={membersLabel} onClick={() => onManageMembers(item)}>
					<adc-icon-members />
				</adc-button-rounded>
			)}
			{canEdit && onEdit && (
				<adc-button-rounded aria-label={editLabel} onClick={() => onEdit(item)}>
					<adc-icon-edit />
				</adc-button-rounded>
			)}
			{canBan && !isBanned && onBan && banLabel && (
				<adc-button-rounded variant="danger" aria-label={banLabel} onClick={() => onBan(item)}>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="10" />
						<line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
					</svg>
				</adc-button-rounded>
			)}
			{canBan && isBanned && onUnban && unbanLabel && (
				<adc-button-rounded aria-label={unbanLabel} onClick={() => onUnban(item)}>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<rect x="3" y="11" width="18" height="11" rx="2" />
						<path d="M7 11V7a5 5 0 0 1 9.9-1" />
					</svg>
				</adc-button-rounded>
			)}
			{canDelete && onDelete && (
				<adc-button-rounded variant="danger" aria-label={deleteLabel} onClick={() => onDelete(item)}>
					<adc-icon-trash />
				</adc-button-rounded>
			)}
		</>
	);
}
