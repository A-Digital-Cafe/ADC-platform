import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { accountApi, type AvatarOption, type AvatarSource } from "../utils/account-api";
import { toast } from "../utils/toast";
import { buildAvatarUrl } from "@ui-library/utils/avatar";
import { broadcastAvatarUpdate, setupAvatarSync, type AvatarUpdatePayload } from "@ui-library/utils/auth-sync";

const ACCEPTED_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB

export default function ProfileView() {
	const [form, setForm] = useState({ name: "", lastName: "", birthDate: "" });
	const [original, setOriginal] = useState({ name: "", lastName: "", birthDate: "" });
	const [loading, setLoading] = useState(true);

	// Avatar state
	const [userId, setUserId] = useState<string>("");
	const [avatarOptions, setAvatarOptions] = useState<AvatarOption[]>([]);
	const [avatarSource, setAvatarSource] = useState<AvatarSource | "">("");
	const [avatarBusy, setAvatarBusy] = useState(false);
	const [avatarCacheKey, setAvatarCacheKey] = useState(0);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const hasChanges = useMemo(
		() => Object.keys(form).some((key) => form[key as keyof typeof form] !== original[key as keyof typeof original]),
		[form, original]
	);

	const loadAvatarOptions = useCallback(async (): Promise<{ options: AvatarOption[]; selected: AvatarSource | "" }> => {
		const res = await accountApi.getAvatarOptions();
		if (res.success && res.data) {
			const selected = res.data.selected ?? "";
			setAvatarOptions(res.data.options);
			setAvatarSource(selected);
			return { options: res.data.options, selected };
		}
		return { options: [], selected: "" };
	}, []);

	/**
	 * Calcula la URL del avatar para una `source` dada, alineada con la que
	 * computa el backend en `resolveUserAvatar` (lo que verá el header al
	 * recibir el broadcast). `null` significa "sin avatar".
	 */
	const resolveAvatarForSource = useCallback((source: AvatarSource, options: AvatarOption[]): string | null => {
		if (source === "none") return null;
		return options.find((o) => o.id === source)?.url ?? null;
	}, []);

	const emitAvatarUpdate = useCallback(
		(source: AvatarSource, options: AvatarOption[], cacheKey?: number) => {
			if (!userId) return;
			broadcastAvatarUpdate({
				userId,
				avatar: resolveAvatarForSource(source, options),
				cacheKey,
			});
		},
		[userId, resolveAvatarForSource]
	);

	// Reacciona a cambios de avatar emitidos por otra pestaña / microfrontend.
	useEffect(() => {
		if (!userId) return undefined;
		const teardown = setupAvatarSync((payload: AvatarUpdatePayload) => {
			if (payload.userId !== userId) return;
			void loadAvatarOptions();
			setAvatarCacheKey((k) => Math.max(k, payload.cacheKey ?? 0) + 1);
		});
		return teardown;
	}, [userId, loadAvatarOptions]);

	useEffect(() => {
		(async () => {
			try {
				const res = await accountApi.getCurrentUser();
				if (res.success && res.data) {
					const user = res.data;
					setUserId(user.id);
					const userData = {
						name: user.metadata?.name || "",
						lastName: user.metadata?.lastName || "",
						birthDate: user.metadata?.birthDate || "",
					};
					setForm(userData);
					setOriginal(userData);
				}
				await loadAvatarOptions();
			} catch (err) {
				console.error("Error al obtener usuario:", err);
			} finally {
				setLoading(false);
			}
		})();
	}, [loadAvatarOptions]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!hasChanges) {
			toast.info("No hay cambios para guardar");
			return;
		}
		try {
			await accountApi.updateCurrentUser({ name: form.name, lastName: form.lastName, birthDate: form.birthDate });
			setOriginal(form);
			toast.success("Perfil actualizado correctamente!");
		} catch {
			globalThis.dispatchEvent(
				new CustomEvent("adc-error", {
					detail: { errorKey: "update_profile_error", message: "Ocurrió un error al actualizar el perfil" },
				})
			);
		}
	};

	function handleChange(field: keyof typeof form, value: string) {
		setForm((prev) => ({ ...prev, [field]: value }));
	}

	// Avatar derivado: opción seleccionada → URL preview; `none` muestra icono.
	const customOption = useMemo(() => avatarOptions.find((o) => o.id === "custom"), [avatarOptions]);
	const previewUrl = useMemo(() => {
		const selected = avatarOptions.find((o) => o.id === avatarSource);
		if (avatarSource === "none") {
			return undefined;
		}
		const base = buildAvatarUrl({ avatar: selected?.url ?? null, seed: userId || form.name || "default" });
		if (!base) return undefined;
		// Añade cache-buster para forzar recarga del <img> tras re-subir avatar custom
		if (avatarSource === "custom") return `${base}${base.includes("?") ? "&" : "?"}v=${avatarCacheKey}`;
		return base;
	}, [avatarSource, avatarOptions, userId, form.name, avatarCacheKey]);

	const handleSelectAvatar = async (source: AvatarSource) => {
		if (avatarBusy || source === avatarSource) return;
		setAvatarBusy(true);
		try {
			const res = await accountApi.selectAvatarSource(source);
			if (res.success && res.data) {
				setAvatarSource(res.data.avatarSource);
				emitAvatarUpdate(res.data.avatarSource, avatarOptions);
				toast.success("Avatar actualizado");
			}
		} catch {
			toast.error("No se pudo cambiar el avatar");
		} finally {
			setAvatarBusy(false);
		}
	};

	const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		// reset para permitir re-seleccionar el mismo archivo
		if (fileInputRef.current) fileInputRef.current.value = "";
		if (!file) return;
		if (!ACCEPTED_MIMES.includes(file.type)) {
			toast.error("Tipo de archivo no soportado (JPG, PNG, GIF o WebP)");
			return;
		}
		if (file.size > MAX_AVATAR_BYTES) {
			toast.error("El archivo supera los 2MB");
			return;
		}
		setAvatarBusy(true);
		try {
			await accountApi.uploadCustomAvatar(file);
			const { options } = await loadAvatarOptions();
			const nextCacheKey = avatarCacheKey + 1;
			setAvatarCacheKey(nextCacheKey);
			// Tras un upload, el backend selecciona automáticamente "custom".
			emitAvatarUpdate("custom", options, nextCacheKey);
			toast.success("Avatar subido");
		} catch (err) {
			toast.error((err as Error).message || "No se pudo subir el avatar");
		} finally {
			setAvatarBusy(false);
		}
	};

	const handleRemoveCustom = async () => {
		if (avatarBusy || !customOption) return;
		setAvatarBusy(true);
		try {
			await accountApi.removeCustomAvatar();
			const { options, selected } = await loadAvatarOptions();
			// Tras eliminar custom, si la fuente activa era custom el backend la limpió:
			// emitimos el estado resultante para el resto de la UI.
			emitAvatarUpdate(selected || "default", options);
			toast.success("Avatar custom eliminado");
		} catch {
			toast.error("No se pudo eliminar el avatar");
		} finally {
			setAvatarBusy(false);
		}
	};

	const selectorOptionsJson = useMemo(() => JSON.stringify(avatarOptions.map((o) => ({ value: o.id, label: o.label }))), [avatarOptions]);

	if (loading) {
		return <p className="p-4">Cargando perfil...</p>;
	}

	return (
		<div className="w-full flex flex-col pl-25 lg:pl-70">
			{/* Title */}
			<div className="mb-4">
				<h2 className="font-bold text-text">Información Personal</h2>
				<p className="text-muted">Actualiza tu perfil y avatar</p>
			</div>

			{/* Panel */}
			<div className="bg-surface p-8 pb-6 rounded-xxl">
				<div className="mb-6">
					<h3 className="mt-0! text-lg font-semibold text-text">Datos del perfil</h3>
					<p className="text-sm text-muted">Puedes modificar tu información personal</p>
				</div>

				<div className="max-w-3xl mx-auto">
					{/* Avatar */}
					<div className="flex flex-col items-center mb-8">
						<div className="relative">
							{avatarSource === "none" || !previewUrl ? (
								<div className="w-20 h-20 md:w-24 md:h-24 rounded-full flex items-center justify-center text-muted bg-surface border-2 border-text/15">
									<adc-icon-no-avatar size="2.5rem" />
								</div>
							) : (
								<img
									src={previewUrl}
									alt="Avatar"
									className="w-20 h-20 md:w-24 md:h-24 rounded-full object-cover border-2 border-accent"
								/>
							)}
							{customOption && avatarSource === "custom" && (
								<button
									type="button"
									aria-label="Eliminar avatar custom"
									title="Eliminar avatar custom"
									disabled={avatarBusy}
									onClick={handleRemoveCustom}
									className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-red-500 text-white text-sm font-bold flex items-center justify-center shadow-md hover:bg-red-600 disabled:opacity-50"
								>
									×
								</button>
							)}
						</div>

						{avatarOptions.length > 1 && (
							<div className="w-full max-w-xs mt-4">
								<label className="block text-xs text-muted mb-1">Mostrar avatar de:</label>
								<adc-select
									value={avatarSource || ""}
									options={selectorOptionsJson}
									onChange={(e: any) => handleSelectAvatar((e.target as HTMLSelectElement).value as AvatarSource)}
								/>
							</div>
						)}

						<input ref={fileInputRef} type="file" accept={ACCEPTED_MIMES.join(",")} className="hidden" onChange={handleFilePicked} />
						<adc-button class="mt-4" variant="primary" disabled={avatarBusy} onClick={() => fileInputRef.current?.click()}>
							{customOption ? "Reemplazar avatar custom" : "Subir avatar custom"}
						</adc-button>

						<p className="text-xs text-muted mt-2 text-center">JPG, PNG, GIF o WebP (máx. 2MB)</p>
					</div>

					{/* Form */}
					<form onSubmit={handleSubmit} className="space-y-5">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<label htmlFor="profile-name" className="block text-sm mb-1 text-text">
									Nombre
								</label>
								<adc-input
									inputId="profile-name"
									value={form.name}
									class="w-full"
									onInput={(e) => handleChange("name", (e.target as HTMLInputElement).value)}
								/>
							</div>

							<div>
								<label htmlFor="profile-lastName" className="block text-sm mb-1 text-text">
									Apellido
								</label>
								<adc-input
									inputId="profile-lastName"
									value={form.lastName}
									class="w-full"
									onInput={(e) => handleChange("lastName", (e.target as HTMLInputElement).value)}
								/>
							</div>
						</div>

						<div>
							<label htmlFor="profile-birthDate" className="block text-sm mb-1 text-text">
								Fecha de Nacimiento
							</label>
							<adc-input
								inputId="profile-birthDate"
								type="date"
								value={form.birthDate}
								class="w-full"
								onInput={(e) => handleChange("birthDate", (e.target as HTMLInputElement).value)}
							/>
						</div>

						<div className="flex flex-col sm:flex-row sm:justify-end gap-3 pt-4">
							<adc-button type="submit" variant="primary" disabled={!hasChanges}>
								{hasChanges ? "Guardar Cambios" : "Sin cambios"}
							</adc-button>
						</div>
					</form>
				</div>
			</div>
		</div>
	);
}
