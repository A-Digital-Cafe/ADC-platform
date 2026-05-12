import "@ui-library/utils/react-jsx";
import { useState, useEffect } from "react";
import { router } from "@common/utils/router.js";
import { HomePage } from "./pages/HomePage";
import { PathsPage } from "./pages/PathsPage";
import { PathPage } from "./pages/PathPage";
import { ArticlesPage } from "./pages/ArticlesPage";
import { ArticlePage } from "./pages/ArticlePage";
import { AdminArticlesPage } from "./pages/admin/AdminArticlesPage";
import { AdminArticleEditPage } from "./pages/admin/AdminArticleEditPage";
import { AdminPublishPage } from "./pages/admin/AdminPublishPage";
import { AdminPathsPage } from "./pages/admin/AdminPathsPage";
import HeaderNav from "./components/HeaderNav";

export default function App() {
	const [currentPath, setCurrentPath] = useState(globalThis.location?.pathname || "/");

	useEffect(() => {
		return router.setOnRouteChange(setCurrentPath);
	}, []);

	function renderPage() {
		if (currentPath.startsWith("/admin/articles/")) {
			const slug = currentPath.slice(16).split("?")[0];
			return slug ? <AdminArticleEditPage slug={slug} /> : <AdminArticlesPage />;
		}
		if (currentPath === "/admin/articles") return <AdminArticlesPage />;
		if (currentPath === "/admin/publish") return <AdminPublishPage />;
		if (currentPath === "/admin/paths" || currentPath.startsWith("/admin/paths?")) return <AdminPathsPage />;
		if (currentPath.startsWith("/paths/")) {
			const slug = currentPath.slice(7).split("?")[0];
			return slug ? <PathPage slug={slug} /> : <PathsPage />;
		}
		if (currentPath === "/paths") return <PathsPage />;
		if (currentPath.startsWith("/articles/")) {
			const slug = currentPath.slice(10).split("?")[0];
			return slug ? <ArticlePage slug={slug} /> : <ArticlesPage />;
		}
		if (currentPath === "/articles") return <ArticlesPage />;
		return <HomePage />;
	}

	return (
		<adc-layout>
			<div slot="header">
				<HeaderNav />
			</div>

			<div className="px-8 mt-8 animate-slide-in">{renderPage()}</div>
		</adc-layout>
	);
}
