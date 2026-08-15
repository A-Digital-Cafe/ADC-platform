# Cambiar cuántas copias guarda el almacenamiento

Lo hace el panel **Admin - Network → Nodos → Copias del almacenamiento**, con la misma máquina de
estados persistida que la conversión de Mongo: se retoma después de un corte y cada paso vuelve a
mirar el mundo antes de actuar. Esta guía es lo que el panel no puede decir en un tooltip: **por qué
hay que parar todo, cuánto entra de verdad con cada factor, y qué se rompe si un nodo se queda
atrás**.

## Los factores, y por qué el 2 no está

| Factor | Qué significa | Cuándo |
| --- | --- | --- |
| **1** | Cada dato vive en un solo nodo. Se rompe una máquina: se pierde su parte y el resto sigue legible | Uno o dos nodos. Es una mejora real frente a un nodo único, donde una falla se lleva todo |
| **3** | Tres copias en tres zonas. Tolera perder un nodo entero sin perder ni bloquear nada | Desde tres nodos |
| ~~2~~ | **Rechazado.** El quórum de escritura son las dos copias, así que perder un nodo **bloquea las escrituras** — y cuesta el doble de disco sin tolerar fallos | Nunca |

El factor **no puede superar la cantidad de zonas**: cada copia va en una zona distinta, y el panel
lo comprueba antes de dejarte empezar.

## Cuánto entra: no es «los discos dividido el factor»

Como una zona nunca guarda más de una copia de cada dato, la capacidad utilizable es el mayor `U`
que cumple `Σ_zona min(capacidad_zona, U) ≥ factor · U`. En la práctica:

| Nodos (iguales, de `C` cada uno) | Factor | Entra |
| --- | --- | --- |
| 3 | 3 | `C` — el clúster guarda lo que guarda su zona más chica |
| 4 | 3 | `1,33 · C` — la cuarta máquina suma un 33%, no un 100% |
| 6 | 3 | `2 · C` |

Por eso, con factor 3, sumar un nodo agranda el clúster de a poco: el ensayo del panel te dice el
número exacto contra lo que hay guardado hoy, y **bloquea** si no entra.

## Por qué hay que parar todos los nodos

Garage lee el factor de su archivo de configuración y lo compara con el layout que tiene guardado.
Si no coinciden **se niega a arrancar**:

```
Previous cluster layout has replication factor 1, which is different than the one
specified in the config file (3).
```

No hay camino en caliente ni migración rodante: no se puede tener un nodo en 3 y otro en 1 mientras
se migra. Hay que parar el almacenamiento en todos, cambiar `GARAGE_REPLICATION_FACTOR` en el
`env/storage.env` de cada uno, borrar el layout guardado de cada uno, y volver a arrancar.

> **Borrar el layout no borra datos.** Borra el mapa de qué partición vive dónde. El panel lo
> congela **antes** de que toques nada —ids, zonas y capacidades— y lo vuelve a declarar solo al
> final; es lo único que sabe qué zona tenía cada nodo una vez borrado el archivo.

## Los pasos que necesitan a una persona

La máquina avanza sola y se detiene en `te espera` cuando llega a algo que no puede hacer: parar el
almacenamiento de otra máquina, cambiar su `env/` y borrarle un archivo de un volumen son cosas de
su dueño, la misma regla que en la conversión de Mongo. Son cuatro: **parar**, **cambiar la
variable**, **borrar el layout**, **arrancar**. Se cierran con **Retomar**, que es la confirmación.

Que no haya detección no es un agujero: los dos errores posibles —no cambiar el número en un nodo, o
no borrarle el layout— tienen la misma consecuencia visible, ese Garage no arranca, y el paso
siguiente lo dice con nombre y apellido.

## La ventana, y qué se ve desde afuera

- Apenas se aplica el layout nuevo, los objetos cuya metadata todavía no se propagó responden
  **404**. Se arregla solo en minutos. Drive, los adjuntos y los avatares fallan mientras tanto.
- Después, **el factor nuevo todavía no es real**: las particiones figuran completas apenas se
  aplica el reparto, pero los bloques se copian detrás. El panel espera a que la cola de copia llegue
  a cero antes de dar la operación por terminada — perder un nodo en esa ventana sí pierde datos.
- Al **bajar** el factor no se espera nada de eso: lo que queda en cola son bloques que sobran, y el
  clúster los borra con demora por su cuenta.

Por eso la operación exige backup verificado y ventana de mantenimiento declarados, y por eso el
aborto no revierte: pasado el borrado del layout, abandonar deja el almacenamiento sin mapa. Lo que
el panel devuelve ahí es qué falta para dejarlo sirviendo, con las zonas congeladas al empezar.

## Lo verificado, y contra qué

Contra un clúster real de tres nodos (Garage v2.1.0): el ciclo completo `1 → 3` y `3 → 1`, con 15
objetos de 300 KB que quedaron **15/15 legibles** al terminar cada uno, y con un nodo apagado tras
subir a 3. La negativa a arrancar con el factor cambiado y el layout viejo también está comprobada:
es el mensaje de arriba, copiado de la salida real.

---

Alta de un nodo y red privada, en [network-vpn.md](network-vpn.md). El reparto de `env/`, en
[env/README.md](../../env/README.md).
