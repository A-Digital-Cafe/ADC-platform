import { Component, Prop, State, Host } from "@stencil/core";

/**
 * Lista de códigos de recuperación de un solo uso, con copiar y descargar.
 *
 * Los textos llegan por props en vez de traducirse acá: la librería de UI no carga namespaces de
 * i18n, y quien la usa (adc-auth y my-account) ya los tiene resueltos.
 *
 * @example
 * <adc-recovery-codes codes='["ABCDE-12345", "..."]' copy-label="Copiar" download-label="Descargar" />
 */
@Component({
	tag: "adc-recovery-codes",
	shadow: false,
})
export class AdcRecoveryCodes {
	/** Códigos en claro, como array JSON (los custom elements no reciben arrays por atributo). */
	@Prop() codes: string = "[]";

	@Prop() copyLabel: string = "Copiar";
	@Prop() copiedLabel: string = "Copiado";
	@Prop() downloadLabel: string = "Descargar";
	/** Nombre del archivo de la descarga. */
	@Prop() filename: string = "codigos-de-recuperacion.txt";

	@State() private copied = false;

	private get parsedCodes(): string[] {
		try {
			const value = JSON.parse(this.codes);
			return Array.isArray(value) ? value.map(String) : [];
		} catch {
			return [];
		}
	}

	private get asText(): string {
		return this.parsedCodes.join("\n");
	}

	private readonly handleCopy = async () => {
		await navigator.clipboard.writeText(this.asText);
		this.copied = true;
		setTimeout(() => (this.copied = false), 2000);
	};

	private readonly handleDownload = () => {
		// `URL.createObjectURL` y no un `data:` URI: la CSP de las apps restringe los esquemas de
		// navegación, y el blob se revoca en el acto para no dejarlo colgado del documento.
		const url = URL.createObjectURL(new Blob([this.asText], { type: "text/plain" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = this.filename;
		link.click();
		URL.revokeObjectURL(url);
	};

	render() {
		const codes = this.parsedCodes;
		if (codes.length === 0) return <Host />;

		return (
			<Host class="block">
				<ul class="grid grid-cols-2 gap-2 bg-surface-alt rounded-lg p-4 list-none">
					{codes.map((code) => (
						<li key={code} class="font-mono text-sm text-center tracking-wider text-text select-all">
							{code}
						</li>
					))}
				</ul>

				<div class="flex gap-3 justify-center mt-4">
					<button
						type="button"
						onClick={this.handleCopy}
						class="text-accent hover:underline text-sm cursor-pointer"
						aria-live="polite"
					>
						{this.copied ? this.copiedLabel : this.copyLabel}
					</button>
					<button type="button" onClick={this.handleDownload} class="text-accent hover:underline text-sm cursor-pointer">
						{this.downloadLabel}
					</button>
				</div>
			</Host>
		);
	}
}
