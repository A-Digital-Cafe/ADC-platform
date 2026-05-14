# ProjectManagerService

Gestión de proyectos tipo Jira: proyectos, sprints, milestones, issues, labels, custom fields.

- Multi-tenant (`orgId`) con proyectos globales (`orgId: null`)
- Permisos por recurso `project-manager` (bitfield scopes)
- Integrado con `IdentityManagerService` para usuarios y grupos
- Update log append-only, issue keys autogenerados (`PROJ-123`)
- Kanban con columnas configurables y WIP limits (modo foco)
- Solicitudes de organización vía issue en proyecto configurado
