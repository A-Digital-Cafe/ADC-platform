import { scaffoldModule } from './lib/scaffold.mjs';

scaffoldModule({
	label: 'App',
	command: 'create:app',
	baseDir: 'src/apps',
	withModulesJson: true,
	indexTemplate: (className) => `import { BaseApp } from '../BaseApp';

export default class ${className} extends BaseApp {
	async run() {
		this.logger.logInfo('${className} is running!');
	}
}
`,
});
