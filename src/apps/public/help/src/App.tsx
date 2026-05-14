import "@ui-library/utils/react-jsx";
import { useEffect, useRef, useState } from "react";
import { router } from "@common/utils/router.js";
import { HomePage } from "./pages/HomePage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { CookiesPage } from "./pages/CookiesPage";
import { TermsPage } from "./pages/TermsPage";
import { ValuesPage } from "./pages/ValuesPage";
import { EthicsPage } from "./pages/EthicsPage";
import { HriaPage } from "./pages/HriaPage";
import { AuthorityRequestsPage } from "./pages/AuthorityRequestsPage";
import { TransparencyPage } from "./pages/TransparencyPage";
import { ContactPage } from "./pages/ContactPage";
import { RoadmapPage } from "./pages/RoadmapPage";
import { NotFoundPage } from "./pages/NotFoundPage";

const HELP_ROUTES = new Set([
	"/",
	"/privacy",
	"/cookies",
	"/terms",
	"/values",
	"/ethics",
	"/hria",
	"/authority-requests",
	"/transparency",
	"/contact",
	"/roadmap",
]);

interface RouteState {
	path: string;
	hash: string;
}

function readRouteFromLocation(): RouteState {
	return { path: globalThis.location?.pathname || "/", hash: globalThis.location?.hash || "" };
}

function parseRoute(path: string): RouteState {
	const [pathname, fragment] = path.split("#");
	return { path: pathname || "/", hash: fragment ? `#${fragment}` : "" };
}

function scrollToHash(hash: string) {
	if (!hash) {
		globalThis.scrollTo?.({ top: 0, left: 0 });
		return;
	}

	const targetId = decodeURIComponent(hash.slice(1));
	globalThis.requestAnimationFrame(() => {
		globalThis.document?.getElementById(targetId)?.scrollIntoView({ block: "start" });
	});
}

function renderPage(path: string) {
	switch (path) {
		case "/":
			return <HomePage />;
		case "/privacy":
			return <PrivacyPage />;
		case "/cookies":
			return <CookiesPage />;
		case "/terms":
			return <TermsPage />;
		case "/values":
			return <ValuesPage />;
		case "/ethics":
			return <EthicsPage />;
		case "/hria":
			return <HriaPage />;
		case "/authority-requests":
			return <AuthorityRequestsPage />;
		case "/transparency":
			return <TransparencyPage />;
		case "/contact":
			return <ContactPage />;
		case "/roadmap":
			return <RoadmapPage />;
		default:
			return <NotFoundPage />;
	}
}

export default function App() {
	const [currentRoute, setCurrentRoute] = useState(readRouteFromLocation);
	const contentRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const syncFromLocation = () => setCurrentRoute(readRouteFromLocation());
		const stopRouter = router.setOnRouteChange((path) => setCurrentRoute(parseRoute(path)));

		globalThis.addEventListener("popstate", syncFromLocation);
		globalThis.addEventListener("hashchange", syncFromLocation);

		return () => {
			stopRouter();
			globalThis.removeEventListener("popstate", syncFromLocation);
			globalThis.removeEventListener("hashchange", syncFromLocation);
		};
	}, []);

	useEffect(() => {
		const content = contentRef.current;
		if (!content) return;

		const handleInternalLinkClick = (event: MouseEvent) => {
			if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			if (!(event.target instanceof Element)) return;

			const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
			if (!anchor || anchor.target || anchor.hasAttribute("download")) return;

			const url = new URL(anchor.href, globalThis.location?.href);
			if (url.origin !== globalThis.location?.origin || !HELP_ROUTES.has(url.pathname)) return;

			event.preventDefault();
			if (globalThis.location?.pathname !== url.pathname || globalThis.location?.hash !== url.hash) {
				globalThis.history?.pushState({}, "", `${url.pathname}${url.hash}`);
			}
			setCurrentRoute({ path: url.pathname, hash: url.hash });
		};

		content.addEventListener("click", handleInternalLinkClick);
		return () => content.removeEventListener("click", handleInternalLinkClick);
	}, []);

	useEffect(() => {
		scrollToHash(currentRoute.hash);
	}, [currentRoute]);

	return (
		<adc-layout>
			<div ref={contentRef} className="px-6 sm:px-8 mt-8">
				<div className="animate-slide-in" key={currentRoute.path}>
					{renderPage(currentRoute.path)}
				</div>
			</div>
		</adc-layout>
	);
}
