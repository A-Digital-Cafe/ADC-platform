import { Component, Prop } from "@stencil/core";

@Component({
	tag: "adc-share-buttons",
	shadow: false,
})
export class AdcShareButtons {
	@Prop({ attribute: "title" }) sharingTitle: string = "";
	@Prop() description: string = "";
	@Prop() url: string = "";

	private getEncodedText(): string {
		return encodeURIComponent(`${this.sharingTitle}\n\n${this.description}\n\n${this.url}`);
	}

	private getLinkedInUrl(): string {
		return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(this.url)}`;
	}

	private getTwitterUrl(): string {
		return `https://twitter.com/intent/tweet?text=${this.getEncodedText()}`;
	}

	private getThreadsUrl(): string {
		return `https://www.threads.net/intent/post?text=${this.getEncodedText()}`;
	}

	render() {
		return (
			<div class="flex gap-2 text-[16px] text-tprimary">
				<a
					href={this.getLinkedInUrl()}
					target="_blank"
					rel="noopener noreferrer"
					title="Compartir en LinkedIn"
					aria-label="Compartir en LinkedIn (se abre en ventana nueva)"
					class="bg-primary rounded-full p-3"
				>
					<svg viewBox="0 0 24 24" fill="currentColor" class="md:w-6 md:h-6 w-8 h-8">
						<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
					</svg>
				</a>
				<a
					href={this.getTwitterUrl()}
					target="_blank"
					rel="noopener noreferrer"
					title="Compartir en X"
					aria-label="Compartir en X (se abre en ventana nueva)"
					class="bg-primary rounded-full p-3"
				>
					<svg viewBox="0 0 24 24" fill="currentColor" class="md:w-6 md:h-6 w-8 h-8">
						<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
					</svg>
				</a>
				<a
					href={this.getThreadsUrl()}
					target="_blank"
					rel="noopener noreferrer"
					title="Compartir en Threads"
					aria-label="Compartir en Threads (se abre en ventana nueva)"
					class="bg-primary rounded-full p-3"
				>
					<svg viewBox="0 0 24 24" fill="currentColor" class="md:w-6 md:h-6 w-8 h-8">
						<path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.59 12c.025 3.086.718 5.496 2.057 7.164 1.432 1.781 3.632 2.695 6.54 2.717 1.986-.013 3.758-.477 5.268-1.38 1.727-1.033 2.879-2.55 3.42-4.505.463-1.67.56-3.525.285-5.509l2.009-.39c.32 2.296.2 4.476-.354 6.475-.697 2.512-2.137 4.49-4.283 5.878-1.82 1.178-4.012 1.793-6.52 1.828l-.028-.278z" />
						<path d="M12.666 18.04c-2.397-.088-4.046-.755-4.9-1.983-.84-1.208-.93-2.746-.267-4.58.634-1.754 1.798-2.963 3.462-3.594 1.26-.479 2.636-.597 4.082-.35l-.22 1.988c-1.112-.19-2.15-.101-3.088.264-1.172.455-1.974 1.264-2.387 2.407-.44 1.217-.362 2.213.233 2.962.547.688 1.625 1.15 3.207 1.376 2.308.332 3.787-.196 4.53-1.616.498-.954.665-2.159.498-3.582l2.004-.254c.219 1.84-.008 3.42-.68 4.7-1.063 2.027-3.158 3.068-6.229 3.095-.045-.002-.166-.007-.245-.833z" />
					</svg>
				</a>
			</div>
		);
	}
}
