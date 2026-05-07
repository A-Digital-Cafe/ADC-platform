import { useEffect, useState } from "react";
import { router } from "@common/utils/router.js";
import { getSession, type SessionResponse } from "@ui-library/utils/session";
import { canEditContent, canPublish } from "../../utils/permissions";

interface Props {
	readonly children: (session: SessionResponse, isReviewer: boolean) => React.ReactNode;
	readonly requirePublish?: boolean;
}

export function AdminGate({ children, requirePublish = false }: Props) {
	const [session, setSession] = useState<SessionResponse | null>(null);
	const [allowed, setAllowed] = useState<boolean | null>(null);
	const [reviewer, setReviewer] = useState(false);

	useEffect(() => {
		getSession().then((s) => {
			setSession(s);
			const perms = s.user?.perms;
			const isReviewer = canPublish(perms);
			setReviewer(isReviewer);
			const ok = requirePublish ? isReviewer : canEditContent(perms) || isReviewer;
			setAllowed(ok);
		});
	}, [requirePublish]);

	if (allowed === null) return <p className="text-center py-8 text-muted">Verificando permisos...</p>;
	if (!allowed) {
		return (
			<div className="bg-twarn text-warn p-6 rounded-xxl max-w-xl mx-auto mt-8">
				<p className="mb-4">No tienes permiso para acceder a esta página.</p>
				<button type="button" onClick={() => router.navigate("/")} className="px-4 py-2 bg-button text-tprimary rounded-xxl">
					Volver al inicio
				</button>
			</div>
		);
	}
	return <>{children(session as SessionResponse, reviewer)}</>;
}
