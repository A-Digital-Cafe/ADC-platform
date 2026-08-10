# ADC Auth

App de autenticación para ADC Platform. Integra SessionManagerService; puerto dev 3012, subdominio auth.adigitalcafe.com.

## Rutas

-   `/login` - Inicio de sesión
-   `/register` - Registro
-   `/cancel-deletion?token=` - Cancela la baja programada (enlace de arrepentimiento por email)
-   `/confirm-email?token=` - Confirma el cambio de email (enlace de un solo uso por email)

## Características

-   Clickwrap legal OAuth (Términos/Privacidad + edad) visible en `/login` y `/register`
