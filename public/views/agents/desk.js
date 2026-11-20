// Agents → Research desk (moved unchanged, WS11).
export default {
  key: "desk", label: "Research desk", order: 40,
  async render(el) { await (await import("../../deskView.js")).mountDesk(el); },
};
