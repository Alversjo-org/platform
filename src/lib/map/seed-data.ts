/**
 * Starting polygons, hand-estimated by eye against public/map/alversjo.jpg
 * and the lettered reference map described in the design doc (§6). Rough
 * drafts, not survey-accurate — meant to be refined later via the
 * /areas/[id]/cells editor.
 */
export const SEED_AREAS: Array<{ id: string; name: string; polygon: Array<[number, number]> }> = [
  { id: 'section-a', name: 'A', polygon: [[0.33, 0.19], [0.29, 0.20], [0.12, 0.65], [0.17, 0.64]] },
  { id: 'section-b', name: 'B', polygon: [[0.42, 0.60], [0.58, 0.58], [0.63, 0.70], [0.60, 0.90], [0.50, 0.97], [0.40, 0.90], [0.38, 0.70]] },
  { id: 'section-c', name: 'C', polygon: [[0.37, 0.33], [0.46, 0.32], [0.47, 0.38], [0.42, 0.39], [0.40, 0.40], [0.36, 0.38]] },
  { id: 'section-c1', name: 'C1', polygon: [[0.60, 0.29], [0.65, 0.28], [0.66, 0.32], [0.61, 0.33]] },
  { id: 'section-d', name: 'D', polygon: [[0.68, 0.27], [0.76, 0.26], [0.77, 0.31], [0.69, 0.32]] },
  { id: 'section-e', name: 'E', polygon: [[0.36, 0.39], [0.47, 0.38], [0.48, 0.44], [0.37, 0.45]] },
  { id: 'section-f', name: 'F', polygon: [[0.37, 0.45], [0.48, 0.44], [0.49, 0.49], [0.38, 0.50]] },
  { id: 'section-g', name: 'G', polygon: [[0.48, 0.44], [0.60, 0.42], [0.63, 0.50], [0.55, 0.56], [0.48, 0.52], [0.49, 0.49]] },
  { id: 'section-h', name: 'Sunny Hills', polygon: [[0.28, 0.55], [0.38, 0.54], [0.39, 0.62], [0.30, 0.63]] },
  { id: 'section-t', name: 'Downtown', polygon: [[0.38, 0.57], [0.45, 0.56], [0.46, 0.61], [0.39, 0.62]] },
  { id: 'section-i', name: 'Bison', polygon: [[0.45, 0.56], [0.52, 0.55], [0.53, 0.60], [0.46, 0.61]] },
];
