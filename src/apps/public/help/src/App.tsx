import "@ui-library/utils/react-jsx";
import { useEffect, useState } from "react";
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
	const [currentPath, setCurrentPath] = useState(globalThis.location?.pathname || "/");

	useEffect(() => {
		return router.setOnRouteChange(setCurrentPath);
	}, []);

	return (
		<adc-layout>
			<div className="px-6 sm:px-8 mt-8">
				<div className="animate-slide-in" key={currentPath}>
					{renderPage(currentPath)}
				</div>
			</div>
		</adc-layout>
	);
}
