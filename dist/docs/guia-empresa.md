# Guía de implementación DevFlow IA en una empresa

> **Para quién es esta guía:** consultores Digital-Dev o Tech Leads que van a implementar el método DevFlow IA en un equipo de desarrollo. Cubre la instalación, configuración inicial, fuente de la verdad y templates.

---

## 1. Qué es DevFlow IA y por qué existe

El desarrollo de software con IA tiene un problema fundamental: **cada dev arranca desde cero con cada tarea**. Claude no sabe cómo está armado el repo, no conoce el patrón de auth que usa la empresa, no sabe qué tipo de cambio es (feature nueva vs. refactor vs. integración). El resultado: mucho tiempo en contexto, decisiones inconsistentes, y código que no sigue los estándares del equipo.

**DevFlow IA resuelve esto con tres piezas:**

```
1. Un método estructurado
   5 tipos de desarrollo (dev_types) con un viaje ordenado de pasos
   para cada uno. El dev no decide qué hacer — sigue el camino.

2. Una fuente de la verdad por empresa
   Un repo git con el contexto de la empresa: apps, auth, CI/CD, templates.
   Claude lo lee antes de trabajar. Nunca empieza en blanco.

3. Un CLI de coordinación (dd-cli)
   Mantiene el estado de cada sesión, guía al dev al próximo paso,
   y conecta Claude Code con el contexto correcto.
```

**El resultado:** un dev nuevo puede producir código consistente con los estándares del equipo desde el día 1. Un dev senior puede trabajar más rápido sin repetir contexto en cada sesión.

---

## 2. Los actores y sus roles

| Actor | Herramienta | Responsabilidad |
|---|---|---|
| **PMO / Negocio** | APP (web) o `dd-cli new-hdu` | Crear y refinar el brief (HDU). Definir qué se construye y por qué. |
| **Tech Lead** | Claude Code + `dd-cli` | Aprobar HDU, confirmar dev_type, supervisar la implementación. Mantener la fuente de la verdad. |
| **Dev** | Claude Code + `dd-cli` | Ejecutar el flujo de skills. Producir el código. |
| **Consultor Digital-Dev** | Claude Code + `dd-cli` | Configurar la fuente de la verdad inicial (`/init-context`). Capacitar al equipo. |

---

## 3. El flujo end-to-end

Cada feature sigue el mismo ciclo, independientemente del tipo de cambio:

```
ETAPA 1 — Captura
──────────────────────────────────────────────────────────────
  PMO/Negocio crea el brief  →  dd-cli new-hdu "nombre"
                                Claude Code + /devflow-ia:design-hdu

  Output: docs/hdus/HDU-NNN-<slug>.md
  Campos clave: título, Como/Quiero/Para, criterios de aceptación,
                dev_type sugerido, apps afectadas.

ETAPA 2 — Aprobación
──────────────────────────────────────────────────────────────
  Tech Lead revisa la HDU.
  Confirma (o corrige) el dev_type y las apps afectadas.
  Cambia status: draft → approved.

ETAPA 3 — Sesión de desarrollo
──────────────────────────────────────────────────────────────
  Dev inicia la sesión:
    dd-cli start-session HDU-NNN

  Dev sigue el viaje de skills en Claude Code según el dev_type.
  El CLI guía en cada paso con dd-cli next y la statusline.

ETAPA 4 — Review y merge
──────────────────────────────────────────────────────────────
  /devflow-ia:release-check verifica que el código cumple la SPEC.
  El dev abre el MR/PR. Tech Lead revisa.
  /devflow-ia:end-session cierra la sesión y genera el resumen.
```

### Los 5 tipos de desarrollo (dev_types)

```
greenfield          → App nueva desde cero (scaffolding + feature)
brownfield-feature  → Feature nueva sobre app existente
brownfield-refactor → Mejora técnica sin cambio funcional
modernizacion       → Reemplazo de sistema legacy
integracion-externa → Conectar con SaaS / API de tercero
```

