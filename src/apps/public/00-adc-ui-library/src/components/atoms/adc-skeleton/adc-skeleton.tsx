import { Component, Prop, h, Host } from "@stencil/core";

/**
 * Skeleton loader component for placeholder content while loading
 *
 * @example
 * <adc-skeleton variant="text" />
 * <adc-skeleton variant="circular" width="48px" height="48px" />
 * <adc-skeleton variant="rectangular" height="200px" />
 * <adc-skeleton variant="button" />
 * <adc-skeleton variant="input" />
 */
@Component({
	tag: "adc-skeleton",
	shadow: false,
})
export class AdcSkeleton {
	/** Variant determines the shape of the skeleton */
	@Prop() variant: "text" | "circular" | "rectangular" | "button" | "input" = "text";

	/** Custom width (CSS value). Defaults vary by variant */
	@Prop() width?: string;

	/** Custom height (CSS value). Defaults vary by variant */
	@Prop() height?: string;

	/** Number of lines for text variant */
	@Prop() lines: number = 1;

	/** Animation type */
	@Prop() animation: "pulse" | "wave" | "none" = "pulse";

	/** Border radius override */
	@Prop() rounded?: string;

	private getBaseClasses(): string {
		let animationClass = "";
		if (this.animation === "pulse") animationClass = "animate-pulse";
		else if (this.animation === "wave") animationClass = "animate-shimmer";

		return `bg-surface-alt ${animationClass}`;
	}

	private getVariantStyles(): { classes: string; style: Record<string, string> } {
		switch (this.variant) {
			case "text":
				return {
					classes: `${this.getBaseClasses()} rounded`,
					style: {
						width: this.width || "100%",
						height: this.height || "1em",
					},
				};

			case "circular":
				return {
					classes: `${this.getBaseClasses()} rounded-full`,
					style: {
						width: this.width || "40px",
						height: this.height || this.width || "40px",
					},
				};

			case "rectangular":
				return {
					classes: `${this.getBaseClasses()} ${this.rounded ? "" : "rounded-lg"}`,
					style: {
						width: this.width || "100%",
						height: this.height || "100px",
						...(this.rounded ? { borderRadius: this.rounded } : {}),
					},
				};

			case "button":
				return {
					classes: `${this.getBaseClasses()} rounded-xxl`,
					style: {
						width: this.width || "100%",
						height: this.height || "40px",
					},
				};

			case "input":
				return {
					classes: `${this.getBaseClasses()} rounded-xxl`,
					style: {
						width: this.width || "100%",
						height: this.height || "42px",
					},
				};

			default:
				return {
					classes: this.getBaseClasses(),
					style: {
						width: this.width || "100%",
						height: this.height || "1em",
					},
				};
		}
	}
	private static readonly keyPrefix = "skeleton-line-";
	render() {
		const { classes, style } = this.getVariantStyles();

		if (this.variant === "text" && this.lines > 1) {
			return (
				<Host class="flex flex-col gap-2">
					{Array.from({ length: this.lines }).map((_, index) => (
						<div
							key={AdcSkeleton.keyPrefix + index}
							class={classes}
							style={{
								...style,
								// Last line is usually shorter
								width: index === this.lines - 1 ? "75%" : style.width,
							}}
						/>
					))}
				</Host>
			);
		}

		return <div class={classes} style={style} />;
	}
}
