# Tablero de ensambles · Equipos MC

Plataforma para consultar el avance de fabricación de ensambles a partir de
archivos Excel.

## Formato del Excel

Cada archivo debe incluir una hoja llamada exactamente `PIEZAS DE ENSAMBLE`.
El nombre del archivo, sin `.xlsx` o `.xls`, se utiliza como nombre del
ensamble.

En el encabezado deben aparecer los campos:

| Campo | Ejemplo |
| --- | ---: |
| HECHAS | 180 |
| POR HACER | 20 |

El porcentaje se calcula como:

`HECHAS / (HECHAS + POR HACER) × 100`

Más abajo debe existir la tabla de piezas con, como mínimo, las columnas
`NOMBRE` y `CANTIDAD`.

## Desarrollo local

```bash
pnpm install
pnpm run dev
```

## Compilación

```bash
pnpm run build
```

## Persistencia con DigitalOcean Spaces

La plataforma no requiere inicio de sesión. Los Excel se guardan en un Space
privado y se consultan mediante una función serverless. El frontend nunca
recibe las credenciales del Space; sólo utiliza URLs firmadas de corta duración.

### 1. Crear el Space

1. En DigitalOcean, abrir **Spaces Object Storage** y crear un bucket Standard.
2. Crear una llave con permisos de lectura, escritura y eliminación limitada a
   ese Space.
3. En **Settings → CORS Configurations → Add**, configurar:

| Campo | Valor |
| --- | --- |
| Origin | `https://tablero-clavel-rusyn.ondigitalocean.app` |
| Allowed Methods | `GET`, `PUT` |
| Allowed Headers | `*` |
| Access Control Max Age | `5` |

### 2. Añadir la función a App Platform

En la aplicación **Tablero-Clavel**, elegir **Añadir componentes del código** y
crear un componente Functions desde el mismo repositorio y rama:

- Directorio fuente: `functions`
- Ruta pública del componente: `/api`

Agregar estas variables al componente. Las dos credenciales deben marcarse
como **Encrypt**:

| Variable | Valor |
| --- | --- |
| `SPACES_REGION` | Región del Space, por ejemplo `nyc3` |
| `SPACES_BUCKET` | Nombre del Space |
| `SPACES_ACCESS_KEY_ID` | Access Key del Space |
| `SPACES_SECRET_ACCESS_KEY` | Secret Key del Space |
| `APP_ORIGIN` | `https://tablero-clavel-rusyn.ondigitalocean.app` |

La función queda disponible en `/api/storage/documents`, que es la ruta usada
por defecto por el frontend. Para otra ruta, define `VITE_DOCUMENTS_API_URL`
durante la compilación del sitio estático.

> Al no existir inicio de sesión, cualquier persona que conozca la URL pública
> puede consultar, cargar o eliminar documentos del tablero.

## Órdenes de trabajo

La pantalla principal permite buscar, crear y seleccionar OT. Al crear una orden,
escribe su nombre y agrega una o más pestañas. Dentro del tablero puedes usar
**Agregar pestaña** para incorporar otras áreas después. Los Excel y avances se
separan por OT y pestaña. Los nombres duplicados se rechazan, ignorando mayúsculas
y acentos.

Las OT y pestañas se guardan en el mismo Space privado mediante el servicio
existente. Los archivos anteriores se asignan a **OT-EH-150**, con **GRÚA** y
**CHASIS** (antes CARROCERÍA), sin mover ni borrar los objetos originales.
Los documentos nuevos usan rutas documents/{orderId}/{pestaña codificada}/.
La publicación debe actualizar tanto el sitio como el componente Functions
desde este mismo commit. No requiere variables de entorno adicionales.

Validación: npm run build, npx tsc --noEmit y node --test tests/orders.test.mjs.
