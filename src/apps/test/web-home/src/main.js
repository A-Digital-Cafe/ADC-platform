import HomeApp from './App.js';
import "@ui-library"; // Auto-registra Web Components
import "@ui-library/styles"; // CSS base de la UI Library
import "./styles/tailwind.css"; // Extensiones locales

// Crear instancia de la app
const app = new HomeApp();

// Montar la app en el contenedor root
const container = document.getElementById('root');
if (container) {
	app.mount(container);
} else {
	console.error('[Home] No se encontró el contenedor #root');
}

// HMR para desarrollo.
// `import.meta.webpackHot` se guarda en una variable en vez de usarse dos veces: una sentencia que
// EMPIEZA con `import` hace que algunos parsers (el extractor de CodeQL, entre otros) la lean como
// una declaración de import y fallen en el `.` siguiente. Dentro de una expresión no hay ambigüedad.
const webpackHot = import.meta.webpackHot;
if (webpackHot) {
	webpackHot.accept('./App.js', async () => {
		console.log('[Home] 🔥 HMR Update');
		app.unmount();
		const NewApp = (await import('./App.js')).default;
		const newApp = new NewApp();
		newApp.mount(container);
	});
}

