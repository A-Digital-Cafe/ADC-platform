import { useEffect, useState } from "react";
import { router } from "@common/utils/router.js";
import { getSession, type SessionData } from "@ui-library/utils/session";

interface Props {
	readonly children: React.ReactNode;
}

export function AuthGate({ children }: Props) {
	const [session, setSession] = useState<SessionData | null>(null);
	const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

	useEffect(() => {
		getSession().then((s) => {
			setSession(s);
			const authenticated = !!s?.user?.id;
			setIsAuthenticated(authenticated);
		});
	}, []);

	if (isAuthenticated === null) {
		return (
			<adc-layout>
				<div className="flex items-center justify-center min-h-screen">
					<p className="text-center text-muted">Verificando sesión...</p>
				</div>
			</adc-layout>
		);
	}

	if (!isAuthenticated) {
		return (
			<div className="flex items-center justify-center min-h-screen">
				<div className="bg-warning/10 border border-warning/20 text-warning p-6 rounded-lg max-w-md text-center">
					<h2 className="font-bold mb-2">Se requiere autenticación</h2>
					<p className="mb-4 text-sm">Debes iniciar sesión para solicitar una organización.</p>
				</div>
			</div>
		);
	}

	return <>{children}</>;
}
