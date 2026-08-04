import { scaffoldModule } from './lib/scaffold.mjs';

scaffoldModule({
	label: 'Service',
	command: 'create:service',
	baseDir: 'src/services',
	withConfigJson: true,
	indexTemplate: (className, name) => `import { BaseService } from '../../BaseService.js';

export default class ${className} extends BaseService {
  public readonly name = "${name}";
}
`,
});
