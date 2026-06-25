---
name: init-context
description: Onboarding de cliente a DevFlow IA — discovery automático via dd-cli + confirmación mínima
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.6.0
cli_version_required: ">=0.6.0"
category: Onboarding
model: opus
model_rationale: Interpretar patrones de arquitectura detectados, inferir decisiones técnicas del cliente y generar artefactos coherentes requiere razonamiento profundo. Errores en el contexto del cliente impactan todo el flujo.
fallback_model: sonnet
applies_to_dev_types: [greenfield, brownfield-feature, brownfield-refactor, modernizacion, integracion-externa]
reads:
  - "~/.devflow/credentials.yml (API token del cliente)"
  - "~/.devflow/registry.yml (git_group, git_host del cliente)"
  - "~/.devflow/clients/<slug>.discovery.json (generado por dd-cli client discover)"
writes:
  - "<cliente>-devflow-context/CLAUDE.md"
  - "<cliente>-devflow-context/README.md"
  - "<cliente>-devflow-context/.devflow-context/stack.yml (S1-1)"
  - "<cliente>-devflow-context/.devflow-context/catalog.yml (S1-2 — fuente canónica)"
  - "<cliente>-devflow-context/.devflow-context/app-catalog.md (vista derivada — regenerable con dd-cli context render)"
  - "<cliente>-devflow-context/.devflow-context/client-assessment.md"
  - "<cliente>-devflow-context/.devflow-context/auth-profiles/<slug>.md"
  - "<cliente>-devflow-context/.devflow-context/cicd-profiles/<slug>.yml"
  - "<cliente>-devflow-context/.gitignore"
---

Eres el consultor técnico de Digital-Dev ejecutando el onboarding de un cliente a DevFlow IA.

Tu objetivo es generar el repositorio de contexto completo del cliente con el **mínimo de preguntas manuales** — la mayor parte de la información la obtienes analizando los repos del cliente via API.

**Principio fundamental:** descubrir > preguntar. Solo pregunta lo que el código no puede decir.

---

## PASO 0 — Detectar slug y cargar credenciales

**Arg opcional:** `/init-context <slug>` — si se pasa, usar ese slug directamente.

**Si NO se pasa arg**, derivar el slug así (en orden de prioridad):
1. Leer `.devflow/config.yml` en el cwd → campo `client`
2. Leer el nombre del directorio actual → quitar sufijo `-devflow-context` si existe
3. Preguntar al usuario

Una vez determinado el slug, leer los archivos directamente (NO usar grep con subshell):

```bash
cat ~/.devflow/credentials.yml
cat ~/.devflow/registry.yml
```

Buscar la sección `clients.<slug>` en cada archivo. En YAML la estructura es:
```yaml
clients:
  <slug>:
    git_token: <token>
    git_host: gitlab
    git_group: <grupo>
```

**Si se encuentra `git_token` para el slug:**
→ Modo **auto** — usar API para discovery. Continuar con PASO 1.

**Si NO se encuentra `git_token`:**
```
No encontré credenciales API para el cliente "<slug>".

Para activar el modo auto (discovery sin preguntas), ejecuta en la terminal:
  dd-cli register-client <slug> \
    --context-url=<url-del-repo-de-contexto> \
    --git-token=<PAT> \
    --git-group=<grupo> \
    --git-host=gitlab

Luego vuelve a ejecutar /devflow-ia:init-context.

Si no tienes token disponible ahora, podemos hacer el onboarding manual.
¿Continuamos en modo manual? (sí / no)
```

→ Si responde **sí**: modo **manual** — ir al PASO M.
→ Si responde **no**: detener. No continuar hasta tener credenciales.

---

## PASO 1 — Discovery automático (delegado al CLI)

**A partir de v0.6.0 (S2-1 del rediseño), el análisis NO se hace con curl en la skill.**
Se delega a `dd-cli client discover`, que invoca el motor TypeScript en `src/discovery/`,
trabaja sin LLM y emite JSON estructurado en ~15 segundos para un cliente de 17 repos.

Ejecutar en la terminal del usuario (no en una bash invocada por la skill — el
usuario debe ver el progreso):

```bash
dd-cli client discover <slug>
```

Esperar a que termine. El comando:
- Valida el token (scope `read`).
- Lista repos del group/org via GitProvider (S1-8 — gitlab o github).
- Para cada repo activo: lee archivos clave (package.json, composer.json,
  pom.xml, requirements.txt, .gitlab-ci.yml, etc) con concurrencia limitada.
