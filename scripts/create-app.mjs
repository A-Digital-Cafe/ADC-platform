import fs from 'node:fs';
import path from 'node:path';
import { resolveModuleDir } from './lib/safe-path.mjs';

const name = process.argv[2];
if (!name) {
  console.error('Usage: npm run create:app -- <app-name>');
  process.exit(1);
}

const toPascalCase = (str) =>
	str.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');

let dir;
try {
	dir = resolveModuleDir(name, path.resolve(process.cwd(), 'src/apps'));
} catch (err) {
	console.error(`Error: ${err.message}`);
	process.exit(1);
}

if (fs.existsSync(dir)) {
	console.error(`Error: Directory ${dir} already exists.`);
	process.exit(1);
}

fs.mkdirSync(dir, { recursive: true });

const className = toPascalCase(name);
const indexContent = `import { BaseApp } from '../BaseApp';

export default class ${className} extends BaseApp {
	async run() {
		this.logger.logInfo('${className} is running!');
	}
}
`;

const packageJson = {
  name: `@adc-platform/${name}`,
  type: "module",
  dependencies: {},
};

const modulesJson = {
  failOnError: false,
  providers: [],
  utilities: [],
  services: [],
};

fs.writeFileSync(
  path.join(dir, 'package.json'),
  JSON.stringify(packageJson, null, 2) + '\n'
);

fs.writeFileSync(
  path.join(dir, 'modules.json'),
  JSON.stringify(modulesJson, null, 2) + '\n'
);

fs.writeFileSync(path.join(dir, 'index.ts'), indexContent);


console.log(`✅ App "${name}" created at ${path.relative(process.cwd(), dir)}`);
