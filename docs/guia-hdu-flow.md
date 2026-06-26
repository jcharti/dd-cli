# Guía rápida: flujo de HDUs

Esta guía cubre el ciclo de vida completo de una HDU en DevFlow IA v0.7+:
desde que el PMO la crea hasta que el dev la cierra al mergear el PR.

Cada paso tiene **qué hacer** + **si falla** inline. Si te perdés, corré
`dd-cli help-ctx --client=<slug>` (te muestra solo el paso actual) o
`/devflow-ia:troubleshoot <slug>` desde Claude.

---

## Paso 1 — PMO: crear la HDU (estado `draft`)

**Quién:** PMO. **Comando:**

```bash
dd-cli hdu new "Login con SSO portal cliente" --client=iprsa \
  --app=portal-web \
  --priority=alta \
  --created-by=carlos@cliente.cl
```

Esto crea `~/.devflow/clients/iprsa/hdus/HDU-1-login-con-sso-portal-cliente.md`
con frontmatter mínimo + template de cuerpo. Le asigna `HDU-1` (siguiente
disponible). Estado: `draft`.

**Después de crear:** abrí el archivo y completá:
- `## Como` `## Quiero` `## Para` (perfil + feature + valor).
- `## Criterios de aceptación` (Gherkin: Dado/Cuando/Entonces).
- `## Notas técnicas` (contexto que el dev necesita).

**Si falla:**
- `CLIENT_NOT_REGISTERED` → registrar el cliente primero: `dd-cli client new <slug>`.
- `CONTEXT_CACHE_MISSING` → `dd-cli pull-context <slug>` y reintentar.
- `INVALID_INPUT (slug del título)` → el slug se genera del título, evitá títulos vacíos o solo con caracteres especiales.

---

## Paso 2 — PMO: refinar (opcional, sigue en `draft`)

**Quién:** PMO con Claude. **Skill:**

```
/devflow-ia:enrich-us <título o brief>
```

Esta skill toma el brief y agrega edge cases, criterios técnicos faltantes,
riesgos. Sirve cuando la HDU está cruda y querés mejorarla antes de la
aprobación del TL.

Después del refine, editar manualmente el archivo y guardar.

---

## Paso 3 — Tech Lead: aprobar (`draft` → `approved`)

**Quién:** Tech Lead. **Comando:**

```bash
dd-cli hdu approve HDU-1 --client=iprsa --by=tl@cliente.cl
```

Esto cambia el status, escribe `approved_by` + `approved_at`, y agrega
una línea al `_transitions.jsonl`. Solo el TL debería hacer esto — por
eso `--by=<email>` es obligatorio (audit).

Vía skill maestra:

```
/devflow-ia:hdu-board <slug>
```

modo 2 (aprobar pendientes) procesa las HDUs draft una a una con
confirmación.

**Si falla:**
- `HDU_NOT_FOUND` → listá con `dd-cli hdu list --client=<slug>`.
- `INVALID_INPUT (transición ilegal)` → la HDU ya está en otro estado.
  Revisá el historial con `dd-cli hdu show <id> --client=<slug>`.

---

## Paso 4 — Tech Lead: asignar (`approved`, agrega `assigned_to`)

**Quién:** Tech Lead. **Comando:**

```bash
dd-cli hdu assign HDU-1 --client=iprsa --to=jorge@cliente.cl --by=tl@cliente.cl
```

Opcional pero recomendado. Si no asignás, cualquier dev puede tomarla con
`dd-cli hdu claim`.

---

## Paso 5 — Dev: decidir qué tomar

**Quién:** Dev. **Comando:**

```bash
dd-cli hdu next --client=iprsa --user=jorge@cliente.cl --explain
```

Devuelve la HDU sugerida con breakdown de score:
- Prioridad (crítica > alta > media > baja).
- App match (apps que tocó recientemente).
- Continuidad de dev_type (ritmo con la última cerrada).
- Sprint activo.
- Antigüedad (anti-starvation).

