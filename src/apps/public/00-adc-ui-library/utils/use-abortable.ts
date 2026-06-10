import { useCallback, useEffect, useRef } from "react";

/**
 * Hook para llamadas async cancelables: cada invocación aborta la anterior y
 * desmontar el componente aborta la última en vuelo. Los `AbortError` se
 * tragan (devuelven `undefined`); cualquier otro error se propaga.
 *
 * @example
 * const checkUsername = useAbortable(async (signal, username: string) => {
 *   return identityApi.checkUsernameExists(username, signal);
 * });
 * const res = await checkUsername("abby"); // undefined si fue abortada
 */
export function useAbortable<TArgs extends unknown[], TResult>(
	fn: (signal: AbortSignal, ...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult | undefined> {
	const controllerRef = useRef<AbortController | null>(null);
	const fnRef = useRef(fn);
	fnRef.current = fn;

	useEffect(() => {
		return () => controllerRef.current?.abort();
	}, []);

	return useCallback(async (...args: TArgs) => {
		controllerRef.current?.abort();
		const controller = new AbortController();
		controllerRef.current = controller;
		try {
			return await fnRef.current(controller.signal, ...args);
		} catch (err) {
			if ((err as DOMException | undefined)?.name === "AbortError") return undefined;
			throw err;
		}
	}, []);
}
