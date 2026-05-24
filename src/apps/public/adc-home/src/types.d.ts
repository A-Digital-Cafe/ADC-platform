/// <reference types="vite/client" />
import "react";

declare module "react" {
	namespace JSX {
		interface IntrinsicElements {
			[elemName: `adc-${string}`]: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, any>;
		}
	}
}
