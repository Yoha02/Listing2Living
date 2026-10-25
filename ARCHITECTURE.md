# Listing2Living implementation contract

Canonical scene types live in shared/types.ts. Metres, floor XY, Z up; convert Three.js position to (x,z,-y), yaw to Three Y rotation. Stable IDs identify the same object in plan, browser, Blender, and validation. Angles in radians.

File ownership: frontend owns src/** only. Geometry owns blender/** and shared/brannan.json and shared/catalog.json. Verification owns shared/verification.ts and tests/**. Coordinator owns server/**, package/dependencies, shared/types.ts, integration docs. Ask coordinator before changing shared contract.

Blender exports fixed architecture to a unique public/generated/<scene-key>/build-<revision>-<id>/brannan.glb. Movable furniture is rendered separately in the browser and included in Blender reference/room renders and the editable blend file. Furniture operations update canonical JSON immediately. Architecture/material changes clear stale GLBs; the browser uses an honestly labeled procedural preview until rebuilding.

No secrets in source, browser bundles, logs, test fixtures or commits. Runtime inputs/artifacts and listing photos ignored. Runtime Argon calls use gemini-4-argon via Interactions per event guide; no silent model substitution. Fixtures, cached inputs and deliberate stress tests are labeled.

The Brannan demonstration includes both floors and room-specific source references. Each room has sourceIds, estimated appearance, a fresh Blender render and a separate visual assessment. Missing source photos and obstructed/missing renders cannot pass. Fixed fixtures participate in geometry checks; elevated wall details are preserved as fixed scene objects. No walking certification, regulatory claims, or unsupported exact dimensions. Preserve original LICENSE.

New Zillow URLs first pass an image-byte intake gate: scoped property gallery, private interior photos, and a legible scaled plan. New properties use live source-derived geometry rather than the Brannan fixture. Strict geometry/stair/route validation can reject a draft and return plan-review findings. This is expected fail-closed behavior, not evidence that arbitrary properties reconstruct reliably.

Saved homes are independent runtime/projects/<zpid>/state.json files, with revision archives and scoped interaction logs. The active runtime/state.json remains a recovery pointer/checkpoint. Source images and immutable generated builds are retained when switching homes. Mutations are serialized, reject foreign browser origins, drain parallel workers before rollback, and keep the busy lock until persistence completes.
