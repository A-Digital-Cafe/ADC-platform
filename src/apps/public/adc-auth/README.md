# ADC Auth

App de autenticación para ADC Platform. Integra SessionManagerService; puerto dev 3012, subdominio auth.adigitalcafe.com.

## Rutas

-   `/login` - Inicio de sesión
-   `/register` - Registro
-   `/cancel-deletion?token=` - Cancela la baja programada (enlace de arrepentimiento por email)
-   `/confirm-email?token=` - Confirma el cambio de email (enlace de un solo uso por email)
-   `/two-factor` - Segundo factor del login (acá aterriza el callback OAuth cuando hace falta)

## Características

-   Clickwrap legal OAuth (Términos/Privacidad + edad) visible en `/login` y `/register`
-   Segundo factor: pide el código, o guía el alta obligatoria (QR + códigos de recuperación) cuando
    la cuenta tiene rol de administración y todavía no lo configuró. Sin eso el login no avanza
-   El alta no dice si un email ya está registrado: siempre termina en "revisá tu casilla" y lo que
    corresponda llega por correo (confirmación de la dirección, o aviso a su titular)
