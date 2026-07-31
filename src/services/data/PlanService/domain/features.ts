/**
 * Claves de las features de **plataforma**: las dos que no pertenecen a ningún
 * módulo y que el motor necesita conocer por nombre para resolver el eje org.
 *
 * Viven en `domain/` y no en un DAO porque son vocabulario del dominio: las usan
 * el seed, el resolver, la administración de organizaciones y el propio shell.
 */

/** Feature que define el tope de asientos; siempre plana, nunca escalada. */
export const SEATS_FEATURE = "org.seats";

/**
 * Flag de **ampliación** de la organización. Se guarda como override booleano sobre
 * el sujeto `org` y hace que apliquen los `expansionFeatures` del plan.
 *
 * Se otorga a pedido (por ticket, con justificación) y es revocable: por eso es un
 * override y no un cambio de plan — quitarlo devuelve los límites base sin tocar la
 * suscripción ni la facturación.
 */
export const EXPANSION_FEATURE = "org.expansion";
