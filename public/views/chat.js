import { mountChatPage } from "../chat.js";

export const title = "Club chat";

export async function mount(container) {
  await mountChatPage(container);
}
