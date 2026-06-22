---
name: new-spec
description: Skill maestra — orquesta análisis del repo y genera SPEC técnico ramificado por dev_type
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.3.0
category: Spec
tags: [spec, interview, devflow-ia, orchestrator]
model: opus
model_rationale: Orquesta sub-skills + decisiones arquitectónicas en 5 modos. LOCK del dev_type ocurre acá. Errores se propagan a todo el flujo downstream.
fallback_model: sonnet
applies_to_dev_types: [greenfield, brownfield-feature, brownfield-refactor, modernizacion, integracion-externa]
orchestrates:
  - /devflow-ia:init-repo-context  (brownfield-*/modernizacion/integracion — si falta REPO-CONTEXT)
  - /devflow-ia:capture-baseline   (brownfield-refactor — si falta BASELINE)
reads:
  - "CLAUDE.md"
  - ".devflow/session.json (dev_type, dev_type_locked, apps_affected, legacy_system, vendor)"
  - ".ai/REPO-CONTEXT.md (generado automáticamente si no existe)"
  - ".ai/BASELINE-*.md (generado automáticamente si dev_type == brownfield-refactor)"
  - "<SPEC_PATH>/SPEC-TEMPLATE.md"
writes:
  - "<SPEC_PATH>/SPEC-<slug>.md"
mcp_tools:
  - devflow_save_spec (LOCK dev_type)
---

Eres un arquitecto de software experto en el método DevFlow IA. Tu objetivo es guiar al desarrollador con una entrevista estructurada y generar un SPEC maestro — la única fuente de verdad técnica para la feature.

**Argumento opcional:** Si `$ARGUMENTS` no está vacío, úsalo como nombre tentativo de la feature.

**Importante: el `dev_type` viene definido en `session.json` (capturado por PMO en portal, validado por Tech Lead al aprobar HDU). NO lo preguntes en la entrevista — léelo y ramifica el flujo. Al cerrar la SPEC, llama `devflow_save_spec(...)` que hace LOCK del tipo.**

---

## PASO 0 — Leer configuración del proyecto y session

```bash
grep -E "SPEC_PATH:|APPS_PATH:|LEGACY_SYSTEM:|STACK:" CLAUDE.md 2>/dev/null
cat .devflow/session.json 2>/dev/null
```

- De CLAUDE.md: `SPEC_PATH` (default `docs/specs/`), `APPS_PATH`, `STACK`
- De session.json: `dev_type`, `dev_type_locked`, `feature_id`, `feature_name`, `apps_affected[]`, `legacy_system?`, `vendor?`, `repo_context_path?`, `baseline_path?`

**Si `dev_type` está vacío** → aborta con: "Esta sesión no tiene `dev_type` definido. Ejecuta `dd-cli start-session <feature-id>` primero, o pide al PMO que clasifique la HDU en el portal."

---

## PASO 0.5 — Preparación automática por dev_type

**Este skill es el orquestador. No aborta — ejecuta las skills necesarias antes de continuar.**

Verificar y completar automáticamente según `dev_type`:

### Para `brownfield-feature`, `brownfield-refactor`, `modernizacion`, `integracion-externa` (si toca app existente)

```bash
ls .ai/REPO-CONTEXT.md 2>/dev/null && echo "existe" || echo "falta"
```

**Si `.ai/REPO-CONTEXT.md` NO existe:**

Anunciar al dev antes de ejecutar:
```
Antes de generar el SPEC, necesito entender cómo está construido este repo.
Voy a analizar el código ahora (tarda 1-2 minutos)...
```

→ Ejecutar automáticamente: `/devflow-ia:init-repo-context`

Esperar a que complete y confirmar que `.ai/REPO-CONTEXT.md` fue generado.
Luego continuar con el PASO 1 usando ese contexto.

**Si `.ai/REPO-CONTEXT.md` ya existe:**
Leer su contenido (especialmente §2 Stack técnico, §3 Arquitectura, §4 Entry points, §5 Datos).
Mostrar al dev un resumen de lo que se pre-cargará:
```
Tengo el contexto del repo (escaneado el <fecha>):
  Stack: <stack detectado>
  Apps/módulos: <lista>
  Auth: <patrón detectado>
¿Continúo con este contexto o lo actualizo primero?
```

