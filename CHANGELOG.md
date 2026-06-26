# Changelog

Todos los cambios notables de `@devflow-ia/cli` están documentados acá.

El formato sigue [Keep a Changelog](https://keepachangelog.com/) y el
versionado sigue [Semantic Versioning](https://semver.org/).

---

## [0.6.0] — 2026-06-26

Reescritura mayor del onboarding, schemas y surface del usuario. Implementa
el rediseño completo documentado en
`_Empresa/Herramientas/devflow-ia-metodo/dd-cli-rediseno-onboarding.md`
(2693 líneas, 27/27 open questions resueltas, 8 decisiones de diseño D-1
a D-8).

**Principio rector D-8**: CLI = kernel (data, config, JSON estructurado),
Skills = shell humano. El usuario casi nunca tipea comandos directos — los
invoca a través de skills que componen el CLI por debajo.

### Sprint 1 — Estabilización + abstracciones (commits `a72771a`, `9806e50`, `566184d`, `c5b2572`, `031ba61`, `001f4c0`, `5bb2d12`)

#### Fixed

- **B-1**: parser de `app-catalog.md` tolerante a backticks alrededor del slug.
  Antes el regex exigía `|<espacio><letra>` y silenciosamente retornaba `[]`
  cuando el skill emitía `| \`core-auth\` | ...`. Hot-fix en
  `init-client.ts`, `health-cmd.ts`, `register-client.ts`; fix definitivo en
  S1-2 con `catalog.yml` canónico.
- **B-2**: `pull-context` acepta `<slug>` como argumento posicional + alias
  `--client=<slug>`. Antes necesitaba estar dentro de un repo con
  `.devflow/config.yml` válido — ahora funciona desde cualquier directorio.
- **B-3**: `register-client --force` realmente rehace el clone (antes
  imprimía "Sobreescribiendo" pero el clone nunca se ejecutaba).
- **B-4**: `health` usa `loadProjectConfig` en vez de un regex inválido que
  nunca matcheaba el `client.slug` (porque `client` es un objeto multilínea).
- **B-5**: `register-client` lee el nombre real del cliente del context repo
  recién clonado (priority: `stack.yml`, `.context-repo.yml`, `CLAUDE.md`,
  `README.md`, fallback a deriveNameFromUrl). Antes guardaba `name: "iprsa"`
  cuando debería ser `"Inmobiliaria Reñaca S.A."`.
- **B-6**: el skill `/init-context` cierra el loop invocando `pull-context`
  + `health` al final del PASO 6, para sincronizar la cache local del CLI
  con el push recién hecho.

#### Added

- **S1-1**: `StackConfig` schema (`.devflow-context/stack.yml`) — master config
  del cliente como YAML canónico. Resuelve la colisión arquitectónica donde
  dos schemas distintos compartían `.devflow/config.yml`. `ProjectConfig`
  queda exclusivo para identidad repo↔cliente.
- **S1-2**: `Catalog` schema (`.devflow-context/catalog.yml`) — catálogo de
  apps como YAML estructurado. El markdown `app-catalog.md` queda como vista
  derivada (regenerable con `dd-cli context render`). Resuelve A-4 del
  rediseño.
- **S1-8**: abstracción `GitProvider` (`src/providers/`) — interface
  unificada para GitLab (cloud + self-hosted) y GitHub (cloud + Enterprise).
  Read-side: `validateToken`, `listGroupRepos`, `readFile`, `readFirstFound`.
  Write-side: `createRepo`, `setBranchProtection` (Sprint 3),
  `createPullRequest`, `configureWebhook` (futuro).
- **S1-9**: contrato JSON estructurado del CLI (D-7/D-8 del rediseño).
  `--json` y env `DEVFLOW_CLAUDE_MODE=1` en todos los comandos. Códigos de
  error estables (`ErrorCode` enum, 32 códigos en 6 dominios) con
  `recovery_hints` accionables. `~/.devflow/clients/<slug>.state.json` por
  cliente con máquina de estados.
- **S1-10**: `dd-cli client migrate <slug>` migra clientes legacy al schema
  nuevo. Detecta `.devflow/config.yml` master + `app-catalog.md`, convierte
  a `stack.yml` + `catalog.yml`, backup automático en
  `~/.devflow/clients/<slug>.bak-<ts>/`, idempotente.

### Sprint 2 — Discovery como código (commits `d280eb6`, `e26b056`, `3d08d1a`, `b1b8b12`)

#### Added

- **S2-1**: `dd-cli client discover <slug>` — motor de discovery TypeScript
  expuesto. Resuelve A-1 del rediseño: la skill `/init-context` reimplementaba
  con curl + LLM lo que ya estaba en `pattern-detector.ts` (210 LoC). Ahora
  consume el JSON del CLI. **17 repos en 17.8s sin LLM**, vs ~2-3 min con
  síntesis manual del LLM. Output JSON estable consumible por skills, CI y
  la app web futura.
- **S2-3**: marcador `.devflow-context/.context-repo.yml` — schema +
  detección en `dd-cli init` para abortar con mensaje útil si alguien intenta
  tratar un context repo como repo de código. Resuelve A-3.
- **S2-4**: `dd-cli context validate [path]` — linter del context repo.
  Reglas: marcador, stack.yml, catalog.yml, referencias auth/cicd. Exit
  code 3 con errores. JSON output bajo S1-9.
- **S2-5**: `dd-cli context render [path]` — regenera markdown derivado desde
  YAML canónico. Idempotente: con `--dry-run` reporta cambios sin escribir.

#### Changed

- **S2-2**: skill `/devflow-ia:init-context` v0.5.0 → v0.6.0. Reescritura
  de PASOS 1-3 para consumir `dd-cli client discover --json` en lugar de
  hacer curl manual + síntesis con LLM. Schemas YAML completos documentados
  inline en PASO 5. PASO 6 ahora corre `context validate` antes del commit.

### Sprint 3 — Onboarding 2.0 (commits `b88b4a2`, `993ef76`)

#### Added

- **S3-1**: `dd-cli client new <slug>` — onboarding inicial de cliente en
  un solo comando. Valida token, crea context repo en provider si no existe,
  aplica branch protection a main (idempotente, configurable con
  `--no-branch-protection`), clona local con token embebido, registra en
  registry + credentials, escribe marcador `.context-repo.yml`. Modo
  interactivo + `--non-interactive` con flags completas. Sustituye
  `register-client` + setup manual del repo.
- **S3-1a**: implementación real de `createRepo` + `setBranchProtection` en
  `GitLabProvider` y `GitHubProvider` (reemplaza los stubs
  `NotImplementedError` de S1-8).
- **S3-4**: `dd-cli client publish <slug>` — cierre del flujo onboarding.
  Valida con `context validate` antes del commit (aborta con errores),
  regenera markdown derivado, detecta cambios, commit + push. Avanza state
  a `READY`.
- **S3-5**: `dd-cli client show <slug>` — dashboard read-only del cliente.
  Estado + stack + apps por type/status + auth/cicd profiles + acciones
  sugeridas. URL del context repo enmascarada (no filtra el PAT en el
  output).
- **S3-6**: `dd-cli client list` + `dd-cli home`. List tabla con todos los
  clientes; home vista del operador con clientes + sesión activa + sistema.
- **S3-7**: máquina de estados explícita del cliente
  (`REGISTERED → DISCOVERED → DRAFT → READY → ACTIVE → NEEDS_REFRESH`).
  `canTransitionTo`, `nextNaturalState`, `suggestedCommandFor` para mapeo
  estado → comando concreto. Helpers en `src/utils/client-state.ts`.

#### Added — Skills (D-8)

- **S3-3**: skill maestra `/devflow-ia:client-onboard`. Orquesta `client new
  → client discover → client publish` con conversación mínima. Detecta
  estado actual del cliente (lee `state.json`) y continúa desde donde
  quedó (idempotente). Modelo: sonnet.
- **S3-8**: skill `/devflow-ia:troubleshoot`. Lee `state.json` +
  `last_error` + `recovery_hints` del CLI y propone fix conversacional.
  Cubre los códigos de error más comunes con respuestas específicas.

### Sprint 4 — Mantenimiento + tests E2E (commits `3b50735`, `7529cab`, `f91b279`, `4bd4edc`)

#### Added

- **S4-1**: `dd-cli client refresh <slug>` — re-corre discovery, muestra
  diff con `catalog.yml` actual (added/modified/removed por app). Con
  `--apply`: persiste cambios preservando campos editados a mano (name,
  ci_cd_profile, repo, preferred_dev_types, tags, notes). Avanza state a
  `DRAFT` si hay cambios.
- **S4-3**: `dd-cli client onboard-dev <slug>` — setup local para un dev
  nuevo. Pide token read-only (NO el del consultor — cada dev su propio
  token), clona context, registra cliente. Diferencia clave con `client
  new`: scope mínimo (read).
- **S4-6**: tests E2E con MSW (Mock Service Worker) interceptando HTTP de
  GitLab y GitHub. Cubre validateToken, listGroupRepos, readFile,
  pattern-detector end-to-end con fixtures predecibles. 13 specs nuevos
  que previenen regresiones del onboarding sin red.
- **S4-8**: `dd-cli error-codes` — lista los 32 códigos de error estables y
  exit codes (0 éxito, 1 operacional, 2 precondición, 3 validación) según
  R-4 del rediseño. JSON output. Contrato consumible por skills y CI.

#### Changed

- **S4-7**: convergencia de versiones (A-2 del rediseño). `CLI_VERSION` se
  lee dinámicamente del `package.json` (vía `readPkgVersion()`) en lugar de
  estar hardcoded. Bug en `checkSkills`: contaba sólo top-level y reportaba
  "16 skills" cuando había 22 — ahora cuenta recursivo. Tests en
  `version.spec.ts` previenen el drift.

#### Fixed

- **S4-9**: cleanup de `require('node:fs')` lazy en módulos ES (R-9 del
  rediseño). Tres archivos limpios: `health-cmd.ts`, `watch.ts`,
  `init-client.ts`.

### Sprint 5 — HDUs como fuente de verdad (commits `3198a12`, `9f89734`, `2b7a432`, `5ff93af`)

#### Added — Schema y storage

- **S5-1**: schema HDU (`HduFrontmatterSchema`) — ID `HDU-NNN` o
  `HDU-LOCAL-<slug>` (offline, D-12), status enum (draft/approved/in-progress/
  in-review/done/cancelled), priority, apps_affected, assigned_to, sprint,
  references, tags. Apéndice B.5 del rediseño.
- **S5-5**: `_transitions.jsonl` append-only event-sourcing (Apéndice B.7).
  Cada transición: ts, hdu, from, to, by, reason, via (cli|pr-merge|ci-job|
  direct-commit). Fuente única para `dd-cli stats` y para la app web futura.
- **S5-1 (bis)**: `_index.yml` derivado (regenerable con `dd-cli hdu
  index`), `next_hdu_id` calculado de `max(HDU-N) + 1`.
- Máquina de estados HDU: happy path
  `draft → approved → in-progress → in-review → done` con rollbacks legales
  (approved→draft, in-progress→approved, in-review→in-progress) y
  cancelable desde cualquier estado pre-terminal.

#### Added — Namespace `dd-cli hdu` (12 sub-comandos)

- `hdu new <title> --client=<slug>` — crea draft con frontmatter mínimo.
- `hdu list --client=<slug> [--status, --mine, --user]` — listado filtrable.
- `hdu show <id> --client=<slug>` — contenido + historial cronológico.
- `hdu start <id>` — approved → in-progress.
- `hdu review <id>` — in-progress → in-review.
- `hdu approve <id>` — draft → approved (Tech Lead).
- `hdu close <id>` — in-review → done.
- `hdu cancel <id> --reason="..."` — cualquier estado → cancelled.
- `hdu assign <id> --to=<email>` — Tech Lead asigna.
- `hdu claim <id> --user=<email>` — auto-asignación del dev.
- `hdu index --client=<slug>` — regenera `_index.yml`.

#### Added — Scoring y métricas

- **S5-3**: `dd-cli hdu next --client=<slug> --user=<email>` con scoring
  transparente (5 factores con pesos explícitos): prioridad (5-100), app
  match recientes (+15), continuidad dev_type (+10), sprint activo (+8),
  antigüedad (+0-20 anti-starvation). `--explain` muestra breakdown
  numérico.
- **S5-6**: `dd-cli stats --client=<slug> [--period=30d]` — métricas
  derivadas del transitions log: throughput, cancellation_rate, lead time
  (mediana/p90), cycle time, mix dev_type, por dev con `--by=dev`.
  Forward-compat con app web (event-sourcing puro).

#### Added — CI automation (opcional, escape hatch para flujo PR estricto)

> **Importante**: el flujo de aprobación **recomendado** es vía skills
> (`/devflow-ia:hdu-board` → `dd-cli hdu approve` por debajo). El CI es un
> **escape hatch opcional** para clientes con compliance estricto que ya
> usan PRs como mecanismo formal de aprobación (branch protection con
> review obligatorio, audit trail por merge log de GitLab). Sin CI,
> `/devflow-ia:hdu-board` cubre el caso conversando con Claude.

- **S5-4**: `dd-cli hdu apply-merge` — comando que el CI invoca post-merge
  a main para propagar `draft → approved` con `via: pr-merge`. Detecta
  `hdus/*.md` cambiados, idempotente, `--dry-run` por default.
- **S5-4**: `dd-cli context install-ci [path]` — provisiona el workflow
  correcto según provider detectado **solo si el cliente lo necesita**.
  Templates incluidos: `templates/ci/github-hdu-transitions.yml` y
  `templates/ci/gitlab-hdu-transitions.yml` con anti-loop, docs de setup
  del bot token en `templates/ci/README.md`.

  **Cuándo instalarlo:** sólo si la empresa cliente exige que la
  aprobación oficial pase por merge de PR en GitLab/GitHub (típico en
  enterprise con compliance). Para la mayoría de clientes,
  `/devflow-ia:hdu-board` alcanza.

#### Added — Skills HDU (D-8)

- **S5-10**: skill `/devflow-ia:hdu-board` — orquesta el board de HDUs
  para PMO + Tech Lead (modo 1: crear, 2: aprobar, 3: asignar, 4: triage,
  5: métricas).
- **S5-10**: skill `/devflow-ia:stats-review` — interpreta `dd-cli stats
  --json` en lenguaje humano. Compara períodos, detecta cuellos
  (aprobación vs ejecución), reporta mix de dev_types.

#### Added — Docs

- **S5-11**: `dd-cli guide [topic]` — abre guías paginadas en terminal con
  `less` si está disponible. Topics: hdu, hdus, onboarding, dev.
- **S5-11**: `docs/guia-hdu-flow.md` (~140 líneas) — flujo completo de
  HDUs con `qué hacer` + `si falla` inline para cada paso.

#### Changed

- **S5-9**: `dd-cli new-hdu` legacy ahora imprime warning de deprecación.
  Sigue funcionando por backward-compat hasta v0.7.0; reemplazo:
  `dd-cli hdu new "<título>" --client=<slug>`.

### Sprint 6 — Surface dev día a día (commit `bcd5650`)

#### Added

- **S6-3**: `dd-cli today --user=<email>` — ritual matutino del dev.
  Vista del día con 3 secciones: sesión activa, queue de HDUs aprobadas
  asignadas (ordenadas por prioridad), alertas (cache stale, in-progress
  propias).
- **S6-8**: `dd-cli inbox` + `inbox add` — eventos asincrónicos en
  `~/.devflow/inbox.jsonl`. Auto-purge de leídos > 30 días (configurable
  por `DEVFLOW_INBOX_RETENTION_DAYS`). Anti-loop con commits propios.
  Eventos típicos: `hdu_assigned`, `mr_merged`, `context_updated`,
  `hdu_blocked`. `appendInboxEvent()` exportado para git hooks.

#### Added — Skills dev día a día (D-8)

- **S6-10**: 4 skills nuevas que cubren el 95% del día del dev:
  - `/devflow-ia:daily-standup` — compone `today` + `inbox`. Modelo: haiku.
  - `/devflow-ia:pick-next` — invoca `hdu next --explain`, explica
    breakdown. Modelo: haiku.
  - `/devflow-ia:start-work` — claim + start + ubicación del repo +
    start-session. Valida status antes (rechaza draft/done/cancelled).
    Modelo: haiku.
  - `/devflow-ia:end-day` — cierra el día (review/close/pausa/blocked).
    Sugiere commit message con trailer DevFlow-Type. Modelo: sonnet.

Bajo D-8, el día del dev de v0.6.0 se reduce a:

```
mañana:   /devflow-ia:daily-standup
decidir:  /devflow-ia:pick-next
arrancar: /devflow-ia:start-work HDU-N
... trabajo ...
cerrar:   /devflow-ia:end-day
```

Cuatro skills, cero memorización de comandos CLI.

### Sprint 7 — Telemetría, audit, sprints, features menores (commits `cdca33b`, `dd3c85e`, `730e9b3`, `2fed8ff`, `06628f9`)

#### Added — Telemetría privacy-first

- **S7-1**: namespace `dd-cli telemetry` (5 sub-comandos): enable, disable,
  status, report, purge. Default OFF; `enable` requiere flag explícito
  `--local` (anti-misclick).
  - Sanitización automática: tokens GitLab/GitHub redactados por shape;
    keys que matchean patrones de secret (token, password, api_key, pat)
    redactadas; strings > 100 chars truncados.
  - Hash sha256 truncado a 8 chars para emails (agregación sin exponer
    identidad).
  - Hook global en commander captura todos los comandos sin tocar cada
    `action`.
  - `dd-cli telemetry report` agrupa por comando, exit code, errores;
    `--period=30d|all`.

#### Added — Audit con checksums

- **S7-2**: `src/utils/audit.ts` con `buildAuditHeader`, `parseAuditedFile`,
  `writeWithAudit`, `sha256Body`. Header como comentarios YAML/MD
  compatibles con cualquier formato que use `#`.
- Integrado en `saveStackConfig` y `saveCatalog` con `SaveStackConfigOpts`
  y `SaveCatalogOpts` opcionales (`generated_by` + `cli_version`).
- `client migrate` y `client refresh` pasan los opts.
- `dd-cli context validate` reporta `stack-config-audit` y `catalog-audit`
  warnings cuando el checksum del header no coincide con el body actual
  (detecta edición manual).

#### Added — Features menores HDU

- **S7-7a**: `hdu new --direct --reason="..."` (D-11 del rediseño). Crea
  HDU directamente como `approved` con `via: direct-commit` y tag
  `direct-commit` para audit. `--reason` obligatorio.
- **S7-7b**: `hdu pin <id> --to=<email> --by=<email-tl> --reason="..."`
  (D-13). Tech Lead sobreescribe el scoring de `hdu next` con razón
  obligatoria. Append a transitions log con detalle del dev anterior.

#### Added — Comparación cross-cliente

- **S7-4**: `dd-cli client compare <slugA> <slugB> [--aspect=stack|auth|
  cicd|apps|all]`. Diff side-by-side con markers `✓ igual` / `⚠ distinto`.
  Útil para alinear patrones entre clientes similares u onboardear uno
  nuevo viendo qué tenés en otro.

#### Added — Sprints (S5-7 reactivado)

- **S7-5**: namespace `dd-cli sprint` con 6 sub-comandos: new (auto-ID +
  duration), show (current + HDUs con status), add/remove, close (% de
  completion), burndown (ASCII con barras `█` reconstruido desde
  transitions log).
- Schema en `src/types/sprint.ts` (`SprintSchema`, `SprintCurrentSchema`).
  Apéndice B.8/B.9 del rediseño.

---

### Tests

- Tests pasan de 82 (v0.5.1) a **255** (v0.6.0).
- Nuevos test suites: providers (factory + mock GitLab/GitHub con MSW),
  client-state machine, stack-config, catalog, context-repo, hdu schema +
  state machine, pattern-detector con fixtures, audit headers, telemetry,
  json-output, version drift, e2e flows.

### Skills bundled

- Pasa de 20 a **28** skills: 20 originales + `client-onboard`,
  `troubleshoot`, `hdu-board`, `stats-review`, `daily-standup`,
  `pick-next`, `start-work`, `end-day`.

### Breaking changes vs v0.5.1

- **Schema split**: clientes legacy con `.devflow/config.yml` master deben
  migrar con `dd-cli client migrate <slug>` antes de upgrade. Backward-compat
  shim mantiene lectura del legacy hasta v0.7.0.
- **`dd-cli new-hdu` → `dd-cli hdu new --client=<slug>`**. El comando viejo
  imprime warning de deprecación pero sigue funcionando.
- **Skill `init-context` v0.5 → v0.6**: ahora invoca `dd-cli client
  discover` por debajo. Requiere CLI v0.6+ (`cli_version_required`).
- **`CLI_VERSION` ya no es hardcoded**: si tu integración leía la constante
  desde el JS compilado, ahora se resuelve dinámicamente desde
  `package.json`. Tests en `version.spec.ts` previenen el drift.

---

## [0.5.1] — 2026-06-23

### Fixed

- `/init-context` detecta credenciales sin subshell frágil. Onboarding de
  IPRSA reveló bugs documentados a fondo en `dd-cli-rediseno-onboarding.md`
  (los 6 B-N y 5 A-N que cierra v0.6.0).

---

## [0.5.0] — 2026-06-21

### Added

- `dd-cli health` con estado de clientes registrados (3 capas: máquina,
  clientes, proyecto).
- Statusline mejorada con estado de clientes.

---

## [0.4.0] — 2026-06-19

### Added

- Soporte multi-stack para piloto IPRSA: skills `/init-context`,
  `/init-repo-context`, `/new-spec`, `/explore-repo`, `/map-service`,
  `/trace-flow` funcionan con Node, PHP, Python, .NET, Java, Go.
- 5 templates de scaffolding (Node, NestJS, Angular, Laravel, Python).

---

## [0.3.0] — 2026-06-07

### Added

- `dd-cli flow` — visualización del viaje completo del método por
  dev_type.
- `dd-cli new-hdu` desde el CLI (deprecated en v0.6.0).
- Statusline global en `~/.claude/settings.json`.

---

## [0.2.0] — 2026-06-01

### Added

- MCP (Model Context Protocol) support.
- `dd-cli doctor` — diagnóstico del entorno.

---

## [0.1.0] — 2026-05-22

### Added

- Release inicial.
- Comandos core: `dd-cli init`, `start-session`, `status`, `end-session`,
  `next`, `heartbeat`, `statusline`, `watch`, `skills {list,verify,install}`,
  `help-ctx`, `reclassify`, `register-client`, `pull-context`.
- Skills bundled iniciales (~17).
- Flow state detection con 6 stages y anomaly detection.
- Session schema v2 con Zod validation.

---

[0.6.0]: https://github.com/jcharti/dd-cli/releases/tag/v0.6.0
[0.5.1]: https://github.com/jcharti/dd-cli/releases/tag/v0.5.1
[0.5.0]: https://github.com/jcharti/dd-cli/releases/tag/v0.5.0
[0.4.0]: https://github.com/jcharti/dd-cli/releases/tag/v0.4.0
[0.3.0]: https://github.com/jcharti/dd-cli/releases/tag/v0.3.0
[0.2.0]: https://github.com/jcharti/dd-cli/releases/tag/v0.2.0
[0.1.0]: https://github.com/jcharti/dd-cli/releases/tag/v0.1.0
