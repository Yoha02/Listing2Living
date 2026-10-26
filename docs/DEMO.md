# Listing2Living: three-minute live demo

## Before judging

Run a complete source-analysis/approval/build once on the presentation machine. Confirm API access, source images, Blender availability and the browser scene. Keep the real logs and clearly distinguish this prepared run from new live operations. Use source images in submitted footage only with the needed permission.

Open the source interpretation and approval stage before the presentation if source collection latency would otherwise dominate the three minutes. The prepared inputs and analysis remain labelled. Leave the live generation/repair controls available and use a fresh request during judging.

## Live sequence

| Time      | Show                                                          | Say                                                                                                                                                                                |
| --------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:20 | Listing evidence and lower-floor plan                         | “Photos show a home. They don't tell me whether my life will fit inside it.”                                                                                                       |
| 0:20–0:45 | Plan interpretation and furniture approval                    | “Argon reads the plan, estimates furniture sizes from the room scale, and shows what it knows and what it inferred. I approve the items before generation.”                        |
| 0:45–1:15 | Blender build progress and explorable scene                   | “This approved scene goes to Blender. The same dimensions drive this floor plan, the 3D home and the checks.”                                                                      |
| 1:15–1:50 | Deliberate doorway obstruction, failed routes and live repair | “This is an intentional stress test. The route really fails. The agent proposes a repair, and geometry must prove the routes work again.”                                          |
| 1:50–2:25 | Room-specific source/render comparison and critic findings    | “Argon compares every room with its own source photos. Missing photos cannot pass. Finish recommendations go back through render and review; structural assumptions return to me.” |
| 2:25–2:50 | Walkthrough, furniture edit and source provenance             | “I can explore, arrange, test and review a space before visiting.”                                                                                                                 |
| 2:50–3:00 | App and repository                                            | “Listing2Living. Step inside your next home.”                                                                                                                                      |

Generation times depend on the live service. If a stage is still running, show the real events, then demonstrate the already-completed scene while identifying it as prepared during the event. Never relabel a recording or cached result as a new live call.

## One-minute submission video

Show the URL/source evidence (5s), dimension-and-item approval (10s), generated room and floor plan (15s), blocked-route repair (20s), and source/render review (10s). Label edited-out wait time. The app is the demonstration; slides are unnecessary.

## Answers to likely questions

- **What did you build today?** The interface, shared scene format, Argon orchestration, approval gate, deterministic Blender builder, geometry checks and repair/review flow. Credit the existing libraries and tools.
- **What is actually live?** The event stream identifies real Argon calls, Blender builds and geometry results. Sources can be cached and the traced footprint is a declared starter.
- **Can it handle any listing?** The intake adapter supports Zillow property URLs. It checks actual images and a scaled floor plan before reconstruction; each new property gets its own isolated scene. Complex or inconsistent plans can still fail strict geometry validation and need human review. Other websites are unsupported.
- **How accurate is it?** Plan-derived dimensions have a source; height and furniture sizes include estimates. Visual scores are a provisional rubric. It is a planning aid, not a survey.
- **Why Argon?** It reads the multimodal evidence, coordinates structured proposals and critiques the rendered result. The project demonstrates the More Dimensions render–inspect–repair loop rather than claiming a benchmark it has not measured.
