// ============================================
// UI LIBRARY - Componentes compartidos
// ============================================

declare module '@ui-library/components/Container.js' {
	import React from 'react';
	export const Container: React.FC<{ children?: React.ReactNode; className?: string }>;
}

declare module '@ui-library/components/Header.js' {
	import React from 'react';
	export const Header: React.FC<{ title?: string; subtitle?: string; actions?: React.ReactNode; children?: React.ReactNode }>;
}

declare module '@ui-library/components/PrimaryButton.js' {
	import React from 'react';
	export const PrimaryButton: React.FC<{
		onClick?: () => void;
		children?: React.ReactNode;
		disabled?: boolean;
	}>;
}

declare module '@ui-library/components/StatCard.js' {
	import React from 'react';
	export const StatCard: React.FC<{
		title?: string;
		value?: string | number;
		description?: string;
		color?: string;
		icon?: React.ReactNode;
	}>;
}

declare module '@ui-library/utils/router' {
	export class Router {
		navigate(path: string): void;
		setOnRouteChange(callback: (path: string) => void): () => void;
		getCurrentPath(): string;
	}
	export const router: Router;
}

// ============================================
// MODULE FEDERATION - Apps remotas
// ============================================

declare module 'home/App' {
	import React from 'react';
	const App: React.FC;
	export default App;
}

declare module 'users-management/App' {
	import React from 'react';
	const App: React.FC;
	export default App;
}

declare module 'config/App' {
	import React from 'react';
	const App: React.FC;
	export default App;
}

// ============================================
// LEGACY - Import maps (por si se usan)
// ============================================

declare module '@home' {
	import React from 'react';
	const component: React.FC;
	export default component;
}

declare module '@config' {
	import React from 'react';
	const component: React.FC;
	export default component;
}

declare module '@users-management' {
	import React from 'react';
	const component: React.FC;
	export default component;
}

declare module '@layout' {
	import React from 'react';
	const component: React.FC;
	export default component;
}

