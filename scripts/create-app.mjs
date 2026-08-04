import { scaffoldModule } from './lib/scaffold.mjs';

scaffoldModule({
	label: 'App',
	command: 'create:app',
	baseDir: 'src/apps',
	withConfigJson: true,
	indexTemplate: (className) => `import { BaseApp } from '../../BaseApp.js';

export default class ${className} extends BaseApp {
	async run() {
		this.logger.logInfo('${className} is running!');
	}
}
`,
});