Cada tipo activa un viaje distinto de skills. Para ver el detalle:
```bash
dd-cli flow --all
dd-cli flow --type=brownfield-feature
```

---

## 4. La fuente de la verdad — el repo de contexto

### Qué es

Es un repo git privado en la plataforma de la empresa (GitLab, GitHub, etc.) que contiene **todo el conocimiento estructurado** de su arquitectura:

```
<empresa>-devflow-context/
├── CLAUDE.md                         ← leído automáticamente por Claude Code
├── README.md
├── .devflow/
│   └── config.yml                    ← defaults del cliente (dev_type preferido, etc.)
└── .devflow-context/
    ├── app-catalog.md                ← inventario completo de apps
    ├── client-assessment.md          ← gaps detectados (sin CI, auth no estándar, etc.)
    ├── auth-profiles/
    │   ├── custom-jwt.md             ← cómo funciona el JWT propio del cliente
    │   ├── portal-embedded.md        ← token del portal shell → MFEs
    │   └── api-key-internal.md       ← comunicación interna entre microservicios
    └── cicd-profiles/
        └── nestjs-k8s.yml            ← pipeline estándar del cliente
```

### Por qué es clave

Claude Code lee `CLAUDE.md` al iniciar cada sesión. Si ese archivo tiene el contexto de la empresa, Claude sabe:

- Qué apps existen y cómo se llaman
- Cómo se autentica cada tipo de app
- Qué templates usar para apps nuevas
- Qué pipeline CI/CD tiene la empresa
- Qué stacks y versiones están en producción

Sin este contexto, Claude pregunta o asume. Con este contexto, Claude trabaja desde el conocimiento real de la empresa.

### Cómo se crea (primera vez)

El consultor Digital-Dev ejecuta `/devflow-ia:init-context` en Claude Code. La skill puede operar en dos modos:

**Modo auto (recomendado):** con un token de API del GitLab/GitHub de la empresa, la skill enumera todos los repos, detecta el stack, los patrones de auth y el CI/CD sin preguntar — solo confirma en ≤5 preguntas.

```bash
# 1. Registrar el cliente con credenciales API (una vez por máquina)
#    El PAT debe tener scope read_api (GitLab) o repo (GitHub)
#    IMPORTANTE: la URL lleva el token embebido para que git clone funcione
dd-cli register-client <empresa> \
  --context-url="https://oauth2:<PAT>@gitlab.com/<grupo>/<empresa>-devflow-context.git" \
  --git-token=<PAT> \
  --git-group=<grupo> \
  --git-host=gitlab

# 2. Verificar que quedó bien configurado
dd-cli health --client=<empresa>
# Debe mostrar: ✓ <empresa>  ·  API: gitlab · <grupo>

# 3. Clonar el repo de contexto (si está vacío, es normal)
git clone "https://oauth2:<PAT>@gitlab.com/<grupo>/<empresa>-devflow-context.git"
cd <empresa>-devflow-context

# 4. En Claude Code, pasar el slug como argumento
claude
❯ /devflow-ia:init-context <empresa>
```

> **Tip v0.5.1:** pasar el slug como argumento (`/init-context iprsa`) garantiza que la skill encuentre las credenciales sin depender del nombre del directorio.

**Modo manual (fallback):** si no hay acceso API o el modo auto falla, la skill ofrece una entrevista estructurada de 7 bloques (~45-60 minutos). Genera el mismo output.

### Cómo se mantiene

El repo de contexto no es estático. Debe actualizarse cuando:

- Se agrega una app nueva al catálogo
- Cambia el patrón de autenticación
- Se agrega o modifica el pipeline CI/CD
- Se detecta un gap resuelto

El Tech Lead actualiza el archivo relevante directamente (o con ayuda de Claude) y hace commit + push. Los devs reciben la actualización automáticamente en la próxima sincronización:

