// leaflet-geoman is a classic Leaflet plugin: it extends the global `L`. Import this module
// before '@geoman-io/leaflet-geoman-free' so that global exists (imports run in order).
import L from 'leaflet';

(window as unknown as { L: typeof L }).L = L;
