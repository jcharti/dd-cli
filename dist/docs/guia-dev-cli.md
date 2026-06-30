# Guía del dev — `dd-cli`

> **Para quién es esta guía:** si eres dev en un proyecto que usa DevFlow IA,
> acá está todo lo que necesitás saber para usar el CLI en tu trabajo diario.
> No requiere documentación técnica previa.
>
> **Versión:** v0.9.0 (junio 2026). Cambios mayores vs v0.5.x: surface
> **skills-first** (decisión D-8 del rediseño), 4 skills nuevas para el
> día a día del dev, namespace `dd-cli hdu` reemplaza `new-hdu`, HDUs
> viven en el context repo del cliente. Detalle completo en `CHANGELOG.md`.

---

## En dos líneas: qué hace DevFlow IA en tu día

**Modo skill-first (recomendado):** abre Claude Code y conversa con skills.
4 skills cubren tu día completo sin tipear comandos CLI.

```
mañana:        /devflow-ia:daily-standup     ver mi día
decidir:       /devflow-ia:pick-next         qué HDU tomar
arrancar:      /devflow-ia:start-work HDU-N  claim + start + abrir repo
... codear con Claude (skills del método: /new-spec, /opsx:apply, etc.) ...
cerrar día:    /devflow-ia:end-day           review/close/pausa + commit msg
```

**Modo CLI directo (escape hatch):** si preferís terminal o estás scripteando,
los comandos viven por debajo de las skills. Los reportamos en este doc.

---

## Mapa mental rápido

```
Tu terminal                          Claude Code (skill-first)
──────────────                       ──────────────────────────────────────────
dd-cli init                  → setup   Claude lee .devflow/ al iniciar
dd-cli client onboard-dev    → cliente Setup local con tu PAT propio
                                        (no compartir el del consultor / TL)

dd-cli today                 → ¿hoy?  /devflow-ia:daily-standup
dd-cli hdu next              → ¿qué?  /devflow-ia:pick-next
dd-cli start-session         → inicio /devflow-ia:start-work HDU-N
dd-cli status                → ¿dónde?
dd-cli hdu review/close      → cierre /devflow-ia:end-day
dd-cli inbox                 → eventos asincrónicos (notificaciones)
dd-cli watch                 → barra detallada (pane separado, opcional)
```

---

## 1. Instalación

```bash
# Instalar desde el release público
npm install -g https://github.com/Digital-DevCL/dd-cli/releases/download/v0.9.0/devflow-ia-cli-0.9.0.tgz

# Verificar
dd-cli --version
# → 0.9.0

# Activar la statusline en Claude Code (una sola vez por máquina)
dd-cli install
# Luego reiniciar Claude Code para que cargue la barra
```

> **¿Qué hace `dd-cli install`?**
> Escribe `statusLine` en `~/.claude/settings.json` (global). Desde ese
> momento, Claude Code muestra en su barra el estado de tu sesión en
> cualquier proyecto. Si no estás en un proyecto DevFlow IA, solo muestra
> `DevFlow IA · v0.9.0 ready`. Para desactivarla: `dd-cli uninstall`.

### Setup del cliente (una vez por máquina por empresa)

```bash
# Tu PAT propio con scope read-only (NO compartir el del consultor / TL)
# GitLab: read_repository / read_api
# GitHub: repo:read o public_repo si es público
dd-cli client onboard-dev <empresa> \
  --context-url=<URL del context repo, te la pasa el TL> \
  --git-token=<tu PAT>
```

Esto clona el context repo del cliente a `~/.devflow/clients/<empresa>/`
y registra el cliente local. Cada dev tiene su propio token
(decisión D-7 del rediseño: tokens individuales por audit y revocación
granular).

---

## 2. Setup en tu proyecto (una sola vez)

Cuando llegás a un proyecto nuevo con DevFlow IA:

```bash
cd mi-proyecto
dd-cli init --client=<empresa>
```

**Qué hace `dd-cli init --client=<empresa>`:**

```
DevFlow IA — init
  Proyecto: /Users/jorge/proyectos/mi-proyecto

✓ Detectado Claude Code en /Users/jorge/.claude
✓ Conectado al cliente <empresa> (catalog: N apps disponibles)
✓ App del repo detectada en el catálogo: mi-app
✓ Creado .devflow/config.yml (identidad repo↔cliente)
✓ Creado .devflow/session.json inicial (schema_version: 2)
✓ Skills instaladas en ~/.claude/commands/devflow-ia
  28 skills (v0.9.0)
✓ Hooks configurados en .claude/settings.json
✓ CLAUDE.md generado con contexto del cliente embebido

Listo. Abre Claude Code en este directorio.
```

