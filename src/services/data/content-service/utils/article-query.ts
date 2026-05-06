import type { Model, PipelineStage } from "mongoose";
import type { Article, LearningPath, PathItem } from "../../../../common/ADC/types/learning.js";

interface ListArticlesQuery {
	pathSlug?: string;
	listed?: string;
	authorId?: string;
	q?: string;
	limit?: string;
	start?: string;
}

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;

export interface ArticleListResult {
	articles: Article[];
	total: number;
	start: number;
	limit: number;
}

async function resolvePathSlugs(pathModel: Model<LearningPath>, pathSlug: string): Promise<string[] | null> {
	const parent = await pathModel.findOne({ slug: pathSlug }).select("items").lean();
	if (!parent?.items?.length) return null;

	const direct = parent.items.filter((i: PathItem) => i.type === "article").map((i: PathItem) => i.slug);
	const subPathSlugs = parent.items.filter((i: PathItem) => i.type === "path").map((i: PathItem) => i.slug);

	if (subPathSlugs.length === 0) return [...new Set(direct)];

	const subPaths = await pathModel
		.find({ slug: { $in: subPathSlugs } })
		.select("items")
		.lean();
	const fromSubs = subPaths.flatMap((sp) => (sp.items || []).filter((i: PathItem) => i.type === "article").map((i: PathItem) => i.slug));
	return [...new Set([...direct, ...fromSubs])];
}

export async function buildArticleListPipeline(
	articleModel: Model<Article>,
	pathModel: Model<LearningPath>,
	query: ListArticlesQuery
): Promise<ArticleListResult> {
	const where: Record<string, any> = {};

	const limit = Math.min(Math.max(query.limit ? Number.parseInt(query.limit) : DEFAULT_LIMIT, 1), MAX_LIMIT);
	const start = Math.max(query.start ? Number.parseInt(query.start) : 0, 0);

	if (query.pathSlug) {
		const slugs = await resolvePathSlugs(pathModel, query.pathSlug);
		if (slugs === null) return { articles: [], total: 0, start, limit };
		where.slug = { $in: slugs };
	}

	if (query.listed !== undefined) where.listed = query.listed === "true";
	if (query.authorId) where.authorId = query.authorId;

	if (query.q) {
		const safe = query.q.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
		where.title = { $regex: safe, $options: "i" };
	}

	const pipeline: PipelineStage[] = [
		{ $match: where },
		{ $lookup: { from: "learningpaths", localField: "pathSlug", foreignField: "slug", as: "lp" } },
		{ $unwind: { path: "$lp", preserveNullAndEmptyArrays: true } },
		{ $addFields: { pathColor: "$lp.color" } },
		{
			$project: {
				_id: 0,
				slug: 1,
				title: 1,
				pathSlug: 1,
				pathColor: 1,
				description: 1,
				blocks: 1,
				videoUrl: 1,
				image: 1,
				authorId: 1,
				createdAt: 1,
				updatedAt: 1,
				listed: 1,
			},
		},
		{ $sort: { createdAt: -1 } },
		{
			$facet: {
				articles: [{ $skip: start }, { $limit: limit }],
				total: [{ $count: "count" }],
			},
		},
	];

	const [result] = (await articleModel.aggregate(pipeline)) as Array<{ articles: Article[]; total: Array<{ count: number }> }>;
	return {
		articles: result?.articles ?? [],
		total: result?.total?.[0]?.count ?? 0,
		start,
		limit,
	};
}
