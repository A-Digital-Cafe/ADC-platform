/**
 * Genera el juego de iconos PWA de una app (`icon-192`, `icon-512`, sus dos `maskable` y
 * `apple-touch-icon`) más su `manifest.webmanifest`, a partir del glifo que la app ya usa en la
 * plataforma: el componente `adc-icon-app-<glifo>` de la UI library.
 *
 * **Estos iconos son los de INSTALAR, no el favicon.** El favicon es siempre la marca de la
 * plataforma (`/ui/images/mini-logo.webp`, cableado en el `index.html` de cada app): identifica de
 * quién es la pestaña. Estos otros distinguen una app de otra en la pantalla de inicio, que es
 * donde conviven con las apps del resto del teléfono.
 *
 * El glifo se extrae del `.tsx` del componente y no se copia a mano: si mañana cambia el icono de
 * una app, se regenera y no hay dos versiones del mismo dibujo divergiendo en silencio.
 *
 * Uso:
 *   node scripts/generate-app-icons.mjs <dir-de-la-app> <glifo> "<Nombre>" "<Nombre corto>" "<descripción>"
 *   node scripts/generate-app-icons.mjs --list      # glifos disponibles
 *
 * Ejemplo:
 *   node scripts/generate-app-icons.mjs src/apps/public/adc-auth auth "Cuenta ADC" "Cuenta" "Iniciá sesión."
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ICONS_DIR = join(ROOT, "src/apps/public/00-adc-ui-library/src/components/icons/apps");

/** Paleta del juego de iconos que ya existe en el repo (muestreada de `adc-drive`). */
const BACKGROUND = "#031d1b";
const BACKGROUND_INNER = "#1b2726";
const GLYPH = "#14b8a6";

/**
 * Paleta de la marca, para el icono de la home: es la plataforma, no una app más, así que va el
 * logo sobre el marrón cálido de su icono anterior en vez del verde del resto.
 */
const BRAND_BACKGROUND = "#281204";
const BRAND_BACKGROUND_INNER = "#3a1c08";
/** El logo va apenas apagado sobre el fondo oscuro: a plena luminosidad el blanco de la cara quema. */
const BRAND_LOGO_BRIGHTNESS = 0.88;

/** Tamaños del manifest + el de iOS. `padding` es la proporción del lienzo que ocupa el glifo. */
const OUTPUTS = [
	{ file: "icon-192.png", size: 192, glyphRatio: 0.56, rounded: true },
	{ file: "icon-512.png", size: 512, glyphRatio: 0.56, rounded: true },
	// Maskable: el sistema recorta hasta un 20% por lado, así que el glifo va más chico y el fondo
	// a sangre. Sin esta variante, Android recorta el icono normal y se come el dibujo.
	{ file: "icon-192-maskable.png", size: 192, glyphRatio: 0.42, rounded: false },
	{ file: "icon-512-maskable.png", size: 512, glyphRatio: 0.42, rounded: false },
	// iOS ignora el manifest y recorta él mismo: sin esquinas redondeadas propias y sin alfa.
	{ file: "apple-touch-icon.png", size: 180, glyphRatio: 0.56, rounded: false },
];

function listGlyphs() {
	return readdirSync(ICONS_DIR)
		.filter((d) => d.startsWith("adc-icon-app-"))
		.map((d) => d.replace("adc-icon-app-", ""))
		.sort();
}

/**
 * Saca el contenido del `<svg>` del componente Stencil. Es JSX, no SVG: hay que normalizar los
 * atributos que React/Stencil escriben en camelCase y quitar los props del componente.
 */
function extractGlyph(glyph) {
	const file = join(ICONS_DIR, `adc-icon-app-${glyph}`, `adc-icon-app-${glyph}.tsx`);
	if (!existsSync(file)) throw new Error(`No existe el componente adc-icon-app-${glyph} (probá --list)`);
	const source = readFileSync(file, "utf8");

	const open = source.indexOf("<svg");
	const close = source.indexOf("</svg>");
	if (open === -1 || close === -1) throw new Error(`No se encontró el <svg> en ${file}`);

	const svg = source.slice(open, close + "</svg>".length);
	const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 24 24";
	const inner = svg
		.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"))
		.replaceAll(/\{[^}]*\}/g, "") // props interpolados (`style={{…}}`)
		.replaceAll(/\s(class|aria-hidden)="[^"]*"/g, "")
		.replaceAll("strokeLinecap", "stroke-linecap")
		.replaceAll("strokeLinejoin", "stroke-linejoin")
		.replaceAll("strokeWidth", "stroke-width")
		.replaceAll("clipRule", "clip-rule")
		.replaceAll("fillRule", "fill-rule")
		.trim();

	return { viewBox, inner };
}

