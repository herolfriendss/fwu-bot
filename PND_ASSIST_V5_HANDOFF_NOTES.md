# PND Assist V5 — Claude handoff bundle

This bundle contains the source snapshot and the ten V5 reference documents.

## Source snapshot
- Current branch at packaging: `fix/pnd-reaction-verification`
- Working tree reported clean in `PND_Assist_V5_git_state.txt`.
- Latest commit: `6d804df feat(pnd): add temporary reaction verification gate`.
- Source snapshot excludes `.git`, environment files, credentials, SSH keys, SQLite/database files, `node_modules`, build output, and generated bot download archives.
- The git state/history summary is provided separately in `PND_Assist_V5_git_state.txt`; do not assume full Git objects or remote branches are present.

## Reference documents
The ten Claude V5 documents are in `docs/PND_V5_reference/`. Treat them as specifications, not proof that every described feature exists in code.

## Safety
Work only in a separate local branch or copy. Do not connect to Oracle, change real environment variables, run production migrations, restart services, or deploy without explicit user approval.
