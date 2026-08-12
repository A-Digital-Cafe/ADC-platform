# file-storage

Almacenamiento de blobs en el **disco local** del proceso (`./temp/file-storage` por defecto,
configurable con `basePath`). Clave → un archivo `.bin`; el nombre se aplana con `path.basename`
para cerrar el path traversal.

## Es local al nodo, a propósito

Lo que se escriba acá **no lo ve ningún otro nodo** y no sobrevive a un despliegue que reconstruya
el directorio. Es correcto para caché y scratch de un proceso, y no para nada que un segundo nodo
tenga que leer: para eso está `object/internal-s3-provider`, que sirve a todo el clúster.

No hace falta migrarlo: su único consumidor hoy es `json-file-crud`, y su contenido es reproducible.
Si algún día un módulo necesita compartir estos archivos entre nodos, la respuesta es cambiar de
provider, no replicar el directorio.