> El init detecta automáticamente si tu repo está catalogado en el
> `catalog.yml` del cliente. Si lo está, completa todo (tipo, auth_profile,
> ci_cd_profile) sin preguntar. Si no, te pide los datos y queda registrado.

Si el directorio actual es un **context repo del cliente** (no un repo
de código), el comando aborta con mensaje útil — `dd-cli init` no aplica
ahí. Para validar el context repo: `dd-cli context validate`.

No necesitás volver a correr `dd-cli init` en ese proyecto a menos que
actualices la versión del CLI.

---

## 3. Tu primera sesión (modo skill-first recomendado)

### 3.1 Abrir Claude Code y ver tu día

```bash
claude
❯ /devflow-ia:daily-standup
```

La skill compone `dd-cli today` + `dd-cli inbox` y te muestra:

```
Today  viernes, 26 de junio
jorge@empresa.cl

TU QUEUE (3 HDUs aprobadas)
  HDU-128    alta     <empresa>  Auth SSO portal cliente
  HDU-129    media    <empresa>  Dashboard ventas Q3
  HDU-131    baja     <empresa>  Refactor ServiceCobranzas

ALERTAS
  · HDU-130 (<empresa>) en in-progress
```

### 3.2 Decidir qué HDU tomar

```
❯ /devflow-ia:pick-next
```

La skill llama `dd-cli hdu next --explain` y narra el scoring:

```
Te sugiero: HDU-128 · Auth SSO portal cliente
  prioridad: alta · dev_type: brownfield-feature · apps: app-bff-cuentas

Score breakdown:
  prioridad:              50
  app match:              15 (trabajaste app-bff-cuentas hace 3 días)
  continuidad dev_type:   10 (igual que tu última cerrada)
  total:                  75

¿Arrancamos con HDU-128?
```

### 3.3 Arrancar el trabajo

```
❯ /devflow-ia:start-work HDU-128
```

La skill ejecuta por debajo:

```
✓ dd-cli hdu claim HDU-128 --client=<empresa> --user=jorge@empresa.cl
✓ dd-cli hdu start HDU-128 --client=<empresa> --by=jorge@empresa.cl
       HDU-128: approved → in-progress

Te sugiero abrir el repo de código:
  cd ~/work/app-bff-cuentas
  dd-cli start-session HDU-128

¿Lo abrimos?
```

### 3.4 CLI directo (alternativa)

Si preferís terminal directo:

```bash
dd-cli start-session HDU-128
```

El CLI te hace unas preguntas rápidas:

```
Nueva sesión — HDU-128

? Nombre de la feature:  Autenticación SSO portal cliente
? Tipo de desarrollo:
  ◉ brownfield-feature    Feature nueva sobre una app existente
  ○ greenfield            App o módulo completamente nuevo, sin código previo
  ○ brownfield-refactor   Mejora técnica sin cambio funcional (deuda, performance)
  ○ modernizacion         Reemplazo de un sistema legacy con paridad funcional
  ○ integracion-externa   Conectar con SaaS / API de tercero (webhooks, OAuth, ETL)
? Subtipo (opcional):
? Apps afectadas (separadas por coma):  app-bff-cuentas, app-mfe-portal
? Justificación corta:  Feature nueva sobre BFF existente, extiende el módulo de auth

✓ Sesión iniciada
  Feature:    HDU-128 · Autenticación SSO portal cliente
  Tipo:       ⬢ brownfield-feature  (fuente: business-brief)
  Modo:       local
  Apps:       app-bff-cuentas, app-mfe-portal

→ Próximo paso: ejecuta dd-cli next para ver qué viene
```

### 3.2 Abre Claude Code

```bash
claude
```

Claude Code va a leerte el `.devflow/session.json` y saludarte:

```
Continuamos con Autenticación SSO portal cliente (HDU-128).
Estás en el paso 2/8 del flujo brownfield-feature: /init-repo-context.
Tu próximo paso es: /init-repo-context
¿Avanzamos?
```

### 3.3 Trabaja con las skills

Las skills se ejecutan dentro de Claude Code como slash commands:

