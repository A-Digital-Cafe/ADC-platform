import { createAdcApi } from "@ui-library/utils/adc-fetch";

export const api = createAdcApi({
	basePath: "/api/pm",
	devPort: 3000,
	credentials: process.env.NODE_ENV === "development" ? "include" : "same-origin",
});

export interface IssueListParams {
	sprintId?: string;
	milestoneId?: string;
	assigneeId?: string;
	columnKey?: string;
	q?: string;
	orderBy?: "priority" | "createdAt" | "updatedAt";
	[key: string]: string | number | boolean | null | undefined;
}
