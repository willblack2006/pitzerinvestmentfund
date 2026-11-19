// Agents hub → Feed tab (WS7): the team feed, first tab of the hub.
import { renderFeedPage } from "../feed.js";

export default {
  key: "feed", label: "Feed", order: 0,
  render(el) { return renderFeedPage(el, { filter: "all", head: false }); },
};
