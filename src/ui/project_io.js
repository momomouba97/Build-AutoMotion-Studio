'use strict';
// Renderer-side project serialisation (mirrors src/project/project.js).
window.ProjectIO = {
  serialize(state) {
    return JSON.stringify({
      format: 'automotion-studio-project', version: 1, name: state.name || 'Untitled', savedAt: new Date().toISOString(),
      media: state.media, flags: state.flags || {}, musicId: state.musicId || null, settings: state.settings || {}, seed: state.seed || null, timeline: state.timeline,
    }, null, 1);
  },
};
