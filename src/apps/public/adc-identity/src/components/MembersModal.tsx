import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { identityApi } from "../utils/identity-api.ts";
import type { ClientUser } from "@common/types/identity/User.js";
import { clearErrors } from "@ui-library/utils/adc-fetch";

interface MembersModalProps {
	readonly title: string;
	readonly searchPlaceholder: string;
	readonly noMembersText: string;
	readonly entityId: string;
	readonly orgId?: string;
	readonly onClose: () => void;
	readonly fetchMembers: (entityId: string) => Promise<ClientUser[]>;
	readonly onAddMember: (entityId: string, userId: string) => Promise<boolean>;
	readonly onRemoveMember: (entityId: string, userId: string) => Promise<boolean>;
}

export function MembersModal({
	title,
	searchPlaceholder,
	noMembersText,
	entityId,
	orgId,
	onClose,
	fetchMembers,
	onAddMember,
	onRemoveMember,
}: MembersModalProps) {
	const { t } = useTranslation({ namespace: "adc-identity", autoLoad: true });
	const [members, setMembers] = useState<ClientUser[]>([]);
	const [loadingMembers, setLoadingMembers] = useState(false);
	const [userSearchResults, setUserSearchResults] = useState<ClientUser[]>([]);
	const [userSearching, setUserSearching] = useState(false);
	const [addingMember, setAddingMember] = useState(false);

	const modalRef = useCallback((el: HTMLElement | null) => {
		if (el) el.addEventListener("adcClose", onClose);
	}, []);

	const loadMembers = useCallback(async () => {
		setLoadingMembers(true);
		const data = await fetchMembers(entityId);
		setMembers(data || []);
		setLoadingMembers(false);
	}, [entityId, fetchMembers]);

	useEffect(() => {
		loadMembers();
	}, [loadMembers]);

	const handleAddMember = async (userId: string) => {
		clearErrors();
		setAddingMember(true);
		const success = await onAddMember(entityId, userId);
		if (success) {
			setUserSearchResults((prev) => prev.filter((u) => u.id !== userId));
			loadMembers();
		}
		setAddingMember(false);
	};

	const handleUserSearch = useCallback(
		async (query: string) => {
			if (!query || query.length < 2) {
				setUserSearchResults([]);
				return;
			}
			setUserSearching(true);
			const res = await identityApi.searchUsers(query, orgId);
			if (res.success && res.data) setUserSearchResults(res.data);
			setUserSearching(false);
		},
		[orgId]
	);

	const userSearchRef = useCallback(
		(el: HTMLElement | null) => {
			if (el) el.addEventListener("adcInput", (e: Event) => handleUserSearch((e as CustomEvent<string>).detail));
		},
		[handleUserSearch]
	);

	const handleRemoveMember = async (userId: string) => {
		clearErrors();
		const success = await onRemoveMember(entityId, userId);
		if (success) loadMembers();
	};

	return (
		<adc-modal ref={modalRef} open modalTitle={title} size="md">
			<div className="space-y-4">
				<div className="relative">
					<adc-search-input ref={userSearchRef} placeholder={searchPlaceholder} debounce={350} />
					{(userSearchResults.length > 0 || userSearching) && (
						<div className="absolute z-20 left-0 right-0 mt-1 bg-background border border-surface rounded-xl shadow-lg max-h-48 overflow-y-auto">
							{userSearching ? (
								<div className="flex justify-center py-3">
									<adc-spinner />
								</div>
							) : (
								userSearchResults
									.filter((u) => !members.some((m) => m.id === u.id))
									.map((user) => (
										<button
											key={user.id}
											type="button"
											className="w-full text-left px-3 py-2 hover:bg-surface/50 transition-colors cursor-pointer flex items-center justify-between"
											onClick={() => handleAddMember(user.id)}
											disabled={addingMember}
										>
											<adc-user-summary username={user.username} email={user.email} />
											<adc-icon-plus size="1rem" />
										</button>
									))
							)}
						</div>
					)}
				</div>

				{loadingMembers ? (
					<div className="flex justify-center py-4">
						<adc-spinner />
					</div>
				) : members.length === 0 ? (
					<p className="text-sm text-muted py-2">{noMembersText}</p>
				) : (
					<ul className="divide-y divide-surface">
						{members.map((member) => (
							<li key={member.id} className="flex items-center justify-between py-2">
								<adc-user-summary username={member.username} email={member.email} />
								<adc-button-rounded
									variant="danger"
									aria-label={t("common.delete")}
									onClick={() => handleRemoveMember(member.id)}
									size="md"
								>
									<adc-icon-close size="0.875rem" />
								</adc-button-rounded>
							</li>
						))}
					</ul>
				)}
			</div>
			<div slot="footer" className="flex justify-end">
				<adc-button variant="accent" onClick={onClose}>
					{t("common.close")}
				</adc-button>
			</div>
		</adc-modal>
	);
}
