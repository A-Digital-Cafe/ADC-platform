import { scaffoldModule } from './lib/scaffold.mjs';

scaffoldModule({
	label: 'Service',
	command: 'create:service',
	baseDir: 'src/services',
	withModulesJson: true,
	indexTemplate: (className, name) => `import { BaseService } from '../BaseService';

export default class ${className} extends BaseService {
  public readonly name = "${name}";
}
`,
});