```
❯ /init-repo-context
   Claude analiza el repo y genera .ai/REPO-CONTEXT.md

❯ /new-spec
   Claude entrevista al dev, genera la SPEC técnica

❯ /opsx:propose nombre-del-change
   Claude diseña la implementación (proposal + design + tasks)

❯ /opsx:apply
   Claude implementa task por task

❯ /release-check
   Claude verifica que el código cumple la SPEC

❯ /end-session
   Claude genera resumen + commit + push
```

---

## 4. Comandos de consulta (los más usados)

### `dd-cli status` — ¿Dónde estoy?

Muestra tu viaje completo con check marks:

```
╭─────────────────────────────────────────────────────╮
│  Tu viaje en HDU-128 · Autenticación SSO             │
│  ⬢ brownfield-feature                               │
╞─────────────────────────────────────────────────────╡
│  ✅  start-session                                    │
│  ✅  /init-repo-context                               │
│  ▶  /new-spec  ← estás acá                           │
│  ○  /derive-spec                                     │
│  ○  /opsx:propose                                    │
│  ○  /opsx:apply                                      │
│  ○  /release-check                                   │
│  ○  /end-session                                     │
╞─────────────────────────────────────────────────────╡
│  ⏱  Llevas 1h 23m en esta sesión                     │
╰─────────────────────────────────────────────────────╯

💡  Tu siguiente paso es: /new-spec

    Claude entrevista al dev y produce el documento técnico de la feature.

    En Claude Code, tipea:
        /new-spec
```

**Opciones:**
- `dd-cli status --raw` — modo técnico para debug
- `dd-cli status --json` — output JSON para scripts

---

### `dd-cli next` — ¿Qué tipeo ahora?

El atajo rápido cuando ya sabes dónde estás pero necesitas el comando exacto:

```
$ dd-cli next

Tu siguiente paso es: /new-spec

¿Por qué? Claude entrevista al dev y produce el documento técnico de la feature.

→ En Claude Code, tipea: /new-spec
```

---

### `dd-cli flow` — ver el mapa del método

Antes de arrancar una sesión o si te pierdes en el camino:

```bash
dd-cli flow --all                         # resumen de los 5 tipos
dd-cli flow --type=brownfield-feature     # detalle completo del tipo
dd-cli flow                               # tipo de la sesión activa
```

---

### La statusline en Claude Code

Una vez que hiciste `dd-cli install`, **Claude Code muestra tu progreso automáticamente** en la barra inferior:

```
HDU-128 · paso 3/8: /new-spec → /derive-spec · 42m  ⬢ brownfield-feature
```

- Paso actual y cuántos quedan
- Skill actual y la próxima
- Tiempo de la sesión
- Tipo de desarrollo (con color)

---

## 5. Los 5 tipos de desarrollo

Cuando ejecutas `dd-cli start-session`, eliges uno de estos tipos. Cada uno activa un camino diferente de skills:

### `greenfield` — app nueva (8 pasos)

Cuando construyes desde cero, sin código previo.

```
1. start-session
2. /new-spec          ← Claude diseña la feature desde cero
3. /new-app           ← Claude genera el scaffolding de la app
4. /derive-spec       ← si la feature toca varias apps
5. /opsx:propose      ← diseño de la implementación
6. /opsx:apply        ← programar task por task
7. /release-check     ← verificar antes del MR
8. /end-session
```

---

### `brownfield-feature` — feature nueva en app existente (8 pasos)

El caso más común. Hay código que ya funciona y agregas algo.

```
1. start-session
2. /init-repo-context  ← Claude analiza el repo existente (IMPORTANTE: primero esto)
3. /new-spec           ← con el repo ya entendido, la entrevista es más rápida
4. /derive-spec
5. /opsx:propose
6. /opsx:apply
7. /release-check
8. /end-session
```

> **¿Por qué primero `/init-repo-context`?**
> Sin entender el código existente, Claude podría proponer soluciones que rompen lo que ya funciona. Este paso toma ~5 minutos y ahorra mucho retrabajo.

---

### `brownfield-refactor` — mejora técnica (9 pasos)

Cuando el código existe y funciona, pero quieres mejorarlo sin cambiar lo que hace.

```
1. start-session
2. /init-repo-context   ← mapear el repo
3. /map-service         ← diagrama Mermaid del módulo a mejorar
4. /capture-baseline    ← IMPORTANTE: captura el estado actual (tests, métricas, contratos)
5. /new-spec            ← con el baseline capturado, diseñar el refactor
6. /opsx:propose        ← con sección obligatoria "no functional change"
7. /opsx:apply
8. /release-check       ← verifica que los contratos se preservaron
9. /end-session
```