Vía skill:

```
/devflow-ia:pick-next <slug>
```

(Sprint 6) — la cara conversacional de `hdu next`.

---

## Paso 6 — Dev: claim + start session

```bash
dd-cli hdu claim HDU-1 --client=iprsa --user=jorge@cliente.cl
dd-cli hdu start HDU-1 --client=iprsa --by=jorge@cliente.cl
cd <repo-de-codigo-del-cliente>
dd-cli start-session HDU-1
```

`claim` se asigna a vos mismo. `start` mueve a `in-progress`. `start-session`
arranca la sesión de Claude Code con el método DevFlow (skills,
enforcement, statusline).

**Si falla `start`:** la HDU debe estar en `approved`. Si está en
`in-progress` ya arrancó. Si está en `draft`, el TL no la aprobó todavía.

---

## Paso 7 — Dev: enviar a review (`in-progress` → `in-review`)

Cuando el PR/MR del código está abierto:

```bash
dd-cli hdu review HDU-1 --client=iprsa --by=jorge@cliente.cl --reason="MR #43 abierto"
```

El `--reason` es opcional pero recomendado (queda en transitions log).

---

## Paso 8 — Tech Lead aprueba el PR → Dev cierra (`in-review` → `done`)

Cuando el PR mergea:

```bash
dd-cli hdu close HDU-1 --client=iprsa --by=jorge@cliente.cl
```

Si el TL implementa el CI job de transiciones (S5-4 pendiente), esto
puede ser automático al merge. Por ahora, manual.

---

## Cancelar una HDU

En cualquier momento antes de `done`:

```bash
dd-cli hdu cancel HDU-1 --client=iprsa --reason="Negocio cambió de scope" --by=carlos@cliente.cl
```

`--reason` es obligatorio. Las canceladas NO cuentan en throughput pero
sí en `cancellation_rate` (signal de churn).

Si después querés retomar: nueva HDU con `references: [HDU-1]` en el
frontmatter.

---

## Ver métricas

```bash
dd-cli stats --client=iprsa --period=30d
dd-cli stats --client=iprsa --period=30d --by=dev
```

Reporta throughput, lead time (draft → done), cycle time (approved → done),
mix de dev_types, cancelaciones, por dev.

Vía skill:

```
/devflow-ia:stats-review <slug> [<período>]
```

interpreta los números en lenguaje humano.

---

## Apéndice: ciclo de vida (state machine)

```
draft ─approve→ approved ─start→ in-progress ─review→ in-review ─close→ done
  │                │                  │                   │
  │                ↓                  ↓                   │
  ↓             cancelled         cancelled               ↓
cancelled         (cualquiera)    (cualquiera)         cancelled
                                                        (cualquiera)
Rollbacks legales:
  approved → draft        (TL retira aprobación)
  in-progress → approved  (dev pausa)
  in-review → in-progress (TL rechaza review)
```

Estados terminales: `done`, `cancelled` (no se puede salir).

Validación: `dd-cli hdu <comando>` rechaza transiciones ilegales con
exit code 3 + listado de las legales desde el estado actual.

---

## Apéndice: archivos generados

```
<cliente>-devflow-context/
└── hdus/
    ├── _index.yml             ← derivado, regenerable con `dd-cli hdu index`
    ├── _transitions.jsonl     ← append-only, fuente de stats
    ├── HDU-1-login-sso.md     ← una por HDU (frontmatter + body)
    ├── HDU-2-dashboard.md
    └── ...
```

`_index.yml` y `_transitions.jsonl` se commitean. La app web del futuro
(forward-compat H-6) lee los mismos archivos sin migración.

---

**Última actualización:** Sprint 5 (v0.7.0). Para sugerencias:
`/devflow-ia:troubleshoot` o issue en `github.com/jcharti/dd-cli`.
