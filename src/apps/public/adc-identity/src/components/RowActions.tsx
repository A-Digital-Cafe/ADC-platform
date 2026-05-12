interface RowActionsProps<T> {
	readonly item: T;
	readonly canEdit?: boolean;
	readonly canDelete?: boolean;
	readonly canManageMembers?: boolean;
	readonly onEdit?: (item: T) => void;
	readonly onDelete?: (item: T) => void;
	readonly onManageMembers?: (item: T) => void;
	readonly editLabel: string;
	readonly deleteLabel: string;
	readonly membersLabel?: string;
}

export function RowActions<T>({
	item,
	canEdit,
	canDelete,
	canManageMembers,
	onEdit,
	onDelete,
	onManageMembers,
	editLabel,
	deleteLabel,
	membersLabel,
}: RowActionsProps<T>) {
	if (!canEdit && !canDelete && !canManageMembers) {
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
			{canDelete && onDelete && (
				<adc-button-rounded variant="danger" aria-label={deleteLabel} onClick={() => onDelete(item)}>
					<adc-icon-trash />
				</adc-button-rounded>
			)}
		</>
	);
}