> **¿Qué es el baseline?**
> Es una foto del código ANTES de tocarlo: qué tests existen, qué métricas tiene, qué endpoints expone. Si después del refactor algo cambia que no debería → se detecta automáticamente.

---

### `modernizacion` — reemplazar sistema legacy (9 pasos)

Para cuando hay un sistema viejo (ej: TRIO) que se quiere reemplazar con algo nuevo.

```
1. start-session
2. /init-repo-context --on=<legacy-path>  ← analiza el sistema LEGACY
3. /trace-flow                             ← diagrama de flujos del legacy
4. /map-service                            ← arquitectura interna
5. /new-spec                               ← con matriz de paridad + plan rollback
6. /derive-spec                            ← por cada app que reemplaza al legacy
7. /opsx:propose                           ← con plan de cohabitación legacy/nuevo
8. /opsx:apply
9. /release-check                          ← verifica que nada se perdió
```

---

### `integracion-externa` — conectar con SaaS/tercero (8 pasos)

Para integrar con Stripe, Auth0, TOKU, webhooks de terceros, etc.

```
1. start-session
2. /init-repo-context  ← si la integración toca app existente
3. /new-spec           ← con preguntas de rate limits, idempotencia, webhooks
4. /derive-spec        ← el adaptador anti-corrupción
5. /opsx:propose       ← con patrón port-adapter
6. /opsx:apply
7. /release-check      ← verifica seguridad (credenciales, firmas, retries)
8. /end-session
```

---

## 6. Soporte multi-stack (v0.4.0)

A partir de v0.4.0, todas las skills de análisis entienden distintos stacks. No importa si el repo usa Laravel, Django, .NET, Spring o Go — el flujo es idéntico.

### `/init-repo-context` detecta automáticamente

| Lo que encuentra en el repo | Stack que detecta |
|---|---|
| `composer.json` | PHP / Laravel |
| `requirements.txt` / `manage.py` | Python / Django |
| `*.csproj` / `Program.cs` | .NET / C# |
| `pom.xml` / `build.gradle` | Java / Spring |
| `go.mod` | Go |
| `package.json` | Node.js / NestJS / Next.js |

Para cada stack ejecuta comandos específicos: `php artisan list`, `python manage.py`, `dotnet test`, `mvn`, etc.

### `dd-cli new-hdu` + `/design-hdu` trabajan en conjunto

```bash
# dd-cli new-hdu crea el archivo placeholder
dd-cli new-hdu "Mi feature"
# → docs/hdus/HDU-001-mi-feature.md  (con frontmatter base)
# → lanza Claude Code con /devflow-ia:design-hdu automáticamente

# La skill detecta que hay un archivo ya creado (DEVFLOW_HDU_PATH)
# y lo completa en vez de crear uno nuevo
```

Si prefieres invocar la skill manualmente, también funciona: `/devflow-ia:design-hdu` sin `dd-cli new-hdu` crea el archivo desde cero (comportamiento original).

---

## 7. Al terminar el día (v0.6+ skill-first)

```
❯ /devflow-ia:end-day
```

La skill pregunta qué pasó hoy y actúa según corresponda:

```
¿Cómo te fue con HDU-128?
  1. Terminé, PR abierto/listo para review     → hdu review
  2. Terminé, PR mergeado                       → hdu close
  3. Avancé pero no terminé (pausa)             → solo end-session
  4. Estoy bloqueado (anotar razón)             → end-session + inbox al TL
```

Si elegís 1 (review): la skill corre

```bash
dd-cli hdu review HDU-128 --client=<empresa> --by=jorge@empresa.cl --reason="MR #43 abierto"
dd-cli end-session
```

Y sugiere un commit message con trailer DevFlow:

```
feat: implementa auth SSO portal cliente

Cierra parte de HDU-128 · Autenticación SSO portal cliente

DevFlow-Type: brownfield-feature
DevFlow-Session: 3h 42m
```

### CLI directo

Si preferís terminal:

```bash
# Si abriste un PR:
dd-cli hdu review HDU-128 --client=<empresa> --by=jorge@empresa.cl --reason="MR #43"
dd-cli end-session

# Si el PR ya mergeó:
dd-cli hdu close HDU-128 --client=<empresa> --by=jorge@empresa.cl
dd-cli end-session
```

