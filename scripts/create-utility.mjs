import { scaffoldModule } from './lib/scaffold.mjs';

scaffoldModule({
	label: 'Utility',
	command: 'create:utility',
	baseDir: 'src/utilities',
	indexTemplate: (className, name) => `import { BaseUtility } from '../BaseUtility';

export default class ${className} extends BaseUtility {
  public name = "${name}";
}
`,
});
