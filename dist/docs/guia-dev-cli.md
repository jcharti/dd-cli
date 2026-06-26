# Guía del dev — `dd-cli`

> **Para quién es esta guía:** si eres dev en un proyecto que usa DevFlow IA, acá está todo lo que necesitas saber para usar el CLI en tu trabajo diario. No necesitas haber leído ninguna documentación técnica previa.

---

## En dos líneas: qué hace `dd-cli`

`dd-cli` es el compañero de terminal que se conecta con Claude Code y mantiene el registro de tu trabajo. Te dice en qué paso del flujo estás, qué viene después, y hace que Claude te reciba con contexto cada vez que abres una sesión.

**Tú haces:** codear con Claude Code, ejecutar skills (`/new-spec`, `/opsx:apply`, etc.).
**`dd-cli` hace:** recordar dónde estás, guiarte al próximo paso, mantener el estado de tu sesión.

---

## Mapa mental rápido

```
Tu terminal                    Claude Code
──────────────                 ──────────────────────────────────
dd-cli init          → setup   Claude lee .devflow/ al iniciar
dd-cli start-session → inicio  Claude te saluda con contexto
dd-cli status        → ¿dónde?
dd-cli next          → ¿qué?   /new-spec  /opsx:propose  /opsx:apply
dd-cli end-session   → cierre  /end-session (normalmente lo hace la skill)
dd-cli watch         → barra   (pane separado, opcional)
```

---

## 1. Instalación

```bash
# Instalar desde el release público
npm install -g https://github.com/jcharti/dd-cli/releases/download/v0.5.1/devflow-ia-cli-0.5.1.tgz

# Verificar
dd-cli --version
# → 0.5.1

# Activar la statusline en Claude Code (una sola vez por máquina)
dd-cli install
# Luego reiniciar Claude Code para que cargue la barra
```

> **¿Qué hace `dd-cli install`?**
> Escribe `statusLine` en `~/.claude/settings.json` (global). Desde ese momento, Claude Code muestra en su barra el estado de tu sesión en cualquier proyecto. Es inteligente: si no estás en un proyecto DevFlow IA, solo muestra `DevFlow IA · v0.5.1 ready`.
> Para desactivarla: `dd-cli uninstall`

---

## 2. Setup en tu proyecto (una sola vez)

Cuando llegas a un proyecto nuevo con DevFlow IA:

```bash
cd mi-proyecto
dd-cli init
```

**Qué hace `dd-cli init`:**

```
DevFlow IA — init
  Proyecto: /Users/jorge/proyectos/mi-proyecto

✓ Detectado Claude Code en /Users/jorge/.claude
✓ Creado .devflow/ con session.json inicial (schema_version: 2)
✓ Skills instaladas en ~/.claude/commands/devflow-ia
  20 skills (v0.5.1)
✓ Hooks configurados en .claude/settings.json
✓ CLAUDE.md generado con auto-onboarding
  Edita las variables {{...}} con los datos del proyecto

Listo. Abre Claude Code en este directorio.
Tip: para ver la statusline en Claude Code → ejecuta una sola vez: dd-cli install
```

Después de esto, edita `CLAUDE.md` en la raíz del proyecto y reemplaza las variables:
```markdown
STACK: NestJS 11 + Angular 21 + PostgreSQL
BACKEND_FRAMEWORK: NestJS
FRONTEND_FRAMEWORK: Angular
DB: PostgreSQL
```

Eso es todo. No necesitas volver a correr `dd-cli init` en ese proyecto a menos que actualices la versión del CLI.

---

## 3. Tu primera sesión

### 3.1 Inicia la sesión con tu HDU

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

## 7. Al terminar el día

Lo normal es que la skill `/end-session` dentro de Claude Code lo haga todo (commit + push + resumen). Pero si cerraste el terminal sin ejecutarla:

```bash
dd-cli end-session
```