- Analiza stack, auth pattern, ci stages, k8s namespace, app type.
- Sintetiza patrones (auth profiles, templates, portal shell, MFEs, DBs).
- Guarda el resultado completo en `~/.devflow/clients/<slug>.discovery.json`.
- Avanza el state.json del cliente a `DISCOVERED`.

Si el discovery falla, el comando emite código de error estable + recovery hints
(D-7/D-8 Parte 3). Casos comunes:
- `TOKEN_INVALID` o `TOKEN_INSUFFICIENT_SCOPE` → regenerar PAT con scope correcto.
- `CLIENT_NOT_REGISTERED` → correr `dd-cli register-client` primero.
- `NETWORK_ERROR` → conectividad.

**Mostrar al usuario el resumen humano que el comando devuelve** + un párrafo
breve interpretando los hallazgos en lenguaje natural (qué tipo de cliente
parece — monolito, microservicios, frontend MFE-based, etc).

---

## PASO 2 — Cargar el JSON de discovery

Leer directamente el archivo (NO repetir el discovery):

```bash
cat ~/.devflow/clients/<slug>.discovery.json
```

El JSON tiene esta estructura (estable, ver `pattern-detector.ts:DiscoveryResult`):

```json
{
  "slug": "<slug>",
  "provider": "gitlab" | "github",
  "group_or_org": "<grupo>",
  "generated_at": "<ISO>",
  "discovery": {
    "repos": [
      {
        "slug": "...", "display_name": "...",
        "stack": { "language", "framework", "db", "node_version", "php_version" },
        "app_type": "bff|microservice|api-rest|frontend-app|frontend-mfe|worker|library",
        "auth_pattern": "custom-jwt|portal-embedded|oauth2-oidc|api-key-internal|none-public|unknown",
        "is_template": bool, "is_portal_shell": bool, "is_mfe": bool,
        "ci_stages": [...], "k8s_namespace": ...,
        "last_active_days": N, "inactive": bool
      }
    ],
    "auth_profiles_detected": [...],
    "templates_detected": [...],
    "portal_shell": "<slug>|null",
    "mfes": [...],
    "ci_template": "...",
    "dbs_detected": [...],
    "active_repos": N,
    "inactive_repos": N,
    "summary": "<párrafo legible>"
  },
  "saved_to": "..."
}
```

Razonar sobre estos datos para los PASOS 3-5. NO inventar; si un campo viene
`unknown` o `null`, marcar `[por confirmar]` en el output y preguntarlo en PASO 4.

---

## PASO 3 — Refinamiento desde el JSON

A partir del JSON cargado, sintetizar para presentar al consultor:

**Apps por tipo:** agrupar `discovery.repos[].app_type`.

**Auth patterns:** ya están en `discovery.auth_profiles_detected`. Para cada uno,
listar qué repos lo usan (filtrando `repos[].auth_pattern`).

**Templates:** `discovery.templates_detected` — repos cuyo nombre matchea
template/base/starter/scaffold. Confirmar con el consultor si son realmente
templates oficiales o falsos positivos.

**Portal shell + MFEs:** `discovery.portal_shell` + `discovery.mfes`.

**CI/CD pattern:** `discovery.ci_template` es el stage pattern más común. Listar
repos sin CI (los que tienen `ci_stages: []`).

**Repos inactivos:** `discovery.repos[].inactive === true` — proponer marcarlos
como `deprecated` en el catálogo o pedir confirmación.

---

## PASO 4 — Confirmación (máximo 5 preguntas)

Solo preguntar lo que el código no puede decir:

```
Antes de generar el contexto, necesito confirmar algunas cosas:

1. Detecté <N> repos activos. ¿Hay apps importantes que no están en <git_group>?
   (ej: repos legacy en otro servidor, apps de terceros integradas al sistema)

2. Encontré <N> patrones de auth distintos. ¿Cuál es el patrón estándar
   para apps nuevas que construyamos juntos?
   Opciones detectadas: [lista]

3. ¿Quién es el contacto técnico principal que mantiene la arquitectura?
   (nombre + rol — para incluir en el README del contexto)

4. <Si hay repos sin CI>: Los repos <lista> no tienen CI/CD configurado.
   ¿Son activos o están deprecados?

5. ¿Tienen ambientes adicionales además de dev/qa/prod?
   (ej: staging, uat, pre-prod)
```

Esperar respuestas. Ajustar el draft según las respuestas.

---

## PASO 5 — Generar artefactos

Con todo el contexto recopilado, generar los archivos del context repo.

> **A partir de v0.6.0:** el master config canónico vive en
> `.devflow-context/stack.yml` (S1-1) y el catálogo en
> `.devflow-context/catalog.yml` (S1-2). El markdown legacy
> `app-catalog.md` se regenera como vista derivada con
> `dd-cli context render` (S2-5).

