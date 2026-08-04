import { scaffoldModule } from './lib/scaffold.mjs';

scaffoldModule({
	label: 'Provider',
	command: 'create:provider',
	baseDir: 'src/providers',
	indexTemplate: (className, name) => `import { BaseProvider } from '../../BaseProvider.js';

export default class ${className} extends BaseProvider {
	public readonly name = "${name}";
}
`,
});