```bash
dd-cli pull-context   # actualiza la cache local del contexto
```

### Modelo de ownership del repo

| Modelo | Quién lo controla | Cuándo usar |
|---|---|---|
| **A — Digital-Dev** | Digital-Dev tiene escritura | Clientes con poca capacidad técnica |
| **B — Empresa (recomendado)** | La empresa tiene escritura, DD tiene lectura | Clientes con equipo técnico propio |
| **C — Compartido** | Ambos tienen escritura en ramas distintas | Co-desarrollo activo |

El Modelo B es el recomendado: la empresa mantiene la autonomía de su contexto y no depende de DD para actualizarlo.

---

## 5. Templates de documentación

Los templates definen la **estructura esperada** de los artefactos del método.

### HDU — Historia de Desarrollo

La HDU es el "ticket" del método. Es más estructurada que un issue de Jira: incluye el dev_type sugerido, las apps afectadas, y el contexto técnico para el dev.

**Cómo se crea:**
```bash
dd-cli new-hdu "Nombre de la feature"
# → Crea docs/hdus/HDU-001-nombre-de-la-feature.md
# → Lanza Claude Code con /devflow-ia:design-hdu para completarla
```

**Estructura del template (`templates/HDU.md.template`):**

```yaml
---
id: HDU-001
title: Autenticación SSO portal cliente
status: draft             # draft | approved | in-progress | done
dev_type: pending         # el Tech Lead confirma en design-hdu
apps_affected: []         # slugs del app-catalog
priority: medium
created_at: 2026-06-23
created_by: jorge
---

## Como
(perfil del usuario)

## Quiero
(qué funcionalidad)

## Para
(qué valor de negocio)

## Criterios de aceptación
- [ ] Dado X, cuando Y, entonces Z

## Notas técnicas
(contexto para el dev)
```

**Ciclo de vida de la HDU:**
```
draft → (Tech Lead aprueba dev_type) → approved → (dev inicia sesión) → in-progress → done
```

### SPEC — Documento técnico

La SPEC es el output principal de `/devflow-ia:new-spec`. Documenta el diseño técnico de la feature ANTES de codear.

**Estructura base (todas las secciones [REQUERIDO]):**
- Contexto: por qué se hace y cuándo
- Alcance: qué incluye y qué NO incluye (out of scope explícito)
- Arquitectura: componentes involucrados
- Diseño técnico: flujos, contratos, esquemas
- Plan de implementación: lista de tasks ordenadas
- Criterios de aceptación: testables y específicos

**Secciones adicionales por dev_type:**
- `brownfield-refactor` → Matriz de no-regresión (contratos que no deben cambiar)
- `modernizacion` → Plan de rampa + condiciones de rollback
- `integracion-externa` → Vendor, rate limits, idempotencia, firma webhooks
- `greenfield` → Templates a usar en el scaffolding

La SPEC se commitea en `.ai/SPEC.md` dentro del repo de la feature.

### Dónde viven los templates

```
cli-package/templates/                 ← bundleados con el CLI
├── HDU.md.template       ← estructura base de la HDU (dd-cli new-hdu)
├── SPEC.md.template      ← estructura de referencia de la SPEC
└── CLAUDE.md.template    ← CLAUDE.md base (dd-cli init)
```

Los templates de documentación se bundlean con el CLI y están disponibles sin conexión. **No es necesario configurarlos** — vienen listos al instalar `dd-cli`.

La estructura de la SPEC real no proviene del template sino de la **skill `/new-spec`**: la skill conoce qué secciones debe tener cada dev_type y las genera con contenido real basado en la entrevista con el dev y el análisis del repo. El template es solo el archivo de partida vacío; Claude lo llena.

```
dd-cli new-hdu "Feature"
  → crea HDU-001.md desde HDU.md.template   ← estructura fija, placeholder

/devflow-ia:new-spec
  → genera .ai/SPEC.md con contenido real   ← no es template, es generado por Claude
                                               basado en el dev_type y el contexto del repo
```

