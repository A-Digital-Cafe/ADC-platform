import type { CommentsSectionSubmitDetail } from "@ui-library/utils/react-jsx";
import type { SessionData } from "@ui-library/utils/session";
import { canComment, canDeleteSocial } from "../utils/permissions";
import type { useArticleComments, DraftChangeDetail, RequestAttachmentDetail } from "../hooks/useArticleComments";

const DISCORD_URL = "https://discord.gg/vShXpyWTTq";

interface Props {
	session: SessionData;
	articleAuthorId?: string | null;
	state: ReturnType<typeof useArticleComments>;
}

export function ArticleCommentsBlock({ session, articleAuthorId, state }: Props) {
	const perms = session.user?.perms ?? [];
	const sessionAllowsComment = session.authenticated && canComment(perms);
	const sessionCanModerate = session.authenticated && canDeleteSocial(perms);

	return (
		<div className="mt-8">
			<h3>Comentarios</h3>
			{!session.authenticated && (
				<div className="bg-twarn rounded-xxl p-4 text-warn">
					<p className="text-sm">Inicia sesión para comentar.</p>
				</div>
			)}
			{session.authenticated && !sessionAllowsComment && (
				<div className="bg-twarn rounded-xxl p-6 text-warn">
					<p className="text-sm">
						Solo los usuarios con rol VIP o Server Booster pueden comentar. Obtén estos roles en nuestro servidor de Discord para
						habilitar comentarios.
					</p>
					<a
						href={DISCORD_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-block mt-4 px-4 py-2 bg-button text-tprimary rounded-xxl no-underline hover:brightness-105"
					>
						Unirse al Discord
					</a>
				</div>
			)}
			{session.authenticated && (
				<adc-comments-section
					comments={state.comments}
					session={{
						authenticated: session.authenticated,
						userId: session.user?.id,
						canComment: sessionAllowsComment,
						canModerate: sessionCanModerate,
					}}
					submitting={state.posting}
					loading={state.loading}
					hasMore={state.hasMore}
					loadingMore={state.loadingMore}
					articleAuthorId={articleAuthorId || undefined}
					attachmentUrls={state.attachmentUrls}
					initialDraftBlocks={state.draftBlocks}
					initialDraftAttachmentIds={state.draftAttachmentIds}
					onadcSubmit={(ev: CustomEvent<CommentsSectionSubmitDetail>) => {
						void state.submit(ev.detail);
					}}
					onadcDelete={(ev: CustomEvent<string>) => {
						void state.remove(ev.detail);
					}}
					onadcReactToggle={(ev: CustomEvent<{ commentId: string; emoji: string; reacted: boolean }>) => {
						void state.reactToggle(ev.detail);
					}}
					onadcLoadMore={() => {
						void state.loadMore();
					}}
					onadcDraftChange={(ev: CustomEvent<DraftChangeDetail>) => {
						void state.draftChange(ev.detail);
					}}
					onadcRequestAttachment={(ev: CustomEvent<RequestAttachmentDetail>) => state.requestAttachment(ev.detail)}
				/>
			)}
		</div>
	);
}
