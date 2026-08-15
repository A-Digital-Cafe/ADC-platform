# PlatformSettingsService

Configuración del **clúster** en Mongo (`platform_settings`), no en el `env/` de cada máquina:
retenciones, ventanas de barridos, límites de cuerpo y de caudal, URLs de confirmación y despliegue
desde GitHub. Un solo valor, lo ven todos los nodos.

- `kernelMode 5` — antes que cualquier módulo que use estos valores. El límite de cuerpo lo lee el
  servidor HTTP al construirse (40) y el resto se interpola en los `config.json` al cargar cada módulo.
- **No expone endpoints a propósito**: declarar `EndpointManagerService` arrastraría el servidor HTTP
  a cargarse antes de este `start()`, y el límite de cuerpo volvería a salir del entorno. Se edita en
  la colección, o desde otro módulo con `listSettings()`/`setSetting()` (`IPlatformSettingsService`),
  que es lo que hace el panel de red con el caudal de subida. `setSetting` sólo acepta nombres
  declarados en `defaults.json`: estos valores se interpolan dentro de los `config.json` de todos los
  módulos, así que sembrar claves arbitrarias sería inyectarles configuración.
- `defaults.json` es la lista de lo que se puede configurar. Se siembra sólo lo que falta y **nunca**
  se pisa lo existente; si al sembrar hay una variable de entorno con ese nombre, gana ella (así
  mudar una variable desde `env/` no pierde su valor).
- Sin Mongo degrada: cada módulo usa el default de su `config.json` y se avisa con un warning.

Precedencia al interpolar un `${VAR}`: `.env` del módulo → **estas opciones** → `process.env` →
default del `config.json`. Una variable que quedó en `env/` y ya está en la base se ignora, y el
arranque lo dice por log en vez de dejar que alguien edite un archivo sin efecto.

Cambiar un valor **rige al reiniciar** el nodo, salvo que quien lo cambia lo aplique en caliente por
su cuenta (el caudal de subida lo hace, y además lo propaga a los vecinos). `setSetting` deja el
valor nuevo en la copia en memoria de su proceso; los otros nodos lo toman al arrancar.