---

## 6. Templates de código

Los templates de código definen el **scaffolding estándar** de la empresa para cada tipo de app. Se usan en la skill `/devflow-ia:new-app` cuando el dev_type es `greenfield`.

### Tres escenarios posibles

La skill `/new-app` detecta automáticamente en qué situación está la empresa y actúa distinto en cada caso:

---

**Caso A — Templates configurados** ✅

La empresa tiene repos template registrados en el CLAUDE.md. La skill los clona y adapta. Es el flujo ideal: todas las apps nuevas nacen con los estándares del equipo desde el primer commit.

```
/new-app portal-clientes
→ Detecta: template dd-mfe-angular21 disponible
→ Clona el template, adapta nombre/namespace/auth
→ App lista para compilar en verde
```

---

**Caso B — Arquitectura definida, sin apps desplegadas aún** ⚠️

La empresa tiene el stack y la arquitectura diseñada (CLAUDE.md tiene STACK, BACKEND_FRAMEWORK, etc.), pero **es la primera app que se construye** y todavía no hay templates propios.

Ejemplo real: DevFlow IA app — la arquitectura está completamente definida (NestJS + Angular + PostgreSQL + K8s), pero ninguna app está desplegada todavía y no hay templates previos.

La skill advierte y ofrece dos caminos:

```
⚠️  No encontré templates de código configurados para este proyecto.

Opciones:
  A) Continuar en modo "from scratch" (recomendado si es la primera app)
     El scaffolding generado puede convertirse en el template base.
  B) Definir el template primero y volver a ejecutar /new-app.
```

Si el dev confirma, la skill genera un scaffolding completo y funcional desde cero:
- Estructura de directorios completa
- Código que compila en verde
- Health check mínimo
- Auth integrado según el auth-profile del cliente
- Pipeline CI/CD desde el profile del cliente
- `.env.example` con todas las variables documentadas

Al finalizar, sugiere registrar el resultado como el template base:

```
⚠️  Scaffolding from-scratch completado.
Este resultado es el candidato a convertirse en el template estándar
de la empresa para apps de tipo [tipo].

Próximo paso recomendado (Tech Lead):
  1. Revisar y ajustar el código generado
  2. Crear un repo template con este contenido
  3. Registrarlo en el CLAUDE.md bajo "## Templates de código"
  4. La próxima vez que ejecutes /new-app, lo usará automáticamente.
```

---

**Caso C — Sin stack definido** ❌

No hay STACK, BACKEND_FRAMEWORK ni templates. La skill aborta con instrucciones claras:

```
✗  No puedo generar el scaffolding — faltan las definiciones mínimas del proyecto.

Soluciones:
  1. Completa las variables {{...}} en el CLAUDE.md (creado por dd-cli init)
  2. O ejecuta /init-context para generar el contexto desde los repos existentes
```

---

### Resumen del comportamiento de /new-app

| Situación | Qué hace la skill |
|---|---|
| Templates configurados | Usa el template, adapta, genera en ≤2 min |
| Stack definido, sin templates | Advierte, ofrece from-scratch, sugiere guardar como template |
| Nada definido | Aborta con instrucciones para completar el contexto |

### Tipos de templates

| Template | Para qué | Stack recomendado |
|---|---|---|
| `dd-ms` (microservicio) | APIs internas, workers, procesadores | NestJS + PostgreSQL |
| `dd-api` | APIs públicas o BFF | NestJS + JWT |
| `dd-bff` | Backend For Frontend | NestJS + Redis |
| `dd-mfe` | Microfrontend | Angular + PrimeNG |
| `dd-app` | Aplicación web standalone | Angular + PrimeNG |

### Cómo se registran en el contexto del cliente

En el `.devflow-context/app-catalog.md` de la empresa, cada app tiene un campo `template_origin`:

