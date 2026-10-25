# Listing2Living

**Paste a listing. Step inside. Make it yours.**

Listing2Living turns a property's floor plan and photos into an editable 3D planning scene. Gemini 4 Argon reads the evidence, proposes furnishings, and critiques the rendered result. A person approves the proposed items before Blender builds them. Geometry tools test circulation and collisions; proposed repairs are tested again before acceptance.

This hackathon V1 supports **both floors of 200 Brannan Street, Apt 114, San Francisco**. It uses explicitly labelled, source-traced footprints as a starting point. It is not yet a general reconstruction service for arbitrary listings.

## Run locally

Requirements: Node.js 22+, Python 3.11+, Blender 5.x, and a Gemini API key with access to `gemini-4-argon`.

```powershell
npm ci
Copy-Item .env.example .env
# Set GEMINI_API_KEY in the local .env file.
npm run dev
```

Open [the local studio](http://127.0.0.1:5173). The key is used only by the local server. `.env`, downloaded source images, model interactions, and generated artifacts are excluded from Git.

The default Blender path is `C:\Program Files\Blender Foundation\Blender 5.0\blender.exe`; set `BLENDER_PATH` if yours differs. The builder can use the installed Blender MCP add-on on localhost 9876 or fall back to a Blender subprocess. See [Blender setup](blender/README.md).

## The flow

1. **Analyze the listing:** collect the floor plan and interior photos, with live/cached provenance.
2. **Interpret the plan:** normalize dimensions, room polygons, openings, stairs, coordinate conventions, and uncertainty for the 3D builder.
3. **Propose items:** Argon identifies supported furnishings in the photos, estimates their sizes from the room scale, and records source evidence. Suggested additions are labelled separately.
4. **Approve:** select items and adjust estimated dimensions, or use three suggested pieces.
5. **Build and test:** Blender assembles both floors. Geometry checks test collisions, boundaries, downstairs routes and upstairs routes from the landing.
6. **Render, inspect, repair:** Argon compares a fresh furnished render with source images. Bounded repair attempts handle movable placements and finishes. Structural questions remain for a person to review.

The browser uses Three.js for interaction and procedural furniture, with a Blender-exported architectural GLB. The canonical scene uses metres, XY ground coordinates and Z up, so the plan, renderer, builder and checks share the same object IDs and dimensions.

## Try the demo

Use this [Brannan listing](https://www.zillow.com/homedetails/200-Brannan-St-APT-114-San-Francisco-CA-94107/69817820_zpid/), then review the proposed items. In the finished scene:

- Compare source photos with the reconstruction.
- Switch between Main floor and Second floor; the plan and furniture tools follow the selected level.
- Choose **Walk inside**: W/S move forward/back, A/D strafe, left/right arrows turn, up/down arrows look, and mouse-drag looks around. Walk onto the stairs to move between floors. Escape returns to orbit controls.
- Ask for a sofa and a work desk while keeping the kitchen and stairs reachable.
- Select furniture on the floor plan and move, rotate or recolor it.
- Turn on clear routes and rehearse a walk through.
- Add the explicitly labelled doorway stress test, then run Repair.
- Inspect the current browser view with Argon and review its recommendations.

See the [V1 implementation plan](docs/V1-PLAN.md) and [three-minute demo guide](docs/DEMO.md).

## Checks

```powershell
npm run typecheck
npm test
npm run build
node scripts/check-argon.mjs
```

The final command makes a small real API request. Application requests also use the real `gemini-4-argon` model; there is no silent fallback to a different model.

## Scope and evidence

- Only the Brannan source adapter is implemented. A blocked listing page can use the labelled curated reference set; missing essential image bytes stop source inspection.
- The footprint comes from a source-traced floor plan. Ceiling height, furniture dimensions and some details are estimates. The listing and plan disagree about total area; the application preserves that disagreement.
- Upstairs room topology follows the floor-plan panel; floor height, vertical alignment and finishes remain inferred. The current photo set primarily covers downstairs, so upstairs material fidelity is not verified.
- A route result is a geometric planning check with a configured clearance, not a building-code or accessibility certification.
- Visual scores are an uncalibrated model rubric, not a measured percentage of realism or accuracy. Unresolved findings and stale scene revisions remain visible.
- Repairs preserve fixed architecture and approved furniture sizes. Structural changes require renewed human review. Automatic attempts are capped.
- Source photos belong to their respective rights holders and are referenced by URL, not redistributed in the repository. Public availability does not establish permission to republish them. Obtain the needed permission for submitted demo footage, or use owned/authorized replacement imagery.
- Procedural meshes, interface, orchestration and verification code are the project's contributions. Existing libraries, Blender, and the source property are not claimed as original work.

This is a local prototype: the browser and server run on the demonstration machine. No hosted deployment is implied.
