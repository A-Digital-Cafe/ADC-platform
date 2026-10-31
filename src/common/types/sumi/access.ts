/**
 * Nombres de los roles que abren las apps de Sumi (los mismos que `SystemRole.ADMIN` y
 * `SystemRole.SUMI_*`). Van como literales y no importados de `systemRoles.ts` para que la UI
 * library no arrastre el catálogo de roles entero por un menú.
 *
 * Los `config.json` (`uiModule.access.roles`) no pueden importar: al sumar un rol acá hay que
 * sumarlo también en `presets/sumi/apps/<app>/config.json`.
 */
export const SUMI_APP_ROLES: readonly string[] = ["Admin", "Sumi User", "Sumi Trusted", "Sumi Admin"];