```markdown
| slug                | tipo | template_origin    | auth-profile     | estado |
|---------------------|------|--------------------|------------------|--------|
| iprsa-bff-reservas  | bff  | dd-bff-nest11      | custom-jwt       | activo |
| iprsa-portal-clientes | mfe | dd-mfe-angular21   | portal-embedded  | activo |
| iprsa-ms-notif      | ms   | dd-ms-nest11       | api-key-internal | activo |
```

Y en el `CLAUDE.md` de la empresa se documenta el repositorio de cada template:

```markdown
## Templates de código
- BFF/API: `https://gitlab.com/<grupo>/dd-bff-nest11` (rama: main)
- MFE:     `https://gitlab.com/<grupo>/dd-mfe-angular21` (rama: main)
- MS:      `https://gitlab.com/<grupo>/dd-ms-nest11` (rama: main)
```

### Cómo los usa `/new-app`

Cuando el dev ejecuta `/devflow-ia:new-app` en Claude Code, la skill:

1. Lee el tipo de app de la SPEC
2. Busca el template correspondiente en el CLAUDE.md del cliente
3. Clona el template en el directorio de destino
4. Adapta el scaffold (nombre, namespace K8s, variables de entorno, etc.)
5. Inicializa el repo con el primer commit

Esto garantiza que cada app nueva de la empresa nace con los mismos estándares que las existentes: misma estructura de directorios, mismas dependencias de base, mismo pipeline CI/CD.

### Buenas prácticas para templates de código

- **Versionar el template:** cada empresa tiene su propia versión del template base. No actualizar sin un release controlado.
- **Incluir el pipeline CI/CD:** el `.gitlab-ci.yml` o `.github/workflows/` base va en el template para que todas las apps arranquen con CI desde el primer commit.
- **Variables de ambiente documentadas:** el `README.md` del template debe listar todas las variables de entorno requeridas.
- **Tests de humo incluidos:** el template debe tener al menos un test de health check que pase en verde. Si el scaffolding no compila y pasa tests, no es un buen template.

---

## 7. Soporte multi-stack (v0.4.0)

DevFlow IA funciona con cualquier stack tecnológico. Las skills de análisis detectan el lenguaje y framework automáticamente y adaptan su comportamiento.

### Stacks soportados

| Stack | Archivos que detecta | Frameworks |
|---|---|---|
| **Node.js** | `package.json` | NestJS, Express, Next.js, Angular |
| **PHP** | `composer.json` | Laravel, Symfony |
| **Python** | `requirements.txt`, `manage.py`, `pyproject.toml` | Django, FastAPI, Flask |
| **.NET** | `*.csproj`, `*.sln` | ASP.NET Core, MVC |
| **Java/Kotlin** | `pom.xml`, `build.gradle` | Spring Boot |
| **Go** | `go.mod` | Gin, Echo, net/http |
| **Generic / Legacy** | ninguno de los anteriores | Entrevista manual |

### Qué significa para cada rol

**Consultor Digital-Dev:**
`/init-context` detecta automáticamente el stack de cada repo del cliente via API. No hay que configurar el lenguaje — lo detecta solo.

**Tech Lead:**
Al ejecutar `/init-repo-context` sobre un repo Laravel o Django, la skill corre los comandos adecuados (`php artisan`, `python manage.py`, `dotnet`, `mvn`) en vez de buscar `package.json`. El REPO-CONTEXT.md generado tiene la misma estructura independientemente del stack.

**Dev:**
El flujo de skills es idéntico para todos los stacks. La única diferencia es lo que Claude detecta al analizar el código. No hay comandos distintos para un proyecto PHP vs uno Node.

### Ejemplo: flujo brownfield-feature en Laravel (IPRSA)

```
dd-cli start-session HDU-001 --type=brownfield-feature