Si el dev pide actualizar → ejecutar `/devflow-ia:init-repo-context --refresh` antes de continuar.

---

### Solo para `brownfield-refactor`

```bash
ls .ai/BASELINE-*.md 2>/dev/null && echo "existe" || echo "falta"
```

**Si `.ai/BASELINE-*.md` NO existe o no tiene `locked_at`:**

Anunciar al dev:
```
Para un refactor seguro, necesito capturar el estado actual del código
antes de tocar nada (tests, métricas, contratos públicos).
Voy a hacer ese snapshot ahora...
```

Preguntar (única pregunta antes de ejecutar):
```
¿Cuál es el módulo o path principal que vas a refactorizar?
Ej: src/modules/cobranza  o  src/services/calculo-mora.ts
```

→ Ejecutar automáticamente: `/devflow-ia:capture-baseline <modulo>`

Esperar a que complete. El baseline puede tener `risk_level: high` si hay pocos tests — en ese caso mostrar el warning pero no bloquear (el tech lead lo verá en el Gate G1.5).

Continuar con el PASO 1 usando el BASELINE generado.

**Si `.ai/BASELINE-*.md` ya existe con `locked_at`:**
Leer y mostrar resumen:
```
Tengo el baseline del módulo (capturado el <fecha>):
  Tests: <N>  |  Coverage: <%>  |  risk_level: <nivel>
  Contratos públicos: <N>
¿Continúo con este baseline?
```

---

### Para `modernizacion`

Si `session.legacy_system` es null → preguntar:
```
¿Cuál es el nombre/path del sistema legacy que vas a reemplazar?
```
Actualizar `session.legacy_system` con la respuesta.

Si `.ai/REPO-CONTEXT.md` NO existe → igual que arriba, ejecutar `/devflow-ia:init-repo-context --on=<legacy-path>` automáticamente.

---

### Para `integracion-externa`

Si `session.vendor` es null → preguntar:
```
¿Con qué vendor/servicio externo se integra esta feature?
  - Nombre del vendor: ___
  - Versión de la API: ___
  - URL de documentación (opcional): ___
```

Si la integración toca una app existente y no hay REPO-CONTEXT → ejecutar `/devflow-ia:init-repo-context` automáticamente.

---

### Para `greenfield`

No hay precondiciones de análisis. Continuar directamente con PASO 1.

---

## PASO 1 — Verificar contexto

```bash
ls [SPEC_PATH]/SPEC-*.md 2>/dev/null | sed 's|.*SPEC-||;s|\.md||' | grep -v TEMPLATE | sort
```

Lee silenciosamente:
- `[SPEC_PATH]/SPEC-TEMPLATE.md` (estructura canónica)
- Lista de specs existentes (para no duplicar slugs)
- `.ai/REPO-CONTEXT.md` si existe (para pre-llenar Grupo B)
- `.ai/BASELINE-*.md` si existe (para refactor)

Si hay un argumento en `$ARGUMENTS`, proponer usarlo como slug y confirmar.

---

## PASO 2 — Entrevista (grupos de preguntas)

**Espera la respuesta de cada grupo antes de continuar al siguiente.**
**No preguntes `dev_type` — viene de session.json. Solo confirma al dev cuál es y ramifica.**

### Grupo A — Identidad

```
Vamos a construir el SPEC. Estoy trabajando como dev_type = <session.dev_type>.

[Si dev_type == brownfield-refactor]: Leí .ai/BASELINE-<modulo>.md, voy a respetar
   los contratos públicos declarados.
[Si dev_type ∈ brownfield-*/modernizacion]: Leí .ai/REPO-CONTEXT.md (last_scanned
   <fecha>), no te voy a re-preguntar lo que ya está ahí.

1. ¿Cuál es el nombre de la feature?
   (sugerido desde HDU: <feature_name>)
   (ej: "Dashboard Ventas", "Módulo Comisiones", "Registro de Contratos")

3. ¿Qué problema resuelve en 1-2 oraciones? ¿Para qué perfil de usuario?

4. ¿Qué apps o servicios involucra?
   (ej: solo nueva app, o: api-core + frontend + nueva app)
```

