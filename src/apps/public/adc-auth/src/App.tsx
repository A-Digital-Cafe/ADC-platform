import "@ui-library/utils/react-jsx";
import { useState, useEffect } from "react";
import { Login } from "./pages/Login.tsx";
import { Register } from "./pages/Register.tsx";
import { LinkAccount } from "./pages/LinkAccount.tsx";
import { TwoFactorChallenge } from "./pages/TwoFactorChallenge.tsx";
import { AuthLayout } from "./components/AuthLayout.tsx";
import { TokenActionPage } from "./components/TokenActionPage.tsx";
import { identityPublicApi } from "./utils/auth-api.ts";
import { DEFAULT_RETURN_URL, sanitizeReturnUrl } from "./utils/safe-url.ts";

type Page = "login" | "register" | "cancel-deletion" | "confirm-email" | "link-account" | "two-factor";

function getReturnUrl(): string {
	const params = new URLSearchParams(globalThis.location?.search);
	return sanitizeReturnUrl(params.get("returnUrl"));
}

/** Rutas de la app. `/cancel-deletion` y `/confirm-email` canjean tokens que llegan por email. */
function pageFromPath(path: string | undefined): Page {
	switch (path) {
		case "/register":
			return "register";
		case "/cancel-deletion":
			return "cancel-deletion";
		case "/confirm-email":
			return "confirm-email";
		case "/link-account":
			return "link-account";
		// Acá aterriza el callback OAuth cuando la cuenta necesita el segundo factor.
		case "/two-factor":
			return "two-factor";
		default:
			return "login";
	}
}

export default function App() {
	const [page, setPage] = useState<Page>("login");
	const [returnUrl, setReturnUrl] = useState<string>(DEFAULT_RETURN_URL);

	useEffect(() => {
		setReturnUrl(getReturnUrl());
		setPage(pageFromPath(globalThis.location?.pathname));

		const handlePopState = () => {
			setPage(pageFromPath(globalThis.location?.pathname));
			setReturnUrl(getReturnUrl());
		};

		globalThis.addEventListener("popstate", handlePopState);
		return () => globalThis.removeEventListener("popstate", handlePopState);
	}, []);

	// `to` es un literal del tipo `Page`, no viene de input → no es taint.
	const navigate = (to: Page) => {
		const search = returnUrl && returnUrl !== DEFAULT_RETURN_URL ? `?returnUrl=${encodeURIComponent(returnUrl)}` : "";
		globalThis.history.pushState({}, "", `/${to}${search}`);
		setPage(to);
	};

	let content;
	if (page === "cancel-deletion") {
		content = (
			<TokenActionPage i18nPrefix="cancelDeletion" submit={identityPublicApi.cancelDeletion} onNavigateToLogin={() => navigate("login")} />
		);
	} else if (page === "confirm-email") {
		content = (
			<TokenActionPage
				i18nPrefix="confirmEmail"
				submit={identityPublicApi.confirmEmailChange}
				errorMessages={{ EMAIL_EXISTS: "emailTaken" }}
				onNavigateToLogin={() => navigate("login")}
			/>
		);
	} else if (page === "link-account") {
		content = <LinkAccount onNavigateToLogin={() => navigate("login")} />;
	} else if (page === "two-factor") {
		content = <TwoFactorChallenge returnUrl={returnUrl} onNavigateToLogin={() => navigate("login")} />;
	} else if (page === "register") {
		content = <Register onNavigateToLogin={() => navigate("login")} returnUrl={returnUrl} />;
	} else {
		content = <Login onNavigateToRegister={() => navigate("register")} returnUrl={returnUrl} />;
	}

	return <AuthLayout>{content}</AuthLayout>;
}
