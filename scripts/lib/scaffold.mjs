import fs from 'node:fs';
import path from 'node:path';
import { resolveModuleDir } from './safe-path.mjs';

/**
 * Esqueleto común de los scripts `create:*`: valida el argumento, resuelve el
 * directorio destino de forma segura y escribe package.json, index.ts y
 * (si aplica) modules.json. Lo específico de cada capa — label, baseDir y
 * template del index — entra por opciones.
 */
export function scaffoldModule({ label, command, baseDir, indexTemplate, withModulesJson = false }) {
	const name = process.argv[2];
	if (!name) {
		console.error(`Usage: npm run ${command} -- <${label.toLowerCase()}-name>`);
		process.exit(1);
	}

	const toPascalCase = (str) =>
		str.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');

	let dir;
	try {
		dir = resolveModuleDir(name, path.resolve(process.cwd(), baseDir));
	} catch (err) {
		console.error(`Error: ${err.message}`);
		process.exit(1);
	}

	if (fs.existsSync(dir)) {
		console.error(`Error: Directory ${dir} already exists.`);
		process.exit(1);
	}

	fs.mkdirSync(dir, { recursive: true });

	const packageJson = {
		name: `@adc-platform/${name}`,
		type: 'module',
		dependencies: {},
	};
	fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');

	if (withModulesJson) {
		const modulesJson = {
			failOnError: false,
			providers: [],
			utilities: [],
			services: [],
		};
		fs.writeFileSync(path.join(dir, 'modules.json'), JSON.stringify(modulesJson, null, 2) + '\n');
	}

	fs.writeFileSync(path.join(dir, 'index.ts'), indexTemplate(toPascalCase(name), name));

	console.log(`✅ ${label} "${name}" created at ${path.relative(process.cwd(), dir)}`);
}