### Grupo B — Datos y sistema (bifurca por `dev_type`)

**Si `dev_type == greenfield`:**
```
5. ¿Necesita tablas o entidades propias? ¿Cuáles y para qué?
6. ¿Qué perfiles de usuario lo usarán? ¿Qué permisos necesitan?
7. ¿Cuál sería el MVP — el subset mínimo para una primera versión útil?
```

**Si `dev_type == brownfield-feature`:**
```
[Pre-cargado desde .ai/REPO-CONTEXT.md §5 Datos:]
   Detecté las siguientes tablas / entidades en el repo:
   <listado del REPO-CONTEXT>

5. ¿Cuáles de esas tablas vas a leer/escribir en esta feature?
6. ¿Necesitás tablas NUEVAS además? (en el mismo schema / nuevo schema)
7. ¿Hay tablas con más de 100K filas que vayas a consultar? ¿Hay índices?
8. ¿Qué perfiles de usuario lo usarán? ¿Qué permisos necesitan?
9. ¿Cuál sería el MVP?
```

**Si `dev_type == brownfield-refactor`:**
```
[Pre-cargado desde .ai/BASELINE-<modulo>.md:]
   Contratos públicos a preservar:
   <listado de §3 del BASELINE: endpoints, exports, eventos, schema DB>
   risk_level: <high|medium|low>
   tests_count: <N>  ·  golden tests: <N>

5. ¿Cuál es la métrica que mejora el refactor? (latencia, líneas, complejidad, costo)
6. ¿Plan: strangler (incremental, mantiene legacy en paralelo) /
   incremental (módulo por módulo con tests) / big-bang (alto riesgo)?
7. ¿Hay reglas de no-regresión adicionales NO capturadas en BASELINE?
8. ¿Necesitás tests nuevos antes del refactor? (recomendado si tests_count<5)
9. ¿Cuál es el criterio de éxito cuantitativo? (ej: "P95 baja de 200ms a 100ms")
```

**Si `dev_type == modernizacion`:**
```
[Pre-cargado desde .ai/REPO-CONTEXT.md del legacy:]
   Sistema legacy: <session.legacy_system>
   Servicios involucrados: <lista>

5. ¿Cuáles son las funcionalidades del legacy que DEBEN mantenerse idénticas?
   (matriz paridad — listar una por una)
6. ¿Cuáles se DESCARTAN o se POSTERGAN? (con justificación)
7. ¿Hay reglas de negocio críticas (fórmulas, validaciones, edge cases)?
8. ¿Hay sistemas externos que consumen el legacy y NO pueden romperse?
9. ¿Plan de rollback si algo falla en producción?
10. ¿Rampa de tráfico: 5%→25%→100% en cuántos días? ¿Shadow testing habilitado?
11. ¿Cuándo se deprecará el legacy? (fecha objetivo)
```

**Si `dev_type == integracion-externa`:**
```
[Pre-cargado desde session.vendor:]
   Vendor: <session.vendor.name>
   API version: <session.vendor.api_version>
   Documentación: <session.vendor.docs_url>

5. ¿Auth con el vendor? (OAuth2 / API key / mTLS / Basic)
   - Si OAuth2: ¿qué scopes / refresh token / token storage?
6. ¿Rate limits del vendor? (req/min, req/día, burst)
7. ¿Estrategia de retry y backoff?
   - Operaciones idempotentes vs no idempotentes
   - Qué eventos requieren idempotency key
8. ¿Sandbox vs prod? ¿Cómo se cambia (feature flag, env var)?
9. ¿Recibís webhooks del vendor?
   - Endpoint a exponer
   - Verificación de firma (HMAC, JWT, IP whitelist)
10. ¿Datos sensibles (PII, PCI)? ¿Política de enmascaramiento en logs?
11. ¿SLA del vendor y comportamiento si está caído? (degrade, queue, error)
```

### Grupo C — Interfaces y aceptación

