/**
 * Decorador que restringe el acceso a métodos solo cuando se proporciona el token
 * de autorización correcto (la master key del kernel para superficies de ciclo de
 * vida/infra). Soporta sintaxis legacy (experimentalDecorators) y Stage 3 decorators.
 *
 * El token esperado se guarda **siempre** en un `WeakMap` por instancia (vía
 * {@link bindKernelKey}), de modo que **no sea legible como propiedad por nombre**
 * (`instance['kernelKey']`). Toda clase con métodos `@OnlyKernel()` debe llamar a
 * `bindKernelKey(this, token)` (las clases base lo hacen en su `setKernelKey`).
 */

import type { CapabilityToken } from "@common/security/Capability.ts";

const instanceKeys = new WeakMap<object, CapabilityToken>();

/**
 * Asocia el token de autorización a una instancia. Idempotente con guard de "ya
 * establecida". Lo invocan las clases base / helpers al recibir su key/capability.
 */
export function bindKernelKey(instance: object, token: CapabilityToken): void {
	if (instanceKeys.has(instance)) {
		throw new Error("Kernel key ya está establecida");
	}
	instanceKeys.set(instance, token);
}

function verify(self: object, provided: unknown, label: string): void {
	const expected = instanceKeys.get(self);
	if (!expected) {
		throw new Error("Kernel key no establecida");
	}
	if (expected !== provided) {
		throw new Error(`Acceso no autorizado a ${label}`);
	}
}

export function OnlyKernel() {
	return function (targetOrMethod: any, propertyKeyOrContext: string | ClassMethodDecoratorContext, descriptor?: PropertyDescriptor): any {
		// Stage 3 decorators: targetOrMethod es el método, propertyKeyOrContext es el context
		if (typeof propertyKeyOrContext === "object" && propertyKeyOrContext.kind === "method") {
			const methodName = String(propertyKeyOrContext.name);
			return function (this: any, ...args: any[]) {
				verify(this, args[0], methodName);
				return targetOrMethod.apply(this, args);
			};
		}

		// Legacy decorators: propertyKeyOrContext es string, descriptor existe
		const propertyKey = propertyKeyOrContext as string;
		const originalMethod = descriptor!.value;

		descriptor!.value = function (this: any, ...args: any[]) {
			verify(this, args[0], propertyKey);
			return originalMethod.apply(this, args);
		};

		return descriptor;
	};
}
