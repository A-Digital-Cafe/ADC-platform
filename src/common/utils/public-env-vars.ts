/**
 * Identidad del despliegue que el navegador necesita conocer.
 *
 * Son datos **públicos por definición** —los publica el propio sitio— pero identifican a una
 * persona física concreta: su CUIT, su nombre legal, su teléfono. Por eso no viven en el código:
 * un fork que clone el repositorio no debe heredarlos, y cambiar el CUIT no debería ser un commit.
 *
 * Los valores se hornean en los bundles **en tiempo de build**, desde las variables de entorno de
 * abajo. Sin `.env`, todas quedan en cadena vacía y cada consumidor degrada solo (el logo fiscal
 * no se renderiza, los datos del responsable quedan en blanco). Nunca poner acá un secreto: todo
 * lo que se declare termina en un archivo JavaScript servido al público.
 */

/** Clave en el bundle → variable de entorno que la alimenta. */
export const PUBLIC_ENV_VARS = {
	dataFiscalQr: "ADC_PUBLIC_DATA_FISCAL_QR",
	operatorLegalName: "ADC_PUBLIC_OPERATOR_LEGAL_NAME",
	operatorTaxId: "ADC_PUBLIC_OPERATOR_TAX_ID",
	operatorCountry: "ADC_PUBLIC_OPERATOR_COUNTRY",
	operatorPhone: "ADC_PUBLIC_OPERATOR_PHONE",
	contactEmail: "ADC_PUBLIC_CONTACT_EMAIL",
	discordHandle: "ADC_PUBLIC_DISCORD_HANDLE",
	discordUrl: "ADC_PUBLIC_DISCORD_URL",
	socialTwitch: "ADC_PUBLIC_SOCIAL_TWITCH",
	socialYoutube: "ADC_PUBLIC_SOCIAL_YOUTUBE",
	socialInstagram: "ADC_PUBLIC_SOCIAL_INSTAGRAM",
	socialGithub: "ADC_PUBLIC_SOCIAL_GITHUB",
	donationsUrl: "ADC_PUBLIC_DONATIONS_URL",
	creatorUrl: "ADC_PUBLIC_CREATOR_URL",
	sourceRepoUrl: "ADC_PUBLIC_SOURCE_REPO_URL",
} as const;

export type PublicEnvKey = keyof typeof PUBLIC_ENV_VARS;
