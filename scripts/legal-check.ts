/**
 * Verifica que cada documento legal desplegado siga siendo el que su versión sella.
 *
 * Reemplaza al hook `pre-commit` de `presets/help`, que hacía lo mismo pero escribiendo en el repo
 * raíz desde otro repo y sólo si alguien se había acordado de correr `git config core.hooksPath
 * .githooks` en ese clon — o sea, no corría justo donde importaba. Esto no tiene estado, no toca
 * git y anda en cualquier clon y en CI.
 *
 * Criterio, que es el mismo que aplica el panel:
 *  - hash igual → nada que hacer;
 *  - hash distinto y el documento **todavía no rige** → aviso: alcanza con actualizar el
 *    `contentHash`, porque versionar pediría re-aceptar algo que nadie aceptó;
 *  - hash distinto y el documento **ya rige** → error: editarlo obliga a versionar con preaviso;
 *  - preaviso menor al comprometido en los Términos → error.
 *
 * Uso: `bun scripts/legal-check.ts` (va dentro de `bun run extra-checks`).
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	LEGAL_DOCUMENTS,
	MIN_LEGAL_NOTICE_DAYS,
	isInCorrectionWindow,
	legalNoticeDays,
	nextLegalVersionDates,
	type LegalDocument,
} from "../src/common/utils/legal-docs.ts";

const ROOT = path.join(import.meta.dir, "..");

const problems: string[] = [];
const warnings: string[] = [];

async function hashOf(doc: LegalDocument): Promise<string | null> {
	try {
		return createHash("sha256")
			.update(await readFile(path.join(ROOT, doc.sourcePath)))
			.digest("hex");
	} catch {
		return null;
	}
}

for (const doc of Object.values(LEGAL_DOCUMENTS) as LegalDocument[]) {
	const notice = legalNoticeDays(doc);
	if (notice < MIN_LEGAL_NOTICE_DAYS) {
		problems.push(
			`${doc.label} ${doc.version}: rige desde ${doc.effectiveFrom}, ${notice} día(s) de preaviso ` +
				`(los Términos comprometen ${MIN_LEGAL_NOTICE_DAYS}).`
		);
	}

	const deployed = await hashOf(doc);
	if (deployed === null) {
		// El preset puede no estar en un clon parcial: no es un error del documento.
		warnings.push(`${doc.label}: no se pudo leer ${doc.sourcePath} (¿preset ausente?).`);
		continue;
	}
	if (deployed === doc.contentHash) continue;

	if (isInCorrectionWindow(doc)) {
		warnings.push(
			`${doc.label}: el texto cambió y el hash sellado quedó viejo. Todavía no rige (${doc.effectiveFrom}), ` +
				`así que alcanza con corregir en src/common/utils/legal-docs.ts:\n` +
				`      contentHash: "${deployed}"\n` +
				`      …y sumar la corrección a "corrections".`
		);
	} else {
		const next = nextLegalVersionDates();
		problems.push(
			`${doc.label}: el texto cambió DESPUÉS de entrar en vigor (${doc.effectiveFrom}). Hay que versionar en ` +
				`src/common/utils/legal-docs.ts:\n` +
				`      version: "${next.version}"\n` +
				`      effectiveFrom: "${next.effectiveFrom}"\n` +
				`      contentHash: "${deployed}"`
		);
	}
}

console.log(`🔎 Documentos legales verificados: ${Object.keys(LEGAL_DOCUMENTS).length}.`);

for (const w of warnings) console.log(`\n⚠️  ${w}`);

if (problems.length === 0) {
	console.log(warnings.length === 0 ? "\n✅ Todos coinciden con su hash sellado." : "\n✅ Sin bloqueos: lo de arriba se corrige sin versionar.");
	process.exit(0);
}

console.error("\n❌ Documentos legales que exigen una decisión:\n");
for (const p of problems) console.error(`  · ${p}\n`);
process.exit(1);