```
Sesión cerrada

✓ Feature: HDU-128 · Autenticación SSO portal cliente
✓ Duración: 3h 42m
✓ Tasks: 4/6 completadas
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

## 11. Crear una HDU desde el CLI (sin la APP)

Si no tienes acceso a la APP de DevFlow IA, puedes crear HDUs directamente desde el CLI:

```bash
dd-cli new-hdu "Autenticación SSO portal cliente"
# → Crea docs/hdus/HDU-001-autenticacion-sso-portal-cliente.md desde el template
# → Lanza Claude Code con /devflow-ia:design-hdu para refinarla
```

El archivo creado tiene el frontmatter completo y el esqueleto estructurado. Claude lo completa junto contigo (Como / Quiero / Para / Criterios / Clasificación).

```bash
dd-cli new-hdu "Mi feature" --no-claude   # crea el archivo sin lanzar Claude
dd-cli new-feature "Mi feature"           # alias más corto
```

Una vez que la HDU está aprobada:
```bash
dd-cli start-session HDU-001
```

---

## 12. Referencia rápida de comandos

| Comando | Para qué | Frecuencia |
|---|---|---|
| `dd-cli install` | Activar statusline global en Claude Code | Una vez por máquina |
| `dd-cli init` | Setup inicial del proyecto | Una vez por proyecto |
| `dd-cli flow [--type=X]` | Ver el mapa del método | Cuando quieras orientarte |
| `dd-cli new-hdu "<título>"` | Crear HDU + lanzar Claude | Cada nueva feature |
| `dd-cli start-session <id>` | Iniciar sesión sobre una HDU | Cada sesión de trabajo |
| `dd-cli status` | Ver dónde estás en el flujo | Cuando dudes |
| `dd-cli next` | ¿Qué tipeo ahora? | Cuando dudes |
| `dd-cli help-ctx` | Comandos útiles según tu estado | Cuando dudes |
| `dd-cli end-session` | Cerrar sesión | Rara vez (lo hace la skill) |
| `dd-cli watch` | Barra detallada en otro pane | Opcional, demos |
| `dd-cli doctor` | Diagnóstico cuando algo no funciona | Cuando hay problemas |
| `dd-cli skills list` | Ver skills instaladas | Ocasional |
| `dd-cli skills verify` | Verificar integridad de skills | Ocasional |
| `dd-cli reclassify` | Cambiar tipo de desarrollo | Muy rara vez |
| `dd-cli uninstall` | Desactivar statusline global | Cuando sea necesario |

---

## 13. Preguntas frecuentes

**¿Tengo que recordar todos los comandos?**
No. `dd-cli next` te dice exactamente qué hacer. `dd-cli help-ctx` te muestra solo los comandos relevantes para tu situación actual.

**¿Qué pasa si ejecuto una skill en el orden equivocado?**
Claude Code te lo va a indicar. Las skills leen el estado de `.devflow/session.json` y las precondiciones del flujo — si falta algo, te dice qué ejecutar primero.

**¿Puedo trabajar en varios proyectos en paralelo?**
Sí. Cada proyecto tiene su propio `.devflow/session.json`. Son sesiones independientes.

**¿Qué pasa si pierdo internet?**
En modo `local` (el default en MVP), `dd-cli` funciona completamente sin red. Todo se guarda en `.devflow/` localmente.

**¿Las skills se actualizan automáticamente?**
No — cuando hay una versión nueva del CLI, ejecutas `dd-cli skills install` y listo. El linter previene que una skill modificada localmente se te cuele.

**¿Qué son los ⬛ ⬜ ▪ en dd-cli skills list?**
El modelo de Claude recomendado para cada skill:
- ⬛ `opus` — decisiones arquitectónicas importantes
- ⬜ `sonnet` — tareas balanceadas (la mayoría)
- ▪ `haiku` — tareas mecánicas rápidas (cerrar sesión, archivar)

---

## Apéndice — estructura de archivos que crea dd-cli

```
tu-proyecto/
├── CLAUDE.md                 ← instrucciones para Claude (editar variables)
├── .claude/
│   └── settings.json         ← hooks + statusLine de Claude Code
├── .devflow/
│   ├── session.json          ← estado de la sesión activa
│   ├── heartbeat.log         ← log de heartbeats
│   ├── transitions.log       ← registro de cambios de estado
│   ├── transitions.ack       ← marca la última transición mostrada
│   └── audit.log             ← cambios de dev_type con fecha y razón
└── .ai/                      ← generado por las skills durante la sesión
    ├── SPEC.md               ← generado por /new-spec
    ├── CONTEXT.md            ← generado por /derive-spec
    ├── REPO-CONTEXT.md       ← generado por /init-repo-context (brownfield)
    ├── BASELINE-*.md         ← generado por /capture-baseline (refactor)
    ├── PROGRESS.md           ← generado por /end-session
    └── golden/<modulo>/      ← golden tests para refactor
```

> `.devflow/session.json` **no se commitea** (agrégalo a `.gitignore`).
> `.ai/SPEC.md`, `.ai/REPO-CONTEXT.md` y similares **sí se commitean**.
