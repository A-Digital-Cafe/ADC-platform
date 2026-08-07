# Licencia

Este repositorio contiene **dos clases de material con condiciones distintas**. La separación no es
burocracia: el código está para que cualquiera monte su propia plataforma, mientras que la identidad
del operador —nombre real, CUIT, inscripción ante la autoridad fiscal argentina— identifica a una
persona física concreta, y desplegarla sin ser su titular causa daño real a terceros.

Esos valores **no están en el repositorio**: entran por variables de entorno y su archivo no se
versiona. La sección 2 los excluye igual, porque son públicos en el sitio en producción y nada
impide copiarlos de ahí.

---

## 1. Código fuente — ISC License

Se licencia bajo ISC **el código** de este repositorio: kernel, servicios, providers, utilidades,
apps, componentes, configuración de build y estilos.

```
ISC License

Copyright (c) 2025 Abigail Palmero (abbytec on GitHub) <gpsmurfs@gmail.com>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

---

## 2. Material excluido — todos los derechos reservados

Lo siguiente **no** está cubierto por la licencia anterior. No se concede permiso para copiarlo,
redistribuirlo, publicarlo ni desplegarlo:

### a) Identidad del operador

Nombre legal, CUIT, domicilio, teléfono, correos de contacto y el identificador del **Formulario
960/D «Data Fiscal»** de la autora, **dondequiera que aparezcan**: en el sitio publicado, en un
bundle ya compilado o en un archivo de entorno que llegue por cualquier vía.

El repositorio no los trae: viajan por variables `ADC_PUBLIC_*` (ver `.env.example`) y el archivo
que las contiene no se versiona. Un clon compila con todos esos campos vacíos. La exclusión importa
igual, porque el dato es público y se puede copiar del sitio en producción.

Desplegar cualquiera de esos valores sin ser su titular hace que ese sitio muestre a una persona
ajena como responsable de la actividad y de las operaciones que ahí se cobren. No es una infracción
de copyright abstracta: es una atribución falsa frente al fisco y frente a quien compra.

### b) Autoría de la persona detrás del proyecto

Nombre real y direcciones personales donde figuran como autoría: aviso de copyright, `author` de los
`package.json`, autoría de contenido en `src/apps/public/community-home/src/utils/constants.ts`,
`creator-*` en `src/apps/public/adc-auth/src/components/AuthLayout.tsx` y buzones nombrados en
`docs/`.

El aviso de copyright hay que conservarlo —lo exige la propia ISC—, pero **como atribución de
autoría del código, no como identificación del operador de tu despliegue**. Ningún fork puede
presentar esos datos como los de quien presta su servicio.

### c) Textos legales, compromisos públicos y datos del equipo

Los documentos de los presets (`/privacy`, `/terms`, `/cookies`, `/values`, `/ethics`, `/hria`,
`/authority-requests`, `/transparency`, `/roadmap`, `/acknowledgments`), los datos del equipo y sus
fotografías. Tienen su propia licencia en el repositorio de cada preset; el criterio es el mismo.

### d) Marca, nombre e identidad visual

El nombre «Abby's Digital Cafe», la sigla «ADC», el dominio `adigitalcafe.com`, los logotipos,
iconos, ilustraciones y la identidad visual. Ver [TRADEMARK_POLICY.md](TRADEMARK_POLICY.md).

---

## 3. Cómo reutilizar esto correctamente

1. Forkeá el repositorio y quedate con el código (punto 1).
2. Copiá `.env.example` a `.env` y **completá las `ADC_PUBLIC_*` con tus datos**, o dejalas vacías.
   Vacías, el logo fiscal no se muestra y los datos del responsable quedan en blanco: no hay forma
   de heredar los de otra persona por descuido.
3. Reemplazá la marca, el dominio y los datos de contacto por los tuyos.
4. Escribí tus propios textos legales, con tu propia identificación como responsable.
5. No presentes el resultado como si fuera este proyecto.

Ante cualquier duda sobre el alcance: gpsmurfs@gmail.com.
