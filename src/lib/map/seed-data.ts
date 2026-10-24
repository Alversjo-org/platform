/**
 * Starting polygons, hand-estimated by eye against public/map/alversjo.jpg
 * and the lettered reference map described in the design doc (§6). Rough
 * drafts, not survey-accurate — meant to be refined later via the
 * /areas/[id]/cells editor.
 */
export const SEED_AREAS: Array<{ id: string; name: string; polygon: Array<[number, number]> }> = [
  { id: 'section-a', name: 'A', polygon: [[0.262, 0.479], [0.282, 0.5], [0.268, 0.564], [0.245, 0.629], [0.188, 0.635], [0.202, 0.544], [0.228, 0.496]] },
  { id: 'section-b', name: 'B', polygon: [[0.42, 0.766], [0.58, 0.766], [0.63, 0.798], [0.6, 0.9], [0.5, 0.97], [0.4, 0.9], [0.38, 0.798]] },
  { id: 'section-c', name: 'C', polygon: [[0.37, 0.33], [0.46, 0.32], [0.47, 0.38], [0.42, 0.39], [0.40, 0.40], [0.36, 0.38]] },
  { id: 'section-c1', name: 'C1', polygon: [[0.67, 0.439], [0.701, 0.423], [0.718, 0.425], [0.692, 0.449]] },
  { id: 'section-d', name: 'D', polygon: [[0.701, 0.423], [0.775, 0.437], [0.746, 0.475], [0.695, 0.483], [0.675, 0.459]] },
  { id: 'section-e', name: 'E', polygon: [[0.36, 0.39], [0.47, 0.38], [0.48, 0.44], [0.37, 0.45]] },
  { id: 'section-f', name: 'F', polygon: [[0.37, 0.45], [0.48, 0.44], [0.49, 0.49], [0.38, 0.50]] },
  { id: 'section-g', name: 'G', polygon: [[0.48, 0.44], [0.60, 0.42], [0.63, 0.50], [0.55, 0.56], [0.48, 0.52], [0.49, 0.49]] },
  { id: 'section-h', name: 'Sunny Hills', polygon: [[0.228, 0.624], [0.444, 0.624], [0.444, 0.766], [0.228, 0.766]] },
  { id: 'section-t', name: 'Downtown', polygon: [[0.399, 0.637], [0.541, 0.637], [0.541, 0.745], [0.399, 0.745]] },
  { id: 'section-i', name: 'Bison', polygon: [[0.541, 0.637], [0.684, 0.637], [0.684, 0.725], [0.541, 0.725]] },
];
