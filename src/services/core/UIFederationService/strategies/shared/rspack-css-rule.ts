/**
 * Construye el bloque `rules` para archivos `.css` en configs de Rspack.
 * - Si `postcssConfigPath` está presente, agrega `postcss-loader` apuntando a esa config.
 * - Caso contrario, usa `style-loader` + `css-loader` planos.
 *
 * El resultado es un fragmento de código (string) que se inyecta dentro de
 * `module.rules` en la config generada de rspack.
 */
export function buildCssRule(postcssConfigPath: string): string {
	if (postcssConfigPath) {
		const normalizedPath = postcssConfigPath.replaceAll("\\", "/");
		return String.raw`
            {
                test: /\.css$/,
                use: [
                    'style-loader',
                    'css-loader',
                    {
                        loader: 'postcss-loader',
                        options: {
                            postcssOptions: {
                                config: '${normalizedPath}',
                            },
                        },
                    },
                ],
                type: 'javascript/auto',
            }`;
	}

	return String.raw`
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader'],
                type: 'javascript/auto',
            }`;
}
