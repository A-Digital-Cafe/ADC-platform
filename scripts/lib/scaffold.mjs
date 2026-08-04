import fs from 'node:fs';
import path from 'node:path';
import { resolveModuleDir } from './safe-path.mjs';

/**
 * Esqueleto común de los scripts `create:*`: valida el argumento, resuelve el
 * directorio destino de forma segura y escribe package.json, index.ts y
 * (si aplica) config.json. Lo específico de cada capa — label, baseDir y
 * template del index — entra por opciones.
 */
export function scaffoldModule({ label, command, baseDir, indexTemplate, withConfigJson = false }) {
	const arg = process.argv[2];
	const root = path.resolve(process.cwd(), baseDir);
	// Los módulos viven agrupados por categoría (`public/`, `core/`, `object/`, …), nunca
	// como hijo directo de la capa: sin grupo, el kernel no encontraría el módulo.
	const groups = fs.existsSync(root)
		? fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
		: [];
	if (!arg?.includes('/')) {
		console.error(`Usage: bun run ${command} -- <group>/<${label.toLowerCase()}-name>`);
		if (groups.length) console.error(`Grupos existentes en ${baseDir}: ${groups.join(', ')}`);
		process.exit(1);
	}

	const name = arg.split('/').pop();
	const toPascalCase = (str) =>
		str.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');

	let dir;
	try {
		dir = resolveModuleDir(arg, root);
	} catch (err) {
		console.error(`Error: ${err.message}`);
		process.exit(1);
	}

	const group = path.basename(path.dirname(dir));
	if (!groups.includes(group)) {
		console.warn(`⚠️  "${group}" no existe en ${baseDir}: se crea como categoría nueva.`);
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

	// `config.json` es el nombre que leen los loaders; un `modules.json` no lo lee nadie.
	if (withConfigJson) {
		const configJson = {
			failOnError: false,
			providers: [],
			utilities: [],
			services: [],
		};
		fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(configJson, null, 2) + '\n');
	}

	fs.writeFileSync(path.join(dir, 'index.ts'), indexTemplate(toPascalCase(name), name));

	// README por módulo: es requisito de la plataforma (CLAUDE.md, máx 15 líneas). Sin este
	// esqueleto, cada módulo nuevo arranca incumpliéndolo y el checklist de la capa se
	// descubre recién en review.
	fs.writeFileSync(
		path.join(dir, 'README.md'),
		`# ${name}\n\n` +
			`_(completar)_ qué hace este ${label.toLowerCase()} y qué expone (máx. 15 líneas).\n\n` +
			`- Dependencias: declararlas en \`config.json\` (\`providers\`/\`utilities\`/\`services\`); ` +
			`se resuelven por nombre con \`getMyProvider\`/\`getMyService\`/\`getMyUtility\`.\n` +
			`- Paquetes npm: \`package.json\` de este directorio (workspace propio).\n`
	);

	console.log(`✅ ${label} "${name}" created at ${path.relative(process.cwd(), dir)}`);
	console.log(`   Siguiente paso: leer docs/structure/README.md (plantilla + checklist de la capa) y completar README.md.`);
}
