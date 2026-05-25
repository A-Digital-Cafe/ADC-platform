# SEOService

Servicio que permite a cada app pública declarar las URLs que expone para
construir dinámicamente el `sitemap.xml` por host.

## Uso

```ts
const seo = this.getMyService<SEOService>("SEOService");
seo.registerOnSitemap({
	appName: this.name,
	hosting: this.config?.uiModule?.hosting,
	appDir: this.appDir, // mtime de la carpeta = lastmod por defecto
	paths: ["/", "/login"], // o () => Promise<SitemapPath[] | string[]>
});
```

Registra `GET /sitemap.xml` por cada host. Cuando una entrada no declara
`lastmod`, se usa el `mtime` del `appDir` como valor por defecto.

### Hosts índice (`isIndex: true`)

Marca hosts concretos (no comodines) como índices: `/sitemap.xml` devuelve un
`<sitemapindex>` enlazando `/sitemaps/main.xml` (URLs propias del host) y el
`/sitemap.xml` de los hosts hermanos que comparten dominio base.
