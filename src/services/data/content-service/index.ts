import { BaseService } from "../../BaseService.js";
import type MongoProvider from "../../../providers/object/mongo/index.js";
import { LearningPathSchema } from "./models/path.model.js";
import { ArticleSchema } from "./models/article.model.js";
import { RatingSchema } from "./models/rating.model.js";
import { PathEndpoints } from "./endpoints/paths.js";
import { ArticleEndpoints } from "./endpoints/articles.js";
import { CommentEndpoints } from "./endpoints/comments.js";
import { ArticleAttachmentEndpoints } from "./endpoints/attachments.js";
import { RatingEndpoints } from "./endpoints/ratings.js";
import { EnableEndpoints, DisableEndpoints } from "../../core/EndpointManagerService/index.js";
import type { LearningPath, Article } from "../../../common/ADC/types/learning.js";
import type { Rating } from "../../../common/ADC/types/community.js";
import type AttachmentsUtility from "../../../utilities/attachments/attachments-utility/index.js";
import type CommentsUtility from "../../../utilities/comments/comments-utility/index.js";
import type { AttachmentsManager, SubPathContext } from "../../../utilities/attachments/attachments-utility/index.js";
import type { CommentsManager } from "../../../utilities/comments/comments-utility/index.js";
import type InternalS3Provider from "../../../providers/object/internal-s3-provider/index.js";
import { articleAttachmentsChecker } from "./permissions/articleAttachments.ts";
import { articleCommentsChecker } from "./permissions/articleComments.ts";

export default class ContentService extends BaseService {
	public readonly name = "content-service";
	private mongoProvider!: MongoProvider;

	@EnableEndpoints({
		managers: () => [PathEndpoints, ArticleEndpoints, CommentEndpoints, ArticleAttachmentEndpoints, RatingEndpoints],
	})
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		this.logger.logInfo("Iniciando servicio de contenido...");

		this.mongoProvider = this.getMyProvider<MongoProvider>("object/mongo");
		await this.waitForMongo();

		const PathModel = this.mongoProvider.createModel<LearningPath>("LearningPath", LearningPathSchema);
		const ArticleModel = this.mongoProvider.createModel<Article>("Article", ArticleSchema);
		const RatingModel = this.mongoProvider.createModel<Rating>("Rating", RatingSchema);

		PathEndpoints.init(PathModel, ArticleModel);
		ArticleEndpoints.init(ArticleModel, PathModel);
		RatingEndpoints.init(RatingModel, ArticleModel);

		// --- Attachments + Comments wiring ---
		let attachmentsManager: AttachmentsManager | null = null;
		let commentsManager: CommentsManager | null = null;
		try {
			const s3 = this.getMyProvider<InternalS3Provider>("object/internal-s3-provider");
			const attachmentsUtil = this.getMyUtility<AttachmentsUtility>("attachments-utility");
			const commentsUtil = this.getMyUtility<CommentsUtility>("comments-utility");
			const connection = this.mongoProvider.getConnection();

			attachmentsManager = attachmentsUtil.createAttachmentsManager({
				mongoConnection: connection,
				collectionName: "article_attachments",
				s3Provider: s3,
				basePath: "articles",
				subPathResolver: (ctx: SubPathContext) => {
					const slug = (ctx as any).articleSlug ?? ctx.ownerId ?? "_";
					return ctx.ownerType === "article-comment" ? `${slug}/comments` : `${slug}`;
				},
				permissionChecker: articleAttachmentsChecker,
			});

			commentsManager = commentsUtil.createCommentsManager({
				mongoConnection: connection,
				collectionName: "article_comments",
				attachmentsManager,
				permissionChecker: articleCommentsChecker,
			});
		} catch (e) {
			this.logger.logWarn(
				`No se pudieron inicializar attachments/comments del content-service: ${(e as Error).message}. Endpoints relacionados fallarán con 503 hasta que estén disponibles.`
			);
		}

		CommentEndpoints.init(ArticleModel, commentsManager as CommentsManager);
		ArticleAttachmentEndpoints.init(ArticleModel, attachmentsManager as AttachmentsManager);

		this.logger.logOk("[ContentService] Servicio de contenido iniciado correctamente");
	}

	private async waitForMongo(): Promise<void> {
		const maxWaitTime = 10000;
		const startTime = Date.now();

		while (!this.mongoProvider.isConnected() && Date.now() - startTime < maxWaitTime) {
			await new Promise((resolve) => setTimeout(resolve, 500));
		}

		if (!this.mongoProvider.isConnected()) {
			throw new Error("MongoDB no pudo conectarse en el tiempo esperado");
		}
	}

	@DisableEndpoints()
	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
	}
}