```
[Último grupo — casi terminamos]

A. ¿Cuáles son los endpoints API o componentes UI principales?
   Los 3-5 más importantes para entender el alcance.

B. ¿Cómo sabemos que está terminado?
   2-4 criterios observables. Ej: "dado un supervisor, cuando abre la app,
   ve el ranking de su equipo filtrado por período".

C. ¿Hay requerimientos de performance?
   Ej: "carga en < 2 segundos", "soporta N usuarios concurrentes".
   Si no hay: "sin requerimientos especiales".
```

---

## PASO 3 — Aclarar ambigüedades (una sola ronda si es necesario)

Solo preguntar si la información faltante cambiaría el diseño. Para detalles menores: `[pendiente: confirmar]`.

---

## PASO 4 — Generar el SPEC

### 4.1 Slug

Kebab-case del nombre. Verificar que no exista ya. Si existe, agregar sufijo.

### 4.2 Construir el documento

Usa `[SPEC_PATH]/SPEC-TEMPLATE.md` como base.

**Secciones por dev_type:**

| Sección | greenfield | brownfield-feature | brownfield-refactor | modernizacion | integracion-externa |
|---------|:---:|:---:|:---:|:---:|:---:|
| 3.1 Estado de partida | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3.2 Tablas / datos legacy | — | ✅ | ✅ | ✅ | — |
| 3.3 Sistema legacy actual | — | — | — | ✅ | — |
| 3.4 Vendor + auth + API | — | — | — | — | ✅ |
| 3.5 Contratos a preservar (de BASELINE) | — | — | ✅ | — | — |
| 5.1 Endpoints / UI | ✅ | ✅ | (preservados) | ✅ | ✅ |
| 5.2 Mapeo old→new | — | — | — | ✅ | — |
| 5.3 Adaptador / anti-corrupción | — | — | — | — | ✅ |
| 6.1 Criterios de no-regresión | — | — | ✅ | ✅ | — |
| 6.2 Matriz paridad funcional | — | — | — | ✅ | — |
| 6.3 Idempotencia + retries | — | — | — | — | ✅ |
| 7.1 Plan rollback | — | — | (si big-bang) | ✅ | — |
| 7.2 Rampa de tráfico | — | — | — | ✅ | — |
| Checklist refactor | — | — | ✅ | — | — |
| Checklist integración security | — | — | — | — | ✅ |

**Reglas:**
- `[pendiente: confirmar]` para información faltante — nunca inventar
- Criterios de aceptación en formato "Dado X, cuando Y, entonces Z"
- **Frontmatter del SPEC debe incluir `dev_type` y `dev_type_locked_at`**
- Estado `draft` si hay [pendiente], `ready-for-implementation` si está completo

### 4.3 Escribir el archivo + LOCK del dev_type

Crear: `[SPEC_PATH]/SPEC-<slug>.md` con frontmatter:
```yaml
---
id: SPEC-<slug>
feature_id: <session.feature_id>
title: <feature_name>
dev_type: <session.dev_type>
dev_type_subtype: <session.dev_type_subtype>
dev_type_locked_at: <ISO now>
apps_affected: <session.apps_affected>
status: draft | ready-for-implementation
---
```

**Llamar MCP `devflow_save_spec`:**
```
devflow_save_spec({
  spec_md: <contenido>,
  feature_id: <session.feature_id>,
  dev_type: <session.dev_type>,
  dev_type_rationale: <session.dev_type_rationale>
})
```

Esto hace **LOCK** del `dev_type` server-side. Después solo `dd-cli reclassify` puede cambiarlo (rol Tech Lead + audit-log).

---

## PASO 5 — Resumen

```
SPEC generado: [SPEC_PATH]/SPEC-<slug>.md
Estado: draft / ready-for-implementation
Tipo: greenfield / brownfield / modernizacion

Secciones [pendiente]:
  - [lista]

Próximos pasos:
  1. Completar los [pendiente] con el stakeholder
  2. Para cada app: /derive-spec <slug> <app>
  3. Crear .ai/PROGRESS.md antes de arrancar
```

---

## REGLAS

- No generar código — solo documentación
- No inventar tablas, columnas, reglas de negocio o decisiones
- El SPEC debe ser útil para un developer que no estuvo en la conversación
- Mantener el idioma del proyecto (ver CLAUDE.md)
