/**
 * What the channels hand to `chatbotController.emit` (from the `@api/server.module` stub installed by setup.ts).
 * Kept apart from setup.ts so tests can import these named helpers without moving the side-effect import of
 * setup.ts away from the top of the file (import sorting).
 */
type EmitHandler = (data: any) => unknown;

let emitHandler: EmitHandler | null = null;

/** Every call the channels made to `chatbotController.emit`. */
export const chatbotEmitCalls: any[] = [];

/** Routes `chatbotController.emit` (used by the channels) to a handler, e.g. a real chatbot controller. */
export const setChatbotEmitHandler = (handler: EmitHandler | null) => {
  emitHandler = handler;
};

export const recordChatbotEmit = async (data: any) => {
  chatbotEmitCalls.push(data);
  if (emitHandler) await emitHandler(data);
};
