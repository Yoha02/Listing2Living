# Listing2Living implementation contract

Canonical scene types live in shared/types.ts. Metres, floor XY, Z up; convert Three.js position to (x,z,-y), yaw to Three Y rotation. Stable IDs identify the same object in plan, browser, Blender, and validation. Angles in radians.

File ownership: frontend owns src/** only. Geometry owns blender/** and shared/brannan.json and shared/catalog.json. Verification owns shared/verification.ts and tests/**. Coordinator owns server/**, package/dependencies, shared/types.ts, integration docs. Ask coordinator before changing shared contract.

Blender exports fixed architecture to public/generated/brannan.glb. Movable furniture is rendered separately in browser; Blender scene may save furniture but omit it from architecture GLB. Furniture operations update canonical JSON immediately. The browser may render procedural architecture until a Blender asset is ready, honestly labeled.

No secrets in source, browser bundles, logs, test fixtures or commits. Runtime inputs/artifacts and listing photos ignored. Runtime Argon calls use gemini-4-argon via Interactions per event guide; no silent model substitution. Fixtures, cached inputs and deliberate stress tests are labeled.

MVP lower foyer/kitchen/living/stair base. Entrance-to-kitchen/living/stair-foot routes. No multilevel walking certification, regulatory claims, or unsupported exact dimensions. Preserve original LICENSE.
