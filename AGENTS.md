# Valo Parking

## Project context

- `backend/` contains the Node.js Express API, CommonJS modules, and Mongoose models.
- `frontend/` contains the React web application built with Vite.
- `mobile/` contains the Expo React Native application written in TypeScript.
- `ai_service/` contains Python services and model assets.
- `firmware/` contains device code. Inspect its local conventions before editing.
- Read existing implementations and their callers before changing shared booking, membership, payment, or parking session behavior.
- Communicate with the user in Vietnamese unless they request another language.

## Local skills

The project skill library lives in `.codex/skills/`. Before applying a skill, read its `SKILL.md` and announce the selected skill briefly. Select skills according to the actual task.

| Task | Skill file |
| --- | --- |
| Explore solutions and tradeoffs | `.codex/skills/brainstormer/SKILL.md` |
| Plan implementation and dependencies | `.codex/skills/planner/SKILL.md` |
| Implement features across API, web, and mobile | `.codex/skills/fullstack-developer/SKILL.md` |
| Reproduce and fix errors | `.codex/skills/debugger/SKILL.md` |
| Review correctness, authorization, concurrency, and compatibility | `.codex/skills/code-reviewer/SKILL.md` |
| Validate changes and select relevant tests | `.codex/skills/tester/SKILL.md` |
| Simplify code while preserving behavior | `.codex/skills/code-simplifier/SKILL.md` |
| Design interfaces and interactions | `.codex/skills/ui-ux-designer/SKILL.md` |
| Investigate code or technical references | `.codex/skills/researcher/SKILL.md` |
| Maintain documentation | `.codex/skills/docs-manager/SKILL.md` |
| Manage requested Git operations | `.codex/skills/git-manager/SKILL.md` |
| Track scope and delivery | `.codex/skills/project-manager/SKILL.md` |
| Write requested engineering journal entries | `.codex/skills/journal-writer/SKILL.md` |
| Run the explicitly requested Cook workflow | `.codex/skills/cook/SKILL.md` |
| Run the explicitly requested ClaudeKit planning workflow | `.codex/skills/plan/SKILL.md` |

### Compatibility with this repository

- Use the converted `SKILL.md` instructions as the skill entry points. The adjacent legacy `.toml` files describe roles and do not configure the running session.
- Apply system instructions, developer instructions, and the user's authorized scope when interpreting skill guidance.
- Resolve references to Claude tools, slash commands, or `.claude/skills/` through the actual tools and local skills available in the session. Verify referenced files and executables before use.
- Several Cook and ClaudeKit plan references are absent from this library. If those workflows are requested, inspect prerequisites and report concrete missing dependencies. Use `planner` and `fullstack-developer` for ordinary planning and implementation.
- Apply phase ownership constraints when a phase or parallel assignment exists. For ordinary tasks, derive the files to change from the user's requested outcome and the repository.
- Keep plans, documentation, test additions, and verification proportional to the task. Generate reports or journals when requested or needed for the deliverable.

## Working and verification

- Inspect Git status and the relevant diff before editing. Preserve existing user changes.
- Follow the existing controller, service, model, route, and client patterns. Validate external input at API boundaries and verify permissions for sensitive operations.
- Trace changes to shared API responses, database fields, or membership rules through web and mobile callers.
- Read the affected package's `package.json` before selecting checks, since scripts may change.

| Area | Available checks |
| --- | --- |
| Backend JavaScript syntax | `node --check backend/src/path/to/changed-file.js` for each changed JavaScript file |
| Web production build | `npm --prefix frontend run build` |
| Web lint | `npm --prefix frontend run lint` |
| Mobile types | `npm --prefix mobile run typecheck` |
| Mobile lint | `npm --prefix mobile run lint` |
| Mobile tests | `npm --prefix mobile test -- --runInBand` with test filters where appropriate |

The backend currently exposes start, development, migration, and audit scripts. Inspect available test files before selecting a test runner. Database audits and migrations require checking their effects and target environment before execution.

Report the checks actually performed, their results, and any unverified behavior. Keep commits and remote operations within the user's requested Git scope.
