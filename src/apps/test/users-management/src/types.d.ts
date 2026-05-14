declare namespace JSX {
	interface IntrinsicElements {
		[elemName: `adc-${string}`]: any;
	}
}
declare module "*.css" {
	const content: string;
	export default content;
}

declare module "@ui-library";
declare module "@ui-library/styles";