En Claude Code:
  /devflow-ia:init-repo-context
  → Detecta: php-laravel (composer.json + app/ + routes/api.php)
  → Lee: estructura MVC, Eloquent models, jobs, events
  → Genera: .ai/REPO-CONTEXT.md con stack correcto

  /devflow-ia:new-spec
  → Lee el REPO-CONTEXT.md generado
  → No pregunta sobre el stack (ya lo sabe)
  → Genera SPEC técnica considerando convenciones Laravel

  /devflow-ia:opsx:propose / apply / release-check
  → Idéntico a cualquier otro stack
```

---

## 8. Instalación y configuración inicial

### Paso 1 — Instalar el CLI (una vez por máquina, cada persona del equipo)

```bash
npm install -g https://github.com/jcharti/dd-cli/releases/download/v0.5.1/devflow-ia-cli-0.5.1.tgz
dd-cli install        # activa la statusline en Claude Code
# reiniciar Claude Code
```

### Paso 2 — Registrar la empresa (una vez, el consultor Digital-Dev)

```bash
dd-cli register-client <empresa> \
  --context-url=https://gitlab.com/<grupo>/<empresa>-devflow-context.git \
  --git-token=<PAT-lectura/escritura> \
  --git-group=<grupo> \
  --git-host=gitlab
```

Esto hace dos cosas:
- Clona el repo de contexto en `~/.devflow/clients/<empresa>/`
- Guarda las credenciales API en `~/.devflow/credentials.yml` (chmod 600)

### Paso 3 — Crear el contexto de la empresa (una vez, el consultor)

```bash
mkdir <empresa>-devflow-context && cd <empresa>-devflow-context
git init && git remote add origin <url-del-repo>
claude
❯ /devflow-ia:init-context
```

La skill genera todos los artefactos de la fuente de la verdad, hace el commit inicial y lo pushea.

### Paso 4 — Inicializar cada repo de código (una vez por repo)

El Tech Lead (o el dev) conecta cada repo de código a la empresa:

```bash
cd <repo-de-la-empresa>
dd-cli init --client=<empresa>
```

Esto:
- Crea `.devflow/session.json`
- Instala las 20 skills en `~/.claude/commands/devflow-ia/`
- Configura hooks de heartbeat en `.claude/settings.json`
- Copia el `CLAUDE.md` del repo de contexto al proyecto (con merge si ya existe)

### Paso 5 — Verificar que todo está en orden

```bash
dd-cli doctor
```

```
✓ Claude Code detectado
✓ Skills instaladas (20 skills v0.5.1)
✓ Hooks configurados
✓ Cliente conectado: <empresa>
✓ App catalog: N apps
✓ Auth profiles: N perfiles
```

---

## 9. Flujo de trabajo típico de un sprint

### Lunes — Refinamiento

```
PMO/Negocio:
  dd-cli new-hdu "Feature del sprint"
  → Claude Code completa la HDU con /devflow-ia:design-hdu

Tech Lead:
  Revisa la HDU, confirma dev_type y apps afectadas
  Cambia status a: approved
```

### Martes a Jueves — Desarrollo

```
Dev (por cada HDU del sprint):

  1. TERMINAL:
     dd-cli start-session HDU-NNN

  2. CLAUDE CODE (según dev_type — ver dd-cli flow):
     /devflow-ia:init-repo-context   ← si es brownfield
     /devflow-ia:new-spec            ← siempre
     /devflow-ia:opsx:propose        ← diseño
     /devflow-ia:opsx:apply          ← implementación

  3. TERMINAL (al final del día si no se cerró):
     dd-cli end-session
```

### Viernes — Review

```
Dev:
  /devflow-ia:release-check
  Abre MR/PR

Tech Lead:
  Revisa el MR (el /release-check ya validó que cumple la SPEC)
  Merge a main
