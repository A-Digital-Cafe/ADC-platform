/**
 * Tailwind CSS Preset para ADC Platform UI Library
 *
 * Este preset combina los colores y utilidades de la comunidad ADC
 * con los estilos corporativos de la plataforma.
 *
 * Los módulos que usan esta librería pueden extender este preset
 * para mantener consistencia visual.
 */

/** @type {import('tailwindcss').Config} */
export default {
	theme: {
		extend: {
			colors: {
				// Colores dinámicos via CSS Variables (de temp-ui)
				header: "var(--c-header)",
				theader: "var(--c-theader)",
				background: "var(--c-background)",
				text: "var(--c-text)",
				muted: "var(--c-muted)",
				negativeText: "var(--c-negative-text)",
				surface: "var(--c-surface)",
				tsurface: "var(--c-tsurface)",
				primary: "var(--c-primary)",
				accent: "var(--c-accent)",
				button: "var(--c-button)",
				tprimary: "var(--c-tprimary)",

				
				alt: "var(--c-alt)",

				// Tonos semánticos (fondo + texto) via CSS Variables
				info: "var(--c-info)",
				tinfo: "var(--c-tinfo)",
				success: "var(--c-success)",
				tsuccess: "var(--c-tsuccess)",
				warn: "var(--c-warn)",
				twarn: "var(--c-twarn)",
				danger: "var(--c-danger)",
				tdanger: "var(--c-tdanger)",

				// App accent colors 
				accentorange: "var(--c-app-orange)",
				accentpurple: "var(--c-app-purple)",
				accentcyan: "var(--c-app-cyan)",
				accentred: "var(--c-app-red)",
				accentgreen: "var(--c-app-green)",
			},
			fontFamily: {
				heading: ["Fredoka", "sans-serif"],
				text: ["Inter", "system-ui", "sans-serif"],
				sans: ["system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
			},
			spacing: {
				"adc-sm": "0.5rem",
				"adc-md": "1rem",
				"adc-lg": "1.5rem",
				"adc-xl": "2rem",
			},
			borderRadius: {
				xxl: "16px",
				adc: "0.375rem",
			},
			boxShadow: {
				cozy: "0 8px 24px rgba(0,0,0,.08)",
			},
			animation: {
				"fade-in": "fadeIn 0.3s ease-in-out",
				"slide-in": "slideIn 0.3s ease-out",
				"bounce-soft": "bounceSoft 1s ease-in-out infinite",
			},
			keyframes: {
				fadeIn: {
					"0%": { opacity: "0", transform: "translateY(-10px)" },
					"100%": { opacity: "1", transform: "translateY(0)" },
				},
				scaleIn: {
					"0%": { opacity: "0", transform: "scale(0.95)" },
					"100%": { opacity: "1", transform: "scale(1)" },
				},
				slideIn: {
					"0%": { opacity: "0", transform: "translateX(-10px)" },
					"100%": { opacity: "1", transform: "translateX(0)" },
				},
				bounceSoft: {
					"0%, 100%": { transform: "translateY(0)" },
					"50%": { transform: "translateY(-10px)" },
				},
			},
		},
	},
	plugins: [],
};
