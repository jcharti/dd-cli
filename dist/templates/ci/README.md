# CI templates para HDU transitions (S5-4)

Estos workflow files implementan el git-mechanism para que el mergear de un
PR/MR equivalga a la aprobación del Tech Lead (`draft → approved`),
documentado en H-3 del rediseño.

## Instalación

```bash
# Detecta el provider del context repo y copia el template correcto
dd-cli context install-ci [path]
```

Sin `path`, instala en el CWD (debe ser un context repo).

## Cómo funciona

1. Alguien (PMO) hace push a `hdus/*.md` con `status: draft` vía PR.
2. El TL aprueba y mergea el PR.
3. El workflow detecta los archivos cambiados en el último commit a `main`.
4. Para cada uno con `status: draft`, `dd-cli hdu apply-merge --apply --commit`:
   - Cambia `status: approved`.
   - Lockea `dev_type` (con `dev_type_source: pr-merge`).
   - Append a `_transitions.jsonl` con `via: pr-merge` y `by: <autor>`.
   - Regenera `_index.yml`.
   - Commit + push de vuelta.

El push de vuelta usa un bot token (`HDU_BOT_TOKEN`) que necesita permisos de
write + bypass de branch protection en `main`.

## Setup del bot token

### GitLab

1. Project Settings → CI/CD → Variables.
2. Agregar `HDU_BOT_TOKEN` con scope `write_repository`.
3. El usuario del PAT debe ser Maintainer (para bypass de branch protection
   en main).

### GitHub

1. Settings → Secrets and variables → Actions.
2. Agregar `HDU_BOT_TOKEN` con scope `repo`.
3. El default `GITHUB_TOKEN` también funciona si branch protection permite
   escribir desde Actions.

## Loop prevention

El workflow ignora commits que vienen del propio bot:
- GitLab: filtra commits con mensaje `apply post-merge transitions`.
- GitHub: filtra `actor: github-actions[bot]`.

## Operación manual (sin CI)

Si no querés instalar el workflow, podés hacer la transición manualmente
después de mergear:

```bash
dd-cli hdu approve HDU-N --client=<slug> --by=<email-tl>
```

El comando `hdu apply-merge` también se puede correr a mano desde el
context repo:

```bash
cd ~/.devflow/clients/<slug>
dd-cli hdu apply-merge --apply --commit
```
