// Barrel de endpoint managers (singletons). Mantiene el shell del servicio
// (index.ts) libre de una import por cada superficie HTTP.
export { UserEndpoints } from "./users.js";
export { RoleEndpoints } from "./roles.js";
export { GroupEndpoints } from "./groups.js";
export { OrgEndpoints } from "./organizations.js";
export { RegionEndpoints } from "./regions.js";
export { StatsEndpoints } from "./stats.js";
export { AvatarEndpoints } from "./avatar.js";