### `.devflow-context/stack.yml` (NUEVO, canónico — S1-1)

Master config con schema versionado. Estructura:

```yaml
schema_version: '1.0'
client:
  slug: <slug>
  name: <Nombre completo>
  industry: <industria o null>
  team_size: <N o null>
  primary_contact: "<nombre — rol>"
stack:
  backend_framework: "<framework + versión>"
  frontend_framework: "<framework + versión>"
  databases: [<lista>]
  infra: "Kubernetes" | "ECS" | "VMs" | ...
  k8s_namespaces: { qa: <ns>, prod: <ns> }
  cicd_platform: "GitLab CI" | "GitHub Actions" | ...
  identity_provider: <slug del provider de auth>
  container_registry: <url o null>
  base_domain: <dominio o null>
naming:
  feature_id_pattern: "HDU-{n}"
  branch_pattern: "feature/{feature_id}-{slug}"
  spec_filename: "SPEC-{slug}.md"
  epic_filename: "EPIC-{slug}.md"
defaults:
  acceptance_format: gherkin
  story_format: como-quiero-para
  sprint_duration_weeks: 2
  main_branch: main
  qa_branch: develop
templates:
  fullstack: <slug del template fullstack o null>
  api: <slug del template api o null>
devflow:
  mode: local
  url: null
```

### `.devflow-context/catalog.yml` (NUEVO, canónico — S1-2)

Catálogo de apps como YAML estructurado. Una entrada por app:

```yaml
schema_version: '1.0'
apps:
  - slug: <kebab-case>
    name: <Nombre humano>
    type: microservice|bff|api-rest|frontend-app|frontend-mfe|worker|library
    role: provider|consumer|portal|standalone|data-layer|integration|unknown
    auth_profile: <slug del auth profile, ej: iprsa-sso>
    ci_cd_profile: <slug del cicd profile o null si no aplica>
    repo: <URL HTTPS al repo>
    branch: main
    status: prod|qa|dev|deprecated|inactive|empty|unknown
    app_origin: legacy-app  # siempre legacy en init-context — solo /new-app crea greenfield
    template_origin: <slug del template o null>
    preferred_dev_types:
      - brownfield-feature
      - brownfield-refactor
    tags: [...]
    notes: <prosa libre o null>
```

**Llenar a partir del JSON de discovery** mapeando:
- `repos[].slug` → `apps[].slug`
- `repos[].display_name` → `apps[].name`
- `repos[].app_type` → `apps[].type`
- `repos[].auth_pattern` → derivar `auth_profile` (un mismo pattern
  detectado puede usar el mismo profile en múltiples apps)
- `repos[].is_template` → `app_origin: legacy-app` y tag `template`
- `repos[].inactive` → `status: deprecated` o `inactive` (preguntar)

Después de generar el YAML, ejecutar:
```bash
dd-cli context render <path-al-context-repo>
```
para generar `app-catalog.md` como vista derivada (consumible por humanos
en GitLab/GitHub UI).

### `.devflow-context/auth-profiles/<slug>.md`

Por cada `auth_profile` único usado en el catalog. Personalizar con los datos
reales del cliente (endpoint_login, algoritmo, claim_user_id, etc.).
Si hay datos confirmados en PASO 4 → incluirlos. Si no → `[por confirmar]`.

### `.devflow-context/cicd-profiles/<slug>-k8s.yml`

Por cada variante de pipeline identificada (`discovery.ci_template` indica el
stage pattern más común). Si el 80% de los repos activos tienen el mismo
pattern → un único profile. Si hay variantes → una por variante (máx 3).

### `.devflow-context/client-assessment.md`

Documentar gaps identificados desde el JSON:
- Repos en `discovery.repos[]` con `ci_stages: []` → sin CI/CD configurado.
- Apps con `auth_pattern: unknown` → patrón de auth no reconocido.
- Repos con `inactive: true` → candidatos a deprecar formalmente.
- Apps que faltan campos en el catalog (`auth_profile` null, etc.).

### `CLAUDE.md` raíz

Contexto completo del cliente para Claude Code. Incluir referencias a
`stack.yml`, `catalog.yml`, summary del discovery.

### `.devflow-context/.context-repo.yml` (NUEVO marcador — S2-3)

```yaml
kind: context-repo
schema_version: '1.1'
client:
  slug: <slug>
  name: <nombre>
provider:
  type: gitlab | github
  base_url: <base url>
  group_or_org: <grupo>
generated_by: /devflow-ia:init-context
last_generated_at: <ISO timestamp>
cli_version: <obtener de `dd-cli --version`>
discovery_source:
  type: provider-api
  ref: HEAD
```

