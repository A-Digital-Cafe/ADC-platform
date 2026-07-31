import { randomUUID } from "node:crypto";
import type { Model } from "mongoose";
import type { PlanOverrideActor, PlanOverridePage, PlanOverridesQuery, UpsertPlanOverrideInput } from "@common/types/plans/index.ts";
import { PlanError } from "@common/types/custom-errors/PlanError.ts";
import type { PlanOverrideDoc, PlanSubjectType } from "../domain/index.ts";
import type { IdentitySource } from "./TierResolver.ts";
import { validateOverrideInput } from "./overrideValidation.ts";
import { assertOrgActorMayWrite, type OrgCeilingResolver } from "./overrideGuards.ts";

/** Límites del listado: default razonable + máximo duro innegociable. */
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 200;

/**
 * Administración de las excepciones de límite por feature: escrituras y listado administrativo
 * (la resolución en lectura vive en `OverrideResolver`).
 */
export class OverridesManager {
	readonly #model: Model<PlanOverrideDoc>;
	readonly #identity: IdentitySource;
	readonly #onChange: () => void;
	#ceiling: OrgCeilingResolver | null = null;

	/**
	 * `onChange` corre después de **toda** escritura y descarta las caches de resolución. Va acá y
	 * no en los callers porque esta clase se expone a otros módulos vía `PlanOverridesAdmin`:
	 * invalidar donde se escribe es lo único que no se puede olvidar.
	 */
	constructor(model: Model<PlanOverrideDoc>, identity: IdentitySource, onChange: () => void) {
		this.#model = model;
		this.#identity = identity;
		this.#onChange = onChange;
	}

	/**
	 * Techo de una organización para validar los overrides que asigna su admin.
	 *
	 * Se inyecta después de construir el resolver de planes porque éste depende de
	 * este manager: sin la inyección diferida, la dependencia sería circular.
	 */
	setOrgCeilingResolver(resolver: OrgCeilingResolver): void {
		this.#ceiling = resolver;
	}

	/**
	 * Página de overrides (`{ items, total }`: el listado está capado). En contexto org el filtro se
	 * fuerza server-side a esa org.
	 */
	async list(actor: PlanOverrideActor, query: PlanOverridesQuery = {}): Promise<PlanOverridePage> {
		const filter: Record<string, unknown> = actor.orgId ? { orgId: actor.orgId } : {};
		if (query.featureKey) filter.featureKey = query.featureKey;
		if (query.subjectType) filter.subjectType = query.subjectType;
		if (query.subjectId) filter.subjectId = query.subjectId;

		const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
		const offset = Math.max(query.offset ?? 0, 0);

		// `id` desempata: sin orden estable, dos overrides del mismo instante se
		// repiten o se saltean al pasar de página.
		const [items, total] = await Promise.all([
			this.#model.find(filter).sort({ createdAt: -1, id: 1 }).skip(offset).limit(limit).lean<PlanOverrideDoc[]>(),
			this.#model.countDocuments(filter),
		]);
		return { items, total };
	}

	/**
	 * Crea/actualiza un override. Un actor de organización sólo puede tocar sujetos
	 * de SU org, nunca asignar "ilimitado" y nunca administrar el nivel `org`
	 * (eso es contexto global). `org-members-default` queda siempre scoped a la org
	 * sujeto, también con actor global, para que la resolución org-scoped lo encuentre.
	 */
	async upsert(actor: PlanOverrideActor, input: UpsertPlanOverrideInput): Promise<PlanOverrideDoc> {
		validateOverrideInput(input);
		const actorOrgId = actor.orgId ?? null;
		const isMembersDefault = input.subjectType === "org-members-default";
		const docOrgId = isMembersDefault ? input.subjectId : actorOrgId;

		if (actorOrgId) {
			await assertOrgActorMayWrite(actorOrgId, input, { identity: this.#identity, ceiling: this.#ceiling });
		}

		const now = new Date();
		const doc = await this.#model.findOneAndUpdate(
			{ subjectType: input.subjectType, subjectId: input.subjectId, orgId: docOrgId, featureKey: input.featureKey },
			{
				$set: { value: input.value, updatedAt: now },
				$setOnInsert: { id: randomUUID(), createdBy: actor.userId, createdAt: now },
			},
			{ new: true, upsert: true }
		);
		this.#onChange();
		return doc.toObject() as PlanOverrideDoc;
	}

	/**
	 * Alta directa de overrides preexistentes, respetando su `orgId` original.
	 *
	 * Sólo la usa la migración de `storage_limit_overrides`: `upsert()` no sirve porque
	 * deriva el `orgId` del actor, y acá el scope viene del documento que se migra.
	 * No pisa un override ya existente para el mismo sujeto y feature.
	 */
	async importExisting(docs: readonly Omit<PlanOverrideDoc, "id">[]): Promise<number> {
		let imported = 0;
		for (const doc of docs) {
			const result = await this.#model.updateOne(
				{ subjectType: doc.subjectType, subjectId: doc.subjectId, orgId: doc.orgId, featureKey: doc.featureKey },
				{ $setOnInsert: { ...doc, id: randomUUID() } },
				{ upsert: true }
			);
			if (result.upsertedCount > 0) imported++;
		}
		if (imported > 0) this.#onChange();
		return imported;
	}

	/** Borra un override por sujeto y feature (revocar una ampliación, por ejemplo). */
	async removeByFeature(subjectType: PlanSubjectType, subjectId: string, featureKey: string): Promise<void> {
		await this.#model.deleteOne({ subjectType, subjectId, featureKey });
		this.#onChange();
	}

	async remove(actor: PlanOverrideActor, overrideId: string): Promise<void> {
		const doc = await this.#model.findOne({ id: overrideId }).lean<PlanOverrideDoc | null>();
		if (!doc) throw new PlanError(404, "OVERRIDE_NOT_FOUND", "Override no encontrado");
		if (actor.orgId && doc.orgId !== actor.orgId) {
			throw new PlanError(403, "ORG_ACCESS_DENIED", "No tienes acceso a este override");
		}
		await this.#model.deleteOne({ id: overrideId });
		this.#onChange();
	}
}
