# Equipment module (45.9)

The template for a tool as a module. Everything Equipment needs, and where it lives:

| Part | Where |
| --- | --- |
| Shared manifest: navigation family, capability group, API routes, backup tables | `packages/domain/src/tool-manifest.ts` (`TOOL_MANIFESTS`) |
| Web manifest: icon, texts, navigation page | `apps/web/src/tool-registry.ts` (`TOOL_PLUGINS`) |
| Web pages | this folder (`Equipment.tsx`, `EquipmentForm.tsx`) |
| Server module and routes | `apps/server/src/modules/equipment/` (registered from `SERVER_TOOL_MODULES`) |
| Use-cases | `packages/application/src/equipment/` |
| Repository | `packages/database/src/equipment-repository.ts` |
| Schema | reviewed migrations; the tool id is a row of `tool_ids` (45.3) |

Tools are bundled, reviewed code: nothing is loaded at runtime. A new tool adds a manifest entry on
both sides, its module folders and a migration that inserts its id into `tool_ids`; the tests
(manifest coverage, tool-off sweep, backup coverage, feature CSS guard) say what is missing.