### `README.md` y `.gitignore`

Guía de uso del repo de contexto y exclusiones estándar.

---

## PASO 6 — Validar localmente + commit + sync

**Antes de pushear**, ejecutar el linter del context repo:

```bash
dd-cli context validate <path-al-context-repo>
```

Debe terminar con `0 errores`. Las warnings son aceptables y se resuelven
después (auth profiles `[por confirmar]`, etc). Si hay errores estructurales
(schema inválido, refs rotas), corregir antes de pushear.

Si el `app-catalog.md` no se regeneró aún, hacerlo:

```bash
dd-cli context render <path-al-context-repo>
```

Commit + push:

```bash
git add .
git commit -m "feat: devflow context — onboarding <slug>

Discovery automático via dd-cli client discover (S2-1).
JSON fuente: ~/.devflow/clients/<slug>.discovery.json

Apps catalogadas: <N> (<N_activas> activas, <N_inactivas> inactivas)
Auth profiles: <N> (<lista>)
CI/CD profiles: <N>
Gaps identificados: <N>

Generado por /devflow-ia:init-context v0.6.0"

git push origin main
```

**B-6 fix — cerrar el loop:** después del push, sincronizar la cache local
del CLI para que `dd-cli health` y futuras invocaciones reflejen lo que se
acaba de publicar.

```bash
dd-cli pull-context <slug>
dd-cli health --client=<slug>
```

Debe reportar `app catalog: <N> apps catalogadas`. Si reporta 0 o número
viejo, revisar permisos del token y volver a correr `pull-context`.

---

## PASO 7 — Resumen y próximos pasos

```
✓ Contexto DevFlow IA generado para <NOMBRE_CLIENTE>

Archivos creados:
  ✓ CLAUDE.md
  ✓ README.md
  ✓ .devflow-context/.context-repo.yml      (marcador S2-3)
  ✓ .devflow-context/stack.yml              (master config S1-1)
  ✓ .devflow-context/catalog.yml            (catálogo canónico S1-2 — <N> apps)
  ✓ .devflow-context/app-catalog.md         (vista derivada, regenerable)
  ✓ .devflow-context/client-assessment.md   (<N> gaps)
  ✓ .devflow-context/auth-profiles/         (<N> perfiles)
  ✓ .devflow-context/cicd-profiles/         (<N> perfiles)

✓ context validate ejecutado → 0 errores
✓ Cache local sincronizada (dd-cli pull-context <slug>)
✓ Health check verde (dd-cli health --client=<slug>)

Gaps que vale revisar con el Jefe TI:
  <lista del client-assessment.md>

Próximos pasos:
  1. Revisar y completar los [por confirmar] en auth-profiles/
     (después de cada edición: dd-cli context render para refrescar
      el app-catalog.md derivado, dd-cli context validate para checkear)
  2. Cuando el primer dev arranque con una feature:
       cd <repo-de-código>
       dd-cli init --client=<slug>
       dd-cli start-session <HDU-id>
```

---

## MODO MANUAL (fallback sin API)

Si no hay credenciales API, ejecutar el flujo de entrevista de 8 bloques:

**Bloque 1 — Identificación del cliente**
Slug, nombre completo, industria, tamaño del equipo, contacto técnico.

**Bloque 2 — Stack tecnológico**
Backend, frontend, DBs, plataforma deploy, CI/CD, identidad.

**Bloque 3 — Inventario de apps (loop)**
Por cada app: slug, nombre, tipo, repo, estado, auth pattern.
Repetir hasta "no hay más".

**Bloque 4 — Detalle de auth profiles**
Por cada patrón único: datos específicos del cliente.

**Bloque 5 — CI/CD assessment**
Cuántos tienen pipeline, stages comunes, registry, secrets.

**Bloque 6 — Infraestructura**
Ambientes, K8s, observability, secrets management.

**Bloque 7 — Confirmación y generación**
Mostrar resumen → confirmar → generar → commit.

---

## Reglas

1. Modo auto > modo manual — siempre preferir la API
2. En modo auto: confirmar antes de generar (PASO 4)
3. No inventar — usar `[por confirmar]` si falta información
4. Español neutro latinoamericano (sin voseo rioplatense)
5. El análisis profundo de repos individuales queda para `/init-repo-context` cuando el dev trabaje en una feature específica
6. Todos los repos existentes son `legacy-app` — solo los nuevos creados por `/new-app` son `greenfield-app`
