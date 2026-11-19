// Agents → Gallery tab (plan 3.6 tab registry): templates and the team's agents.
export default {
  key: "gallery", label: "Gallery", order: 15,
  async render(el) { (await import("../../agentBuilder/gallery.js")).mountGallery(el); },
};
