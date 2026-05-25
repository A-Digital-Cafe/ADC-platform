import "@ui-library/utils/react-jsx";
import { useEffect, useState } from "react";
import { ErrorLayout } from "./components/ErrorLayout.tsx";
import { BannedPage } from "./pages/BannedPage.tsx";
import { CsrfPage } from "./pages/CsrfPage.tsx";
import { OAuthErrorPage } from "./pages/OAuthErrorPage.tsx";
import { GenericErrorPage } from "./pages/GenericErrorPage.tsx";

type Page = "banned" | "csrf" | "oauth" | "generic";

const PATH_TO_PAGE: Record<string, Page> = {
	"/banned": "banned",
	"/csrf": "csrf",
	"/oauth": "oauth",
};

function resolvePage(): Page {
	const path = globalThis.location?.pathname ?? "/";
	return PATH_TO_PAGE[path] ?? "generic";
}

export default function App() {
	const [page, setPage] = useState<Page>("generic");

	useEffect(() => {
		setPage(resolvePage());
		const onPop = () => setPage(resolvePage());
		globalThis.addEventListener("popstate", onPop);
		return () => globalThis.removeEventListener("popstate", onPop);
	}, []);

	return (
		<ErrorLayout>
			{page === "banned" && <BannedPage />}
			{page === "csrf" && <CsrfPage />}
			{page === "oauth" && <OAuthErrorPage />}
			{page === "generic" && <GenericErrorPage />}
		</ErrorLayout>
	);
}