```

---

## 10. Onboarding de un dev nuevo

Un dev nuevo en un equipo que ya usa DevFlow IA necesita:

```bash
# 1. Instalar el CLI
npm install -g https://github.com/jcharti/dd-cli/releases/download/v0.5.1/devflow-ia-cli-0.5.1.tgz
dd-cli install

# 2. Registrar la empresa (el Tech Lead le pasa el PAT o la URL del repo de contexto)
dd-cli register-client <empresa> --context-url=<url>

# 3. En su primer repo
cd <repo>
dd-cli init --client=<empresa>

# 4. Ver el método antes de arrancar
dd-cli flow --all

# 5. Arrancar su primera tarea
dd-cli start-session <HDU-id>
```

Tiempo estimado desde instalación hasta primera sesión activa: **15 minutos**.

El dev no necesita entender toda la arquitectura de la empresa para arrancar: la fuente de la verdad se la provee Claude automáticamente al abrir la sesión.

---

## 11. Seguridad y credenciales

| Archivo | Contiene | Commitear |
|---|---|---|
| `~/.devflow/credentials.yml` | Tokens API por empresa (chmod 600) | ❌ Nunca |
| `.devflow/session.json` | Estado de la sesión activa | ❌ Nunca |
| `.devflow/heartbeat.log` | Timestamps de actividad | ❌ Nunca |
| `.ai/SPEC.md` | SPEC técnica de la feature | ✅ Sí |
| `.ai/REPO-CONTEXT.md` | Análisis del repo | ✅ Sí |
| `<empresa>-devflow-context/` | Fuente de la verdad | ✅ Sí (repo propio) |

Los tokens API deben tener el mínimo de permisos necesario:
- GitLab: `read_repository` + `read_api`
- GitHub: `repo` (solo lectura si es posible)

---

## 12. Problemas frecuentes al configurar una empresa nueva

**"Claude no sabe qué apps tiene la empresa"**
→ El `CLAUDE.md` del proyecto no está conectado al contexto del cliente. Verificar con `dd-cli doctor` y revisar si `dd-cli init --client=<empresa>` fue ejecutado en ese repo.

**"La skill /new-app no usa el template correcto"**
→ El `CLAUDE.md` del cliente no tiene la sección de templates de código. Actualizar el repo de contexto con la URL de cada template.

**"/init-repo-context tarda mucho"**
→ El repo es muy grande. Agregar una sección `ESTRUCTURA_DEL_REPO.md` manualmente con el mapa de directorios principales — la skill lo usará como punto de partida en vez de explorar todo.

**"Dos devs tienen configuraciones diferentes"**
→ El contexto se sincroniza desde el repo, no de la máquina local. Asegurarse de que ambos ejecutaron `dd-cli pull-context` y tienen la misma versión del CLI (`dd-cli --version`).

**"Agregamos una app nueva y Claude no la conoce"**
→ Actualizar `.devflow-context/app-catalog.md` en el repo de contexto, hacer commit + push. Los devs ejecutan `dd-cli pull-context`.

---

## Apéndice A — Catálogo completo de skills (v0.4.0)

Las 20 skills bundleadas con el CLI, organizadas por fase del método:

| Skill | Modelo | Dev_types | Cuándo se usa |
|---|---|---|---|
| `/devflow-ia:init-context` | opus | todos | Consultor crea la fuente de la verdad del cliente (una vez por empresa) |
| `/devflow-ia:design-hdu` | opus | todos | Tech Lead / PMO refina el brief → HDU formal con dev_type aprobado |
| `/devflow-ia:plan-sprint` | sonnet | todos | Tech Lead organiza HDUs en sprint |
| `/devflow-ia:init-repo-context` | opus | brownfield, refactor, modern., integración | Dev mapea el repo antes de tocar código. Multi-stack v0.4.0. |
| `/devflow-ia:explore-repo` | opus | brownfield, refactor, modern., integración | Reporte ad-hoc rápido de stack y estructura (sin guardar .md) |
| `/devflow-ia:explain-code` | sonnet | brownfield, refactor, modern. | Explica un archivo o fragmento en nivel técnico y de negocio |
| `/devflow-ia:map-service` | sonnet | brownfield, refactor, modern. | Diagrama Mermaid de capas del módulo. Multi-stack v0.4.0. |
| `/devflow-ia:trace-flow` | opus | refactor, modern. | Traza flujos cross-service o en monolito. Multi-stack v0.4.0. |
| `/devflow-ia:capture-baseline` | opus | refactor | Snapshot pre-refactor (tests, contratos, métricas). Multi-stack v0.4.0. |
| `/devflow-ia:new-spec` | opus | todos | Genera la SPEC técnica. Orquesta `init-repo-context` si falta. |
| `/devflow-ia:derive-spec` | sonnet | todos | Divide el SPEC maestro por app afectada |
| `/devflow-ia:enrich-us` | sonnet | todos | Enriquece una user story con criterios de aceptación |
| `/devflow-ia:new-app` | sonnet | greenfield | Scaffolding de app nueva desde template o from-scratch |
| `/devflow-ia:opsx:propose` | sonnet | todos | Diseña la implementación (proposal + design + tasks) |
| `/devflow-ia:opsx:apply` | sonnet | todos | Implementa task por task siguiendo el plan aprobado |
| `/devflow-ia:opsx:explore` | sonnet | todos | Explora el codebase antes de proponer cambios |
| `/devflow-ia:opsx:archive` | haiku | todos | Archiva un change completado |
| `/devflow-ia:release-check` | sonnet | todos | Verifica que el código cumple la SPEC antes del MR |
| `/devflow-ia:end-session` | haiku | todos | Commit + push + resumen. Cierra el ciclo. |

**Multi-stack (v0.4.0):** `/init-repo-context`, `/capture-baseline`, `/map-service`, `/trace-flow`, `/explore-repo` soportan explícitamente Node, PHP/Laravel, Python, .NET, Java/Spring y Go.

---

## Apéndice B — checklist de implementación

### Para el consultor Digital-Dev

- [ ] Crear repo `<empresa>-devflow-context` en la plataforma de la empresa
- [ ] `dd-cli register-client <slug> --context-url="https://oauth2:<PAT>@..." --git-token=<PAT> --git-group=<grupo> --git-host=gitlab`
- [ ] `dd-cli health --client=<slug>` — verificar que muestra ✓ antes de continuar
- [ ] Ejecutar `/devflow-ia:init-context <slug>` (pasar slug como argumento para modo auto)
- [ ] Revisar el `app-catalog.md` generado con el Tech Lead — confirmar que las apps están correctas
- [ ] Revisar los `auth-profiles/` generados — completar los `[por confirmar]`
- [ ] Documentar los templates de código en el `CLAUDE.md`
- [ ] Hacer `dd-cli init --client=<empresa>` en al menos un repo piloto
- [ ] Ejecutar `dd-cli doctor` para verificar que todo está en orden
- [ ] Correr una sesión de prueba end-to-end con una HDU chica

### Para el Tech Lead de la empresa

- [ ] `npm install -g` + `dd-cli install` en su máquina
- [ ] Revisar y aprobar el contexto generado (app-catalog, auth-profiles)
- [ ] Definir quién tiene escritura en el repo de contexto (Modelo A/B/C)
- [ ] Configurar el proceso de actualización del contexto cuando cambia la arquitectura
- [ ] Comunicar al equipo el flujo de HDUs: quién crea, quién aprueba, dónde viven

### Para cada dev del equipo

- [ ] `npm install -g` + `dd-cli install`
- [ ] `dd-cli register-client <empresa> --context-url=<url>`
- [ ] `dd-cli init --client=<empresa>` en el primer repo
- [ ] `dd-cli flow --all` para ver el método
- [ ] Primera sesión con una HDU chica (idealmente acompañado del Tech Lead)