---

## 8. Barra de estado opcional

Si quieres ver más detalle en tiempo real (útil para pair programming o demos):

```bash
# En un pane separado de tu terminal / tmux
dd-cli watch
```

```
╔══════════════════════════════════════════════════════════════════════╗
║ DevFlow IA │ HDU-128 · Auth SSO │ spec: auth-sso-portal             ║
║ tasks: ███████░░░░░  3/6 │ 2h 15m │ local                           ║
║ ⬢ brownfield-feature · paso 5/8: /opsx:apply → /release-check       ║
╚══════════════════════════════════════════════════════════════════════╝
```

Se actualiza cada 5 segundos. `Ctrl+C` para cerrar.

---

## 9. Casos especiales

### Cerraste el terminal sin terminar la sesión

Al volver al otro día:

```bash
dd-cli status
```

```
Estado de sesión
  Feature:    HDU-128 · Auth SSO
  ...
⚠ Anomalías detectadas:
  → Sesión abierta hace 18h sin actividad reciente

Siguiente paso esperado: continuar con /opsx:apply o cerrar con dd-cli end-session
```

Y Claude Code te preguntará:

```
Hay una sesión de ayer sin cerrar (HDU-128, 3h 42min).
¿La retomamos con /resume-session, o la cerramos con dd-cli end-session?
```

---

### Quieres cambiar el tipo de desarrollo a mitad del camino

Esto requiere una justificación (y técnicamente solo debería hacerlo el Tech Lead):

```bash
dd-cli reclassify --to=modernizacion --reason="El alcance creció — incluye reemplazo del módulo legacy de pagos"
```

```
✓ Reclasificación aplicada
  Anterior:  ⬢ brownfield-feature
  Nuevo:     ⬢ modernizacion
  Razón:     El alcance creció...

Audit log guardado en .devflow/audit.log
```

La justificación necesita al menos 30 caracteres. El cambio queda registrado en `.devflow/audit.log`.

---

### Algo no funciona como esperas

```bash
dd-cli doctor
```

```
Diagnóstico del entorno DevFlow IA

Sistema:
✓ Claude Code detectado en /Users/jorge/.claude
✓ Skills instaladas en /Users/jorge/.claude/skills/devflow-ia
✓ .claude/settings.json con hooks presente

Proyecto:
✓ Sesión activa: HDU-128 · brownfield-feature

Precondiciones del tipo activo (brownfield-feature):
✓ Todas las precondiciones OK

✓ Todas las precondiciones OK para brownfield-feature
  Puedes ejecutar /new-spec
```

También puedes verificar si el tipo que quieres usar está listo:

```bash
dd-cli doctor --for=brownfield-refactor
```

---

## 10. Gestión de skills (avanzado)

Las 20 skills son las herramientas que Claude usa dentro de tu sesión. No las modificas directamente — el CLI las gestiona.

### Ver qué skills están instaladas

```bash
dd-cli skills list
```