/** Fondo del icono, sin glifo: lo comparten el camino de componente y el de imagen. */
function buildBackgroundSvg(size, rounded, brand) {
	const radius = rounded ? Math.round(size * 0.22) : 0;
	const inner = brand ? BRAND_BACKGROUND_INNER : BACKGROUND_INNER;
	const outer = brand ? BRAND_BACKGROUND : BACKGROUND;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="70%">
      <stop offset="0%" stop-color="${inner}"/>
      <stop offset="100%" stop-color="${outer}"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="url(#bg)"/>
</svg>`;
}

/**
 * Icono a partir de una imagen (el logo de la plataforma, para la home). El logo va **entero**: sin
 * los puntitos de `adc-icon-apps` encima, que son el glifo del menú de apps y no la marca.
 */
async function renderFromImage({ size, glyphRatio, rounded }, imagePath) {
	// Un logo pide más lienzo que un glifo de línea: el glifo es un trazo fino que necesita aire
	// alrededor para leerse, mientras que el logo ES la figura y encogerlo lo vuelve un punto en
	// medio de un cuadrado. El ratio se escala manteniendo la proporción entre normal y maskable.
	const logoSize = Math.round(size * Math.min(glyphRatio * 1.42, 0.86));
	const offset = Math.round((size - logoSize) / 2);
	const logo = await sharp(imagePath)
		.resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.modulate({ brightness: BRAND_LOGO_BRIGHTNESS })
		.png()
		.toBuffer();
	return sharp(Buffer.from(buildBackgroundSvg(size, rounded, true)))
		.composite([{ input: logo, top: offset, left: offset }])
		.png()
		.toBuffer();
}

function buildSvg({ size, glyphRatio, rounded }, { viewBox, inner }) {
	const radius = rounded ? Math.round(size * 0.22) : 0;
	const glyphSize = Math.round(size * glyphRatio);
	const offset = Math.round((size - glyphSize) / 2);
	// `currentColor` del componente se resuelve acá: el glifo hereda `color` del grupo.
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="70%">
      <stop offset="0%" stop-color="${BACKGROUND_INNER}"/>
      <stop offset="100%" stop-color="${BACKGROUND}"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="url(#bg)"/>
  <g transform="translate(${offset} ${offset})" color="${GLYPH}">
    <svg width="${glyphSize}" height="${glyphSize}" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.5">
      ${inner}
    </svg>
  </g>
</svg>`;
}

function buildManifest({ name, shortName, description }) {
	return (
		JSON.stringify(
			{
				id: "/",
				name,
				short_name: shortName,
				description,
				start_url: "/",
				scope: "/",
				display: "standalone",
				orientation: "any",
				lang: "es",
				dir: "ltr",
				theme_color: "#ffffff",
				background_color: "#ffffff",
				categories: ["productivity"],
				icons: [
					{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
					{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
					{ src: "/icons/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
					{ src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
				],
			},
			null,
			"\t"
		) + "\n"
	);
}

async function main() {
	const args = process.argv.slice(2);
	if (args[0] === "--list") {
		console.log(listGlyphs().join("\n"));
		return;
	}
	const [appDir, glyph, name, shortName, description] = args;
	if (!appDir || !glyph || !name) {
		console.error("Uso: node scripts/generate-app-icons.mjs <dir-de-la-app> <glifo> \"<Nombre>\" [\"<Corto>\"] [\"<descripción>\"]");
		process.exit(1);
	}

	const publicDir = join(ROOT, appDir, "public");
	const iconsDir = join(publicDir, "icons");
	mkdirSync(iconsDir, { recursive: true });

	// El segundo argumento es un glifo de la UI library o la ruta de una imagen (el logo de la
	// plataforma para la home, que no es "una app más" y por eso no usa un glifo de línea).
	const isImage = /[./]/.test(glyph);
	const parsed = isImage ? null : extractGlyph(glyph);

	for (const output of OUTPUTS) {
		const png = isImage ? await renderFromImage(output, resolve(ROOT, glyph)) : await sharp(Buffer.from(buildSvg(output, parsed))).png().toBuffer();
		writeFileSync(join(iconsDir, output.file), png);
	}

	const manifestPath = join(publicDir, "manifest.webmanifest");
	writeFileSync(manifestPath, buildManifest({ name, shortName: shortName || name, description: description || name }));

	console.log(`[icons] ${appDir}: ${OUTPUTS.length} iconos + manifest (glifo '${glyph}')`);
}

await main();
