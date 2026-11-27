# Activity Studio

Activity Studio lays out directed UML and SysML activity graphs, lets users adjust the arrangement in a browser, and exports geometry that another renderer can reuse. It is the layout and editing component of a larger process-algebra modeling system. The application uses rectangles, swimlanes, and directed arrows. The upstream system supplies nodes, transitions, and optional semantic data. The scope covers arrangement and editing of that graph. Process-algebra parsing, transition-graph generation, professional UML notation, and reverse translation are handled by other components.

## Run locally

Serve the repository root over HTTP and open [http://localhost:8000/](http://localhost:8000/).

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

The browser loads JavaScript modules and example files using relative URLs. A recent Chrome, Edge, Firefox, or Safari release can run the app. The project uses plain HTML, CSS, and JavaScript with zero runtime dependencies, a static host, and localStorage.

## Edit a diagram

1. The first visit opens **Order fulfillment**. Use **Load Example** to open any of the six built-in graphs, **Import JSON** for a file from another tool, or **New Diagram** for a blank diagram.
2. Drag a node to move it within its swimlane. Connected edges follow the node. Drag a swimlane header to reorder lanes with their contents. Drag its right edge to resize it or use the **Inspector** for width, shared height, and lane order. Use **Add Swimlane** to make another lane.
3. Use **Add Node** to choose a label and a lane. Use **Add Edge** and select the source and target, in that order. If you already selected a source node, choose only the target. A node can connect to itself. Press **Esc** to cancel.
4. Click an edge to expose its route handles. Drag a circle to reposition a waypoint. Drag a square to move a segment. **Add Waypoint** inserts a point on the longest segment. Select a circle and choose **Remove Waypoint** or press **Delete**. Select a node or edge and use **Delete** to delete it. Deleting a node also deletes its incident edges.
5. Drag the background to pan. Use the mouse wheel or the zoom controls to zoom. **Fit** brings the diagram and any outlying waypoints into view. **Undo** and **Redo** track edits and explicit layout changes. The Inspector edits labels.
6. **Auto Layout** regenerates coordinates and routes on demand. It asks for confirmation when the current arrangement includes manual edits.
7. Use **Save** to store the working diagram in this browser. **Open** lists local copies by title and save time. Use **Export JSON** to transfer the full diagram to another machine, browser, or renderer.

## Smart initial placement

- **Graph layering.** The engine finds weakly connected components and performs an iterative directed DFS, starting with entry nodes when available. DFS back edges and self-loops become feedback edges for placement. The remaining acyclic graph gets longest-path ranks, which place ordinary edges downward and leave joins and merges below all their forward predecessors. Independent branches can share a rank. Disconnected components occupy separate vertical blocks.
- **Swimlane optimization.** Connections between lanes form a weighted adjacency graph. Up to five lanes are ranked by considering every permutation. For larger sets the engine uses seeded pair swaps. Promising lane orders and the input lane order are evaluated with their own node ordering and routing. Each lane is sized from the widest row assigned to it and all lane boundaries share the same vertical extent. Node membership stays fixed.
- **Crossing reduction.** Long edges contribute temporary vertices on intermediate ranks. Eight alternating barycenter sweeps reorder vertices within their lane and rank by the positions of neighbors above and below. The best sweep is selected using adjacent-rank inversions and span. Actual node positions use the resulting constrained order.
- **Routing.** Each edge gets spaced ports along the source and target. The router checks orthogonal candidates in row gaps, along lane gutters, and around the perimeter. It rejects more obstructed candidates, then reroutes edges in several passes to reduce crossings and shared runs while keeping routes short. Feedback edges favor paths around the main flow. The edge still points from its original source to its original target.
- **Final scoring.** The engine evaluates routed configurations lexicographically by overlapping node pairs, obstructed edges, crossings, then edge length plus a bend penalty. Candidate counts and refinement passes are bounded for larger graphs.

### Measured comparison

The naive baseline uses the same feasible ranks, input lane and node order, center ports, and simple midpoint routes. A crossing is a proper transverse intersection between two routes. Shared runs, endpoint contacts, and tangencies are excluded. Overlaps count node pairs with intersecting interiors. Obstructions count each edge once if it enters any unrelated node interior. Length is the sum of Euclidean segment lengths in diagram units, rounded for display. Bends count direction changes after compacting redundant points.

The following results were generated with `npm run metrics`. Each cell shows naive → smart.

| Example | Crossings | Overlaps | Obstructed edges | Length | Bends |
| --- | ---: | ---: | ---: | ---: | ---: |
| [Travel request](examples/sequence.json) | 0 → 0 | 0 → 0 | 0 → 0 | 180 → 180 | 0 → 0 |
| [Access decision](examples/branch.json) | 0 → 0 | 0 → 0 | 0 → 0 | 1,140 → 709 | 12 → 8 |
| [Content release](examples/parallel.json) | 1 → 0 | 0 → 0 | 0 → 0 | 2,100 → 1,273 | 14 → 8 |
| [Document review](examples/loop.json) | 0 → 0 | 0 → 0 | 0 → 0 | 1,264 → 1,261 | 14 → 16 |
| [Order fulfillment](examples/fulfillment.json) | 0 → 0 | 0 → 0 | 0 → 0 | 2,192 → 1,764 | 12 → 16 |
| [Incident response](examples/incident.json) | 3 → 0 | 0 → 0 | 0 → 0 | 5,388 → 4,022 | 22 → 28 |

The fulfillment input puts Warehouse between Customer and Order operations. The smart layout moves Order operations next to Customer and reduces total edge length by about 20%. The incident example combines an unfavorable lane order, a decision, parallel branches, a retry loop, and a disconnected node. Its total edge length falls by about 25%. The comparison panel updates after manual edits. When graph structure changes, it clears the previous baseline until the next Auto Layout run.

## JSON integration

### Graph input

The version 1 object requires ordered `lanes`, `nodes`, and `edges` arrays. Each entity has a unique nonempty string `id` within its array. A node's `laneId` identifies an existing swimlane. An edge's `source` and `target` identify existing nodes. Parallel edges and self-loops are supported. `version` defaults to `1` and `title` defaults to `"Untitled diagram"`.

```json
{
  "version": 1,
  "title": "Request review",
  "lanes": [
    { "id": "author", "label": "Author" },
    { "id": "reviewer", "label": "Reviewer" }
  ],
  "nodes": [
    { "id": "draft", "label": "Draft request", "laneId": "author", "type": "action" },
    { "id": "check", "label": "Review request", "laneId": "reviewer", "type": "decision" }
  ],
  "edges": [
    { "id": "submit", "source": "draft", "target": "check", "metadata": { "event": "submit" } }
  ],
  "metadata": { "processId": "request-review" }
}
```

Optional `label` values must be strings. Node `width` and `height` are optional positive dimensions for layout. Optional lane dimensions act as minimum size hints on graph-only input. `type`, `metadata`, and other JSON attributes on the diagram, lanes, nodes, and edges are preserved by layout, editing, and export. Use a `metadata` object for integration-specific attributes.

### Arranged output

[See the edited fulfillment export](examples/saved/edited-order.json) for a full file. Geometry is expressed as absolute diagram coordinates, with the origin at the upper left and positive y pointing down.

| Location | Geometry and meaning |
| --- | --- |
| `layout` | Indicates a complete arrangement. Requires positive `width` and `height`. Optional `manual` marks an edited arrangement. Optional `baseline` contains `crossings`, `overlaps`, `obstructions`, `length`, and `bends` from the automatic layout run. |
| Lane | `x`, `y`, `width`, `height` describe the outer rectangle including the 44-unit header. Array order is left to right, with aligned tops and heights. |
| Node | `x`, `y`, `width`, `height` describe the node rectangle within the body of its lane. Node and lane dimensions are positive. |
| Edge | `route` is an array of at least two finite `{ "x": number, "y": number }` points in source-to-target order. The first and last points are attachments, and intermediate points are waypoints. Draw the arrow toward the last point. Manual routes can extend beyond the nominal bounds. |

For a graph-only input, omit `layout`, all node and lane `x` and `y` values, and all edge `route` arrays. To provide saved geometry, include all of those fields together. The importer reports malformed JSON, unsupported versions, duplicate IDs, missing references, partial layouts, and node or lane bounds violations.

## Saving and restoring

Saving keeps graph topology, lane order and dimensions, node positions and dimensions, all route points, labels, and semantic metadata. Multiple diagrams can be saved by using **New Diagram**, **Load Example**, or **Import JSON** before saving. Repeated saves of an open local copy update that copy. Reloading the app opens the most recently saved copy. The view fits the restored geometry to the current screen.

Local saves live in the current browser profile and origin. A complete JSON import and a local reopen both use the stored geometry directly. Automatic layout runs on graph-only import, example load, and explicit **Auto Layout**. Editing and reopening do not invoke the layout engine. Viewport pan and zoom and the undo history belong to the current session.

## Code and tests

| Area | Files |
| --- | --- |
| Validation and geometry conventions | `src/model.js`, `src/geometry.js` |
| Layering, lane and node ordering, placement, routing, metrics | `src/layers.js`, `src/layout.js`, `src/routing.js`, `src/metrics.js` |
| Editor operations and history | `src/editor.js` |
| Browser UI and SVG rendering | `index.html`, `src/app.js`, `src/render.js`, `src/style.css` |
| Local saves and JSON I/O | `src/persistence.js` |

With Node.js 20 or later, run the tests and reproduce the metrics.

```sh
npm test
npm run metrics
```

**Executed results.** Node.js 20 ran 19 tests, with 19 passing and zero failures. The suite checks topology, node containment and spacing, edge directions, cycle handling, metrics, deterministic layout, editing, undo and redo, save and open, and JSON import and export. Headless Chrome also exercised the editor under the repository subpath, including real pointer drags, lane edits, add-node and add-edge flows, undo and redo, overwrite confirmation, save and reopen, browser reload, download and reimport, malformed import, example switching, and mobile sizing.

## GitHub Pages

1. Commit the files and push them to the repository's `main` branch.
2. Open the repository's [Pages settings](https://github.com/zty0508/activity-diagram-layout/settings/pages). Choose **Deploy from a branch**, select **main** and **/(root)**, and click **Save**. [GitHub Pages publishing documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
3. Wait for GitHub's Pages deployment to succeed. Open the published [Activity Studio](https://zty0508.github.io/activity-diagram-layout/) URL. For a fork, GitHub Pages uses the fork owner's hostname and repository path.

The root `index.html` is the entry point, `.nojekyll` serves the files as-is, and the relative paths work at project subpaths. GitHub Pages can deploy the source directly without a separate build workflow.

## Known limitations

- Placement and routing use bounded heuristics. Dense graphs can retain crossings, overlapping edge runs, or detours, and exact routing comparisons can take longer on very large imports.
- Vertical alignment describes graph execution ranks. Fork, join, decision, and action types retain their semantic tags and share the same rectangular rendering.
- Manual routes and node positions can introduce overlaps and crossings. This gives users direct control over the geometry. Node moves remain constrained to their assigned lanes.
- Browser storage is local to a profile and site origin. Export JSON for backups or transfer. The editor supports one diagram at a time and has no real-time collaboration.