```
Skills instaladas en ~/.claude/commands/devflow-ia (v0.5.1)

  ONBOARDING (para el consultor / Tech Lead)
  ⬛ /devflow-ia:init-context       Onboarding    opus    Discovery del cliente via API → fuente de la verdad
  ⬜ /devflow-ia:design-hdu         Spec          opus    Brief/épica → HDU formal. Integra con dd-cli new-hdu.
  ⬜ /devflow-ia:plan-sprint        Planning      sonnet  Lista de HDUs → sprint planificado

  ANÁLISIS DE REPO (para devs brownfield/refactor/modernización)
  ⬛ /devflow-ia:init-repo-context  Exploration   opus    Mapeo del repo → .ai/REPO-CONTEXT.md (multi-stack)
  ⬜ /devflow-ia:explore-repo       Exploration   opus    Reporte rápido de stack y estructura (ad-hoc)
  ⬜ /devflow-ia:explain-code       Exploration   sonnet  Explica código en nivel técnico y de negocio
  ⬜ /devflow-ia:map-service        Exploration   sonnet  Diagrama Mermaid de capas y flujos (multi-stack)
  ⬛ /devflow-ia:trace-flow         Exploration   opus    Traza flujos cross-service en monolitos y microservicios

  SPEC (para todos los dev_types)
  ⬛ /devflow-ia:new-spec           Spec          opus    Genera la SPEC técnica. Orquesta init-repo-context si falta.
  ⬜ /devflow-ia:derive-spec        Spec          sonnet  Divide el SPEC maestro por app afectada
  ⬛ /devflow-ia:capture-baseline   Quality       opus    Snapshot pre-refactor (tests, contratos, métricas) — solo refactor

  SCAFFOLDING (solo greenfield)
  ⬜ /devflow-ia:new-app            Onboarding    sonnet  Scaffolding de app nueva. Detecta si hay templates o usa from-scratch.
  ⬜ /devflow-ia:enrich-us          Spec          sonnet  Enriquece una user story con criterios de aceptación

  IMPLEMENTACIÓN (para todos)
  ⬜ /devflow-ia:opsx:propose       Workflow      sonnet  Diseña la implementación (proposal + design + tasks)
  ⬜ /devflow-ia:opsx:apply         Workflow      sonnet  Implementa task por task siguiendo el plan aprobado
  ⬜ /devflow-ia:opsx:explore       Workflow      sonnet  Explora el codebase antes de proponer cambios
  ▪  /devflow-ia:opsx:archive       Workflow      haiku   Archiva un change completado

  RELEASE
  ⬜ /devflow-ia:release-check      Quality       sonnet  Verifica que el código cumple la SPEC antes del MR
  ▪  /devflow-ia:end-session        Session       haiku   Commit + push + resumen. Cierra el ciclo.

Total: 20 skills  ·  opus ⬛  sonnet ⬜  haiku ▪
```

Los íconos indican el modelo recomendado (opus para decisiones arquitectónicas importantes, haiku para tareas mecánicas).

### Verificar integridad

```bash
dd-cli skills verify
# → ✓ 20 skills verificadas — todas coinciden con checksums
```

### Reinstalar (si algo quedó corrupto)

```bash
dd-cli skills install
```

---

## 11. Crear HDUs desde el dev (v0.6+)

> **Cambio importante vs v0.5.x:** las HDUs viven en el **context repo
> del cliente** (`<empresa>-devflow-context/hdus/`), no en cada repo de
> código. Esto resuelve el problema de "HDU que toca 3 apps, ¿en cuál
> repo vive?" y permite cross-app por diseño.

### Vía skill (recomendado)

```
❯ /devflow-ia:new-hdu "Autenticación SSO portal cliente"
```

La skill orquesta: pregunta apps afectadas, prioridad, dev_type
sugerido; crea la HDU vía `dd-cli hdu new` en el context repo;
opcionalmente lanza `/devflow-ia:design-hdu` para completar el contenido
(Como/Quiero/Para/Criterios).

### CLI directo

```bash
dd-cli hdu new "Autenticación SSO portal cliente" \
  --client=<empresa> \
  --app=app-bff-cuentas \
  --priority=alta \
  --created-by=jorge@empresa.cl
```

Crea el archivo en `~/.devflow/clients/<empresa>/hdus/HDU-N-...md` con
status `draft`. Después editas el cuerpo y el TL la aprueba vía
`/devflow-ia:hdu-board` o `dd-cli hdu approve`.

### Para hotfixes urgentes (v0.7+)

Si el TL no está disponible y hay un incidente:

```bash
dd-cli hdu new "Hotfix prod incidente XYZ" \
  --client=<empresa> --app=portal-web \
  --direct --reason="prod down — INC-2026-06-26" \
  --created-by=jorge@empresa.cl
```

Crea la HDU directamente como `approved` con `via: direct-commit` y
tag `direct-commit` para audit. `--reason` es obligatorio.

### Comando legacy `dd-cli new-hdu` (deprecado en v0.6.0)

Sigue funcionando con warning de deprecación pero migrá a `dd-cli hdu new`.

---

## 12. Referencia rápida de comandos (v0.6+)

### Setup (una vez)

| Comando | Para qué |
|---|---|
| `dd-cli install` | Activar statusline global en Claude Code |
| `dd-cli client onboard-dev <empresa> --context-url=<url> --git-token=<PAT>` | Setup local del cliente con tu PAT propio |
| `dd-cli init --client=<empresa>` | Setup inicial del proyecto |

### Día a día (vía skills, recomendado)

