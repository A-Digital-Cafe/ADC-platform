import { useEffect, useState } from "react";
import { router } from "@common/utils/router.js";
import { getSession, type SessionData } from "@ui-library/utils/session";
import { canManageOrganizations } from "../utils/permissions.js";

interface Props {
	readonly children: React.ReactNode;
}

export function AdminGate({ children }: Props) {
	const [session, setSession] = useState<SessionData | null>(null);
	const [allowed, setAllowed] = useState<boolean | null>(null);

	useEffect(() => {
		getSession().then((s) => {
			setSession(s);
			const perms = s.user?.perms;
			const isAdmin = canManageOrganizations(perms);
			setAllowed(isAdmin);
		});
	}, []);

	if (allowed === null) {
		return (
			<adc-layout>
				<div className="flex items-center justify-center min-h-screen">
					<p className="text-center text-muted">Verificando permisos...</p>
				</div>
			</adc-layout>
		);
	}

	if (!allowed) {
		return (
			<adc-layout>
				<div className="flex items-center justify-center min-h-screen">
					<div className="bg-error/10 border border-error/20 text-error p-6 rounded-lg max-w-md text-center">
						<h2 className="font-bold mb-2">Acceso denegado</h2>
						<p className="mb-4 text-sm">No tienes permisos para acceder al panel administrativo.</p>
						<adc-button type="button" onClick={() => router.navigate("/")}>
							Volver al inicio
						</adc-button>
					</div>
				</div>
			</adc-layout>
		);
	}

	return <>{children}</>;
}
