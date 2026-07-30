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

## Persistencia con Supabase

La plataforma guarda los Excel en un bucket privado de Supabase y registra cada
documento en PostgreSQL. La configuración inicial está en
`supabase/setup.sql`.

1. Ejecutar `supabase/setup.sql` en el SQL Editor del proyecto.
2. Crear los usuarios autorizados en Authentication → Users.
3. Los usuarios deben utilizar un correo terminado en `@equiposmc.com`.