| Skill | Para qué | Reemplaza el comando |
|---|---|---|
| `/devflow-ia:daily-standup` | Ver mi día | `dd-cli today` + `inbox` |
| `/devflow-ia:pick-next` | Decidir qué HDU tomar | `dd-cli hdu next --explain` |
| `/devflow-ia:start-work HDU-N` | Arrancar trabajo | `hdu claim` + `hdu start` + `start-session` |
| `/devflow-ia:end-day` | Cerrar el día | `hdu review`/`close` + `end-session` |
| `/devflow-ia:troubleshoot` | Algo falló | `dd-cli doctor` + `state.json` |

### Día a día (vía CLI directo, escape hatch)

| Comando | Para qué |
|---|---|
| `dd-cli today --user=<email>` | Ritual matutino del dev |
| `dd-cli inbox` | Eventos asincrónicos |
| `dd-cli hdu list --client=<empresa> --mine --user=<email>` | Mis HDUs aprobadas |
| `dd-cli hdu next --client=<empresa> --user=<email> --explain` | Próxima HDU por scoring |
| `dd-cli hdu claim <id> --client=<empresa> --user=<email>` | Tomar HDU |
| `dd-cli hdu start <id> --client=<empresa> --by=<email>` | approved → in-progress |
| `dd-cli start-session <id>` | Iniciar sesión de Claude Code |
| `dd-cli status` | ¿Dónde estoy? |
| `dd-cli next` | ¿Qué tipeo ahora? |
| `dd-cli hdu review <id> --client=<empresa> --by=<email>` | in-progress → in-review |
| `dd-cli hdu close <id> --client=<empresa> --by=<email>` | in-review → done |
| `dd-cli end-session` | Cerrar sesión |

### Inspección / debug

| Comando | Para qué |
|---|---|
| `dd-cli home` | Dashboard del operador (todos los clientes + sistema) |
| `dd-cli client show <empresa>` | Dashboard del cliente |
| `dd-cli hdu show <id> --client=<empresa>` | Detalle + historial de transiciones |
| `dd-cli stats --client=<empresa> --period=30d` | Métricas: throughput, lead time, mix |
| `dd-cli watch` | Barra detallada en otro pane |
| `dd-cli doctor` | Diagnóstico del entorno |
| `dd-cli error-codes` | Contrato estable de exit codes y códigos de error |
| `dd-cli guide hdu` | Abre la guía del flujo HDU paginada en terminal |
| `dd-cli flow --all` | Ver el viaje completo por dev_type |

### Crear HDUs

| Comando | Para qué |
|---|---|
| `dd-cli hdu new "<título>" --client=<empresa> --app=<app> --created-by=<email>` | Crear HDU draft |
| `dd-cli hdu new ... --direct --reason="..."` | Crear approved directo (hotfix) |

### Telemetría (opt-in, default OFF)

| Comando | Para qué |
|---|---|
| `dd-cli telemetry enable --local` | Habilitar telemetría local (privacy-first) |
| `dd-cli telemetry status` | Estado + size del archivo |
| `dd-cli telemetry report --period=30d` | Reporte de uso |
| `dd-cli telemetry disable` | Deshabilitar (preserva eventos) |
| `dd-cli telemetry purge --yes` | Borrar eventos |

---

## 13. Preguntas frecuentes

**¿Tengo que recordar todos los comandos?**
No. Bajo D-8 (skills-first), tu día es 4 skills:
`/daily-standup → /pick-next → /start-work → /end-day`. Las skills
invocan al CLI por debajo. Si algo no anda: `/devflow-ia:troubleshoot`.

**¿Qué pasa si ejecuto una skill en el orden equivocado?**
Claude te lo va a indicar. Las skills leen `state.json` y validan
precondiciones; si falta algo (ej: la HDU no está aprobada todavía),
te dice qué ejecutar primero con el comando exacto.

**¿Puedo trabajar en varios proyectos en paralelo?**
Sí. Cada proyecto tiene su propio `.devflow/session.json`. Cada cliente
tiene su propio `~/.devflow/clients/<slug>/state.json`. Son sesiones
independientes.

**¿Qué pasa si pierdo internet?**
El CLI funciona offline. Todo el state vive en `~/.devflow/` y
`.devflow/`. Las skills que necesitan red (ej: `dd-cli client discover`)
fallan con `NETWORK_ERROR` claro y `recovery_hints` para reintentar
cuando vuelva.

**¿Las skills se actualizan automáticamente?**
No — cuando hay una versión nueva del CLI, ejecutas `dd-cli skills install`
y listo. El linter previene que una skill modificada localmente se cuele.

**¿Cada dev tiene su propio token?**
Sí (D-7 del rediseño). NUNCA compartas el PAT del consultor ni del TL.
Cada dev se onboardea con `dd-cli client onboard-dev` y su propio token
con scope read-only. Esto permite revocación granular y audit por
persona.

**¿Cómo sé qué versión de skills tengo instalada?**
```bash
dd-cli health
# Skills: 28 skills · v0.9.0
```

**¿Las HDUs viven en mi repo de código?**
**No (cambio v0.6+).** Viven en el context repo del cliente
(`<empresa>-devflow-context/hdus/`), no en cada repo de código. Esto
permite HDUs cross-app. Tu repo de código solo tiene `.devflow/config.yml`
(identidad repo↔cliente) y los artefactos `.ai/` (SPEC, REPO-CONTEXT) de
la sesión actual.

**¿Qué es el "scoring" de hdu next?**
5 factores con pesos: prioridad (5-100), apps tocadas recientemente
(+15), continuidad de dev_type (+10), sprint activo (+8), antigüedad
(0-20 anti-starvation). `--explain` muestra el breakdown. Sobreescribible
con `hdu pin --to=<email> --by=<TL> --reason="..."` (sólo Tech Lead,
v0.7+).

**¿Cómo veo los eventos asincrónicos (HDU asignada, MR mergeado)?**
```bash
dd-cli inbox          # eventos no leídos
dd-cli inbox --all    # leídos + no-leídos
dd-cli inbox --read   # marcar todos como leídos
```
Auto-purge de leídos > 30 días. `/devflow-ia:daily-standup` lo compone
automáticamente.

**¿Cómo activo la telemetría local?**
```bash
dd-cli telemetry enable --local      # requiere --local explícito
dd-cli telemetry report --period=30d # ver tu uso
dd-cli telemetry disable             # deshabilitar
```
100% local (jamás push remoto). Sanitiza tokens y emails con sha256
truncado. Default OFF.

---

## Apéndice — estructura de archivos que usa dd-cli (v0.6+)

### En tu home (un solo lugar para todos los clientes)

```
~/.devflow/
├── registry.yml                       ← clientes registrados (yaml)
├── credentials.yml                    ← PATs (chmod 600, NUNCA commitear)
├── inbox.jsonl                        ← eventos asincrónicos (notificaciones)
├── telemetry.config.yml               ← config telemetría (default OFF)
├── telemetry.jsonl                    ← eventos opt-in
└── clients/
    ├── <empresa>/                     ← clone del context repo del cliente
    │   ├── hdus/                      ← HDUs del cliente
    │   │   ├── _index.yml
    │   │   ├── _transitions.jsonl
    │   │   └── HDU-N-*.md
    │   ├── sprints/                   ← (opcional) sprints planificados
    │   └── .devflow-context/
    │       ├── stack.yml              ← master config canónico
    │       ├── catalog.yml            ← catálogo YAML
    │       ├── app-catalog.md         ← vista derivada
    │       ├── auth-profiles/
    │       └── cicd-profiles/
    └── <empresa>.state.json           ← estado del cliente (REGISTERED/DISCOVERED/READY/...)
```

### En cada repo de código

```
tu-proyecto/
├── CLAUDE.md                 ← contexto del cliente embebido (no editar)
├── .claude/
│   └── settings.json         ← hooks + statusLine de Claude Code
├── .devflow/
│   ├── config.yml            ← identidad repo↔cliente (sí se commitea)
│   ├── session.json          ← estado de la sesión activa (NO commitear)
│   ├── heartbeat.log         ← log de heartbeats (NO commitear)
│   ├── transitions.log       ← registro de cambios de estado
│   └── audit.log             ← cambios de dev_type con razón
└── .ai/                      ← generado por las skills durante la sesión
    ├── SPEC.md               ← generado por /new-spec
    ├── CONTEXT.md            ← generado por /derive-spec
    ├── REPO-CONTEXT.md       ← generado por /init-repo-context (brownfield)
    ├── BASELINE-*.md         ← generado por /capture-baseline (refactor)
    ├── PROGRESS.md           ← generado por /end-session
    └── golden/<modulo>/      ← golden tests para refactor
```

> Commitear: `.devflow/config.yml`, todo `.ai/`, CLAUDE.md (si es el del
> repo, no el del cliente).
> **No commitear**: `.devflow/session.json`, `.devflow/heartbeat.log`,
> nada de `~/.devflow/`.
